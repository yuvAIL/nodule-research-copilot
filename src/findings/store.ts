import { Labelmap, decodeRle, encodeRle } from '../measure/labelmap';
import { measureLabel } from '../measure/measure';
import { segmentFromSeed, type SegmentOptions } from '../measure/segment';
import type { Volume } from '../measure/volume';
import { idbGet, idbSet } from '../session/idb';
import type { Finding, TimelineEvent } from './types';

/**
 * All findings of one series: their shared labelmap, measurements, review
 * status and undo history. Framework-independent; React subscribes via
 * useSyncExternalStore. Findings and outlines are saved per series in this
 * browser (IndexedDB) and restored when the same series is opened again.
 */

interface UndoEntry {
  snapshot: Map<number, Uint8Array>;
  before: Pick<Finding, 'measurement' | 'edited' | 'status' | 'kMin' | 'kMax' | 'segmentation' | 'seed'>;
}

interface SavedState {
  version: 1;
  seriesInstanceUid: string;
  dims: [number, number, number];
  findings: Finding[];
  labelmapRle: Uint32Array;
  nextNumber: number;
}

export interface StoreSnapshot {
  findings: Finding[];
  selectedId?: string;
  /** Increments on any change, including outline edits (for redraws). */
  version: number;
}

const SAVE_DELAY_MS = 250;
const MAX_UNDO = 30;

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class FindingsStore {
  readonly volume: Volume;
  readonly labelmap: Labelmap;
  private readonly seriesUid: string;
  private findings: Finding[] = [];
  private selectedId?: string;
  private version = 0;
  private nextNumber = 1;
  private undo = new Map<string, UndoEntry[]>();
  private stroke?: { id: string; snapshot: Map<number, Uint8Array>; before: UndoEntry['before'] };
  private listeners = new Set<() => void>();
  private snapshotCache: StoreSnapshot = { findings: [], version: 0 };
  private saveTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(volume: Volume, seriesUid: string) {
    this.volume = volume;
    this.seriesUid = seriesUid;
    this.labelmap = new Labelmap(volume);
  }

  // ── subscription ────────────────────────────────────────────
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StoreSnapshot => this.snapshotCache;

  private changed(save = true): void {
    this.version++;
    this.snapshotCache = { findings: [...this.findings], selectedId: this.selectedId, version: this.version };
    for (const l of this.listeners) l();
    if (save) this.scheduleSave();
  }

  /** Saves pending changes immediately (e.g. when the tab is hidden or closed). */
  flush(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    void this.saveNow();
  }

  dispose(): void {
    this.disposed = true;
    this.flush();
    this.listeners.clear();
  }

  // ── persistence ─────────────────────────────────────────────
  private key(): string {
    return `findings:${this.seriesUid}`;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.saveNow();
    }, SAVE_DELAY_MS);
  }

  private async saveNow(): Promise<void> {
    const state: SavedState = {
      version: 1,
      seriesInstanceUid: this.seriesUid,
      dims: [this.labelmap.cols, this.labelmap.rows, this.labelmap.slices],
      findings: this.findings,
      labelmapRle: encodeRle(this.labelmap.data),
      nextNumber: this.nextNumber,
    };
    await idbSet(this.key(), state);
  }

  /** Restores saved findings for this series. Returns how many were restored. */
  async restore(): Promise<number> {
    const saved = await idbGet<SavedState>(this.key());
    if (!saved || this.disposed) return 0;
    const [c, r, s] = saved.dims;
    if (c !== this.labelmap.cols || r !== this.labelmap.rows || s !== this.labelmap.slices) return 0;
    try {
      this.labelmap.data.set(decodeRle(saved.labelmapRle, this.labelmap.data.length));
    } catch {
      return 0;
    }
    this.findings = saved.findings;
    this.nextNumber = saved.nextNumber;
    this.changed(false);
    return this.findings.length;
  }

  // ── queries ─────────────────────────────────────────────────
  get(id: string | undefined): Finding | undefined {
    return id ? this.findings.find((f) => f.id === id) : undefined;
  }

  labelAt(i: number, j: number, k: number): number {
    if (i < 0 || j < 0 || k < 0 || i >= this.labelmap.cols || j >= this.labelmap.rows || k >= this.labelmap.slices) return 0;
    return this.labelmap.data[(k * this.labelmap.rows + j) * this.labelmap.cols + i] ?? 0;
  }

  findingByLabel(label: number): Finding | undefined {
    return label ? this.findings.find((f) => f.label === label) : undefined;
  }

  canUndo(id: string | undefined): boolean {
    return !!id && (this.undo.get(id)?.length ?? 0) > 0;
  }

  // ── mutations ───────────────────────────────────────────────
  select(id: string | undefined): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.changed(false);
  }

  private update(id: string, patch: Partial<Finding>, event?: TimelineEvent['action']): void {
    this.findings = this.findings.map((f) =>
      f.id === id ? { ...f, ...patch, timeline: event ? [...f.timeline, { t: Date.now(), action: event }] : f.timeline } : f,
    );
  }

  private freeLabel(): number | undefined {
    const used = new Set(this.findings.map((f) => f.label));
    for (let l = 1; l < 256; l++) if (!used.has(l)) return l;
    return undefined;
  }

  private remeasure(id: string): void {
    const f = this.get(id);
    if (!f) return;
    const m = measureLabel(this.labelmap, this.volume, f.label, { kMin: f.kMin, kMax: f.kMax });
    this.update(id, { measurement: m });
  }

  private pushUndo(id: string, entry: UndoEntry): void {
    const list = this.undo.get(id) ?? [];
    list.push(entry);
    if (list.length > MAX_UNDO) list.shift();
    this.undo.set(id, list);
  }

  private undoBefore(f: Finding): UndoEntry['before'] {
    return {
      measurement: f.measurement,
      edited: f.edited,
      status: f.status,
      kMin: f.kMin,
      kMax: f.kMax,
      segmentation: f.segmentation,
      seed: f.seed,
    };
  }

  /**
   * Click on the image: selects an existing finding under the cursor, or runs
   * click segmentation to create a new one.
   */
  clickSegment(seed: { i: number; j: number; k: number }, options: SegmentOptions): { ok: true; id: string; created: boolean } | { ok: false; reason: string } {
    const existing = this.findingByLabel(this.labelAt(Math.round(seed.i), Math.round(seed.j), Math.round(seed.k)));
    if (existing) {
      this.select(existing.id);
      return { ok: true, id: existing.id, created: false };
    }
    const label = this.freeLabel();
    if (label === undefined) return { ok: false, reason: 'Too many findings in this series (255).' };
    const result = segmentFromSeed(this.volume, seed, options);
    if (!result.ok) return result;

    let written = 0;
    let kMin = Infinity;
    let kMax = -Infinity;
    const sliceSize = this.labelmap.sliceSize;
    for (const v of result.voxels) {
      if (this.labelmap.data[v] !== 0) continue; // never overwrite another finding
      this.labelmap.data[v] = label;
      written++;
      const k = Math.floor(v / sliceSize);
      if (k < kMin) kMin = k;
      if (k > kMax) kMax = k;
    }
    if (written === 0) return { ok: false, reason: 'This region is already part of another finding.' };

    const now = Date.now();
    const finding: Finding = {
      id: makeId(),
      label,
      name: `N${this.nextNumber++}`,
      source: 'click',
      edited: false,
      status: 'unreviewed',
      seed: { i: Math.round(seed.i), j: Math.round(seed.j), k: Math.round(seed.k) },
      segmentation: {
        thresholdHu: result.thresholdHu,
        maxRadiusMm: result.maxRadiusMm,
        erosion: result.erosion,
        leaked: result.leaked,
        lungConstrained: result.lungConstrained,
      },
      kMin,
      kMax,
      type: '',
      lobe: '',
      notes: '',
      timeline: [{ t: now, action: 'created' }],
    };
    this.findings = [...this.findings, finding];
    this.selectedId = finding.id;
    this.remeasure(finding.id);
    this.changed();
    return { ok: true, id: finding.id, created: true };
  }

  /** Re-runs click segmentation of a finding with new options (e.g. edge threshold). */
  resegment(id: string, options: SegmentOptions): { ok: true } | { ok: false; reason: string } {
    const f = this.get(id);
    if (!f?.seed) return { ok: false, reason: 'Only click-segmented findings can be re-segmented.' };
    const result = segmentFromSeed(this.volume, f.seed, {
      thresholdHu: options.thresholdHu ?? f.segmentation?.thresholdHu,
      maxRadiusMm: options.maxRadiusMm ?? f.segmentation?.maxRadiusMm,
    });
    if (!result.ok) return result;
    const before = this.undoBefore(f);
    const snapshot = this.labelmap.clearLabel(f.label);
    let kMin = Infinity;
    let kMax = -Infinity;
    const sliceSize = this.labelmap.sliceSize;
    for (const v of result.voxels) {
      const k = Math.floor(v / sliceSize);
      if (!snapshot.has(k)) snapshot.set(k, this.labelmap.sliceView(k).slice());
    }
    for (const v of result.voxels) {
      if (this.labelmap.data[v] !== 0) continue;
      this.labelmap.data[v] = f.label;
      const k = Math.floor(v / sliceSize);
      if (k < kMin) kMin = k;
      if (k > kMax) kMax = k;
    }
    this.pushUndo(id, { snapshot, before });
    this.update(
      id,
      {
        segmentation: {
          thresholdHu: result.thresholdHu,
          maxRadiusMm: result.maxRadiusMm,
          erosion: result.erosion,
          leaked: result.leaked,
          lungConstrained: result.lungConstrained,
        },
        kMin: Math.min(kMin, f.kMin),
        kMax: Math.max(kMax, f.kMax),
        edited: false,
        status: 'unreviewed',
      },
      'resegmented',
    );
    this.remeasure(id);
    this.changed();
    return { ok: true };
  }

  /** Starts a brush/eraser stroke. With no target finding, a new manual finding is created. */
  beginStroke(targetId: string | undefined, erase: boolean): string | undefined {
    let id = targetId;
    if (!id || !this.get(id)) {
      if (erase) return undefined;
      const label = this.freeLabel();
      if (label === undefined) return undefined;
      const finding: Finding = {
        id: makeId(),
        label,
        name: `N${this.nextNumber++}`,
        source: 'manual',
        edited: false,
        status: 'unreviewed',
        kMin: this.labelmap.slices,
        kMax: -1,
        type: '',
        lobe: '',
        notes: '',
        timeline: [{ t: Date.now(), action: 'created' }],
      };
      this.findings = [...this.findings, finding];
      this.selectedId = finding.id;
      id = finding.id;
    }
    const f = this.get(id) as Finding;
    this.stroke = { id, snapshot: new Map(), before: this.undoBefore(f) };
    return id;
  }

  /**
   * Paints/erases a disc on slice k, or with `sphere` a ball spanning the
   * neighbouring slices within the radius (fast 3D corrections).
   */
  paint(k: number, i: number, j: number, radiusMm: number, erase: boolean, sphere = false): void {
    const s = this.stroke;
    const f = s && this.get(s.id);
    if (!s || !f) return;
    const span = sphere ? Math.floor(radiusMm / this.volume.sliceSpacing) : 0;
    let kMin = f.kMin;
    let kMax = f.kMax;
    for (let dk = -span; dk <= span; dk++) {
      const kk = k + dk;
      if (kk < 0 || kk >= this.labelmap.slices) continue;
      const dz = dk * this.volume.sliceSpacing;
      const r = Math.sqrt(Math.max(0, radiusMm * radiusMm - dz * dz));
      if (r <= 0) continue;
      if (!s.snapshot.has(kk)) s.snapshot.set(kk, this.labelmap.sliceView(kk).slice());
      this.labelmap.paintDisc(kk, i, j, r, this.volume.colSpacing, this.volume.rowSpacing, f.label, erase);
      if (!erase) {
        kMin = Math.min(kMin, kk);
        kMax = Math.max(kMax, kk);
      }
    }
    if (kMin !== f.kMin || kMax !== f.kMax) this.update(f.id, { kMin, kMax });
    // Redraw only; measurements update at the end of the stroke.
    this.version++;
    this.snapshotCache = { ...this.snapshotCache, version: this.version };
    for (const l of this.listeners) l();
  }

  endStroke(): void {
    const s = this.stroke;
    this.stroke = undefined;
    if (!s) return;
    const f = this.get(s.id);
    if (!f) return;
    this.pushUndo(s.id, { snapshot: s.snapshot, before: s.before });
    this.remeasure(s.id);
    const after = this.get(s.id) as Finding;
    if (!after.measurement && after.source === 'manual' && after.timeline.length === 1) {
      // Empty manual finding (e.g. a stroke that only erased): drop it.
      this.findings = this.findings.filter((x) => x.id !== s.id);
      this.undo.delete(s.id);
      this.selectedId = undefined;
    } else {
      this.update(s.id, { edited: true, status: 'unreviewed' }, 'edited');
    }
    this.changed();
  }

  undoLast(id: string): void {
    const list = this.undo.get(id);
    const entry = list?.pop();
    if (!entry) return;
    this.labelmap.restore(entry.snapshot);
    this.update(id, { ...entry.before }, 'undo');
    this.changed();
  }

  /** Reverts all edits made since the finding was created or last restored. */
  resetEdits(id: string): void {
    const list = this.undo.get(id);
    if (!list || list.length === 0) return;
    while (list.length > 0) {
      const entry = list.pop() as UndoEntry;
      this.labelmap.restore(entry.snapshot);
      this.update(id, { ...entry.before });
    }
    this.update(id, {}, 'reset');
    this.changed();
  }

  approve(id: string): void {
    const f = this.get(id);
    if (!f?.measurement) return;
    this.update(id, { status: 'approved', approved: { measurement: f.measurement, at: Date.now() } }, 'approved');
    this.changed();
  }

  reject(id: string): void {
    this.update(id, { status: 'rejected' }, 'rejected');
    this.changed();
  }

  reopen(id: string): void {
    this.update(id, { status: 'unreviewed' }, 'reopened');
    this.changed();
  }

  remove(id: string): void {
    const f = this.get(id);
    if (!f) return;
    this.labelmap.clearLabel(f.label);
    this.findings = this.findings.filter((x) => x.id !== id);
    this.undo.delete(id);
    if (this.selectedId === id) this.selectedId = undefined;
    this.changed();
  }

  /** Links (or unlinks) a finding to the same nodule on an earlier scan. Optionally adopts the earlier Nodule ID. */
  setMatch(id: string, match: Finding['match'], adoptName?: string): void {
    const patch: Partial<Finding> = { match };
    if (adoptName && !this.findings.some((f) => f.id !== id && f.name === adoptName)) patch.name = adoptName;
    this.update(id, patch, 'matched');
    this.changed();
  }

  setThumbnail(id: string, thumbnail: string): void {
    this.update(id, { thumbnail });
    this.changed();
  }

  setFields(id: string, patch: Partial<Pick<Finding, 'type' | 'lobe' | 'notes'>>): void {
    // Typing notes is not a review action; only log type/lobe choices.
    this.update(id, patch, patch.type !== undefined || patch.lobe !== undefined ? 'fields' : undefined);
    this.changed();
  }
}
