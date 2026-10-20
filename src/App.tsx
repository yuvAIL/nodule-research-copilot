import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  CUSTOM_LEFT_TOOLS,
  CtViewport,
  type CtViewportHandle,
  type LeftMouseTool,
  type ViewPointerEvent,
  type ViewerState,
} from './components/CtViewport';
import { drawAnnotations, type ViewMapper } from './components/annotationRenderer';
import { FindingsPanel, type VolumeStatus } from './components/FindingsPanel';
import { BRUSH_SIZES_MM } from './components/Toolbar';
import { buildVolume } from './cornerstone/volumeData';
import { FindingsStore, type StoreSnapshot } from './findings/store';
import type { Finding } from './findings/types';
import { downloadDataUrl, downloadText, screenshotName, toCsv, toRow, type ScanInfo } from './findings/record';
import { formatDicomDate } from './dicom/headerMapping';
import { idbGet, idbSet } from './session/idb';
import { importSpreadsheet, suggestMatch, type PriorRecord } from './findings/priors';
import { nearestSlice, voxelToWorld, type Vec3 } from './measure/volume';
import { FileLoader, type ResumeOffer } from './components/FileLoader';
import { MetadataPanel } from './components/MetadataPanel';
import { SessionSummary } from './components/SessionSummary';
import { PatientTimeline } from './components/PatientTimeline';
import { ReferencePanel, type AgreementView, type LoadedReference } from './components/ReferencePanel';
import type { Labelmap } from './measure/labelmap';
import { measureLabel } from './measure/measure';
import { compareToReference, overlapCount } from './reference/compare';
import { parseReference } from './reference/parseReference';
import { defaultSegment, rasterizeReference, segmentLabelmap } from './reference/rasterize';
import { Toolbar } from './components/Toolbar';
import { preFilter } from './dicom/collectFiles';
import { parseDicomHeaders, type LocalFile, type ParseProgress } from './dicom/parseHeader';
import { buildSeries } from './dicom/seriesBuilder';
import type { CtSeries, SkippedFile } from './dicom/types';
import { DEFAULT_PRESET_ID, rangeToWindow } from './viewer/windowPresets';
import { ensureReadPermission, filesFromDirectory, type DirHandle } from './session/folderAccess';
import {
  clearLastSession,
  loadLastSession,
  saveLastSession,
  type LastSession,
  type SessionSource,
} from './session/lastSession';
import { downloadSample, fetchSampleFile, fetchSampleManifest } from './session/sampleData';
import { candidatesFromSegments } from './ai/candidates';
import { drawMip } from './viewer/mip';
import { densityHint } from './measure/density';
import { lobeHint, lobeSegments, type LobeHint, type LobeSegment } from './ai/lobes';

type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'listing'; label: string }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'reading'; progress: ParseProgress }
  | { kind: 'done'; fileCount: number };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EMPTY_SNAPSHOT: StoreSnapshot = { findings: [], version: 0 };
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_SNAPSHOT;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function describeSession(session: LastSession): string {
  const parts: string[] = [];
  if (session.seriesLabel) parts.push(session.seriesLabel);
  if (session.sliceIndex !== undefined) parts.push(`slice ${session.sliceIndex + 1}`);
  parts.push(`saved ${new Date(session.savedAt).toLocaleString()}`);
  return parts.join(' · ');
}

export default function App() {
  const viewerRef = useRef<CtViewportHandle>(null);
  const [status, setStatus] = useState<LoadStatus>({ kind: 'idle' });
  const [allSeries, setAllSeries] = useState<CtSeries[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>();
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [error, setError] = useState<string>();
  const [leftTool, setLeftTool] = useState<LeftMouseTool>('windowLevel');
  const [viewer, setViewer] = useState<ViewerState>({ index: 0, total: 0 });
  const [source, setSource] = useState<SessionSource>();
  const [lastSession, setLastSession] = useState<LastSession>();
  const [sampleAvailable, setSampleAvailable] = useState<boolean>();
  /** Slice to restore once the restored series has rendered. */
  const pendingSlice = useRef<{ seriesInstanceUid: string; index: number } | undefined>(undefined);

  // ── measurement state ─────────────────────────────────────────
  const [store, setStore] = useState<FindingsStore>();
  const [volumeStatus, setVolumeStatus] = useState<VolumeStatus>({ kind: 'none' });
  const [brushRadiusMm, setBrushRadiusMm] = useState(3);
  const [brush3d, setBrush3d] = useState(true);
  const [notice, setNoticeState] = useState<{ text: string; action?: { label: string; run: () => void } }>();
  const setNotice = useCallback((text: string | undefined, action?: { label: string; run: () => void }) => {
    setNoticeState(text === undefined ? undefined : { text, action });
  }, []);
  const [hideOverlays, setHideOverlays] = useState(false);
  /** Thick-slab MIP display (search aid), slab thickness in mm; 0 = off. */
  const [mipMm, setMipMm] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [exportedRows, setExportedRows] = useState(0);
  const brushCursor = useRef<{ x: number; y: number } | undefined>(undefined);
  const lastPaint = useRef<{ i: number; j: number; k: number } | undefined>(undefined);
  const snap = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? emptySnapshot);
  const selectedFinding = snap.findings.find((f) => f.id === snap.selectedId);

  // Expert reference (read-only outline from a DICOM SEG / RTSTRUCT), per open series.
  const [reference, setReference] = useState<{
    seriesUid: string;
    info: LoadedReference;
    /** Segment shown and compared (1-based position in the file). */
    selected: number;
    /** Only the selected segment, value 1. */
    labelmap: Labelmap;
  }>();
  const [showReference, setShowReference] = useState(true);
  const [referenceError, setReferenceError] = useState<string>();
  const [agreement, setAgreement] = useState<AgreementView>();
  const [showHelp, setShowHelp] = useState(false);
  /** AI lobe map of the open series (TotalSegmentator lobe classes), used to suggest the Lobe. */
  const [lobes, setLobes] = useState<{ seriesUid: string; segments: LobeSegment[]; model: string }>();
  /** DICOM SEG / RTSTRUCT files found in the opened folder (offered as AI result or expert outline). */
  const [segFiles, setSegFiles] = useState<{ file: File; path: string; description?: string; manufacturer?: string; modality: string }[]>([]);
  /** AI results / expert outlines that come with the public sample; each is imported on the scan it belongs to. */
  const sampleExtras = useRef<{ paths: string[]; cache: Map<string, File> } | undefined>(undefined);
  const [timepoints, setTimepoints] = useState<Record<string, string>>({});
  const [priors, setPriors] = useState<PriorRecord[]>([]);
  const [priorsVersion, setPriorsVersion] = useState(0);

  const series = allSeries.find((s) => s.seriesInstanceUid === selectedUid);
  const current = series?.instances[viewer.index];

  const buildAbort = useRef<AbortController | undefined>(undefined);

  // ── patient timeline: all scans of this patient in the opened data, oldest first ──
  const dateOf = (x: CtSeries) => x.instances[0]?.studyDate ?? '';
  const timeline = useMemo(() => {
    if (!series) return [];
    const pid = series.instances[0]?.patientId ?? '';
    const date = (x: CtSeries) => x.instances[0]?.studyDate ?? '';
    return allSeries
      .filter((x) => (x.instances[0]?.patientId ?? '') === pid)
      .sort((a, b) => date(a).localeCompare(date(b)) || (a.instances[0]?.seriesNumber ?? 0) - (b.instances[0]?.seriesNumber ?? 0));
  }, [allSeries, series]);
  /** Baseline for the earliest date, Follow-up n for later dates (unless the researcher chose otherwise). */
  const autoTimepoint = (x: CtSeries): string => {
    const dates = [...new Set(timeline.map(dateOf))];
    const n = dates.indexOf(dateOf(x));
    return n <= 0 ? 'Baseline' : `Follow-up ${Math.min(n, 4)}`;
  };
  const timepointOf = (x: CtSeries) => timepoints[x.seriesInstanceUid] ?? autoTimepoint(x);
  const switchSeries = useCallback(
    (uid: string) => {
      if (uid === selectedUid) return;
      setError(undefined);
      setSelectedUid(uid);
      setViewer({ index: 0, total: 0 });
    },
    [selectedUid],
  );

  // ── research record ───────────────────────────────────────────
  const firstHeader = series?.instances[0];
  const scanInfo: ScanInfo | undefined = series
    ? {
        patientId: firstHeader?.patientId ?? '',
        studyDate: formatDicomDate(firstHeader?.studyDate) ?? '',
        timepoint: timepointOf(series),
        series: [firstHeader?.seriesNumber, firstHeader?.seriesDescription].filter((v) => v !== undefined && v !== '').join(' — '),
      }
    : undefined;

  // Remember the timepoint chosen for each series.
  useEffect(() => {
    const uid = series?.seriesInstanceUid;
    if (!uid || timepoints[uid]) return;
    void idbGet<string>(`timepoint:${uid}`).then((tp) => {
      if (tp) setTimepoints((prev) => ({ ...prev, [uid]: tp }));
    });
  }, [series, timepoints]);

  const setTimepoint = (tp: string) => {
    const uid = series?.seriesInstanceUid;
    if (!uid) return;
    setTimepoints((prev) => ({ ...prev, [uid]: tp }));
    void idbSet(`timepoint:${uid}`, tp);
  };

  const exportCsv = () => {
    if (!scanInfo) return;
    const rows = snap.findings.filter((f) => f.status === 'approved').map((f) => toRow(scanInfo, f));
    const name = `${scanInfo.patientId || 'scan'}_${scanInfo.timepoint}_${new Date().toISOString().slice(0, 10)}.csv`.replace(/\s+/g, '-');
    downloadText(name, toCsv(rows));
    setExportedRows((n) => n + rows.length);
    setNotice(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} → ${name}`);
  };

  /** Reject with an inline "Undo" in the toast. */
  const rejectWithUndo = (id: string) => {
    if (!store) return;
    const f = store.get(id);
    store.reject(id);
    if (f) setNotice(`${f.name} rejected — it will not be exported.`, { label: 'Undo', run: () => store.reopen(id) });
  };

  // ── follow-up: earlier measurements of this patient ───────────
  const patientId = scanInfo?.patientId ?? '';
  const seriesUid = series?.seriesInstanceUid;

  const centroidWorld = (f: Finding): Vec3 | undefined => {
    const c = f.measurement?.centroid;
    return c && store ? voxelToWorld(store.volume, c.i, c.j, c.k) : undefined;
  };

  const goToFinding = useCallback((f: Finding) => {
    if (f.measurement) viewerRef.current?.goToSlice(f.measurement.sliceIndex);
  }, []);

  // An expert outline belongs to one series: drop it when another series (or scan) is opened.
  useEffect(() => {
    setLobes((l) => (l && l.seriesUid !== seriesUid ? undefined : l));
    setReference((r) => (r && r.seriesUid !== seriesUid ? undefined : r));
    setReferenceError(undefined);
  }, [seriesUid]);

  const loadReference = useCallback(
    async (file: File, opts: { silent?: boolean } = {}) => {
      // Always use the series of the loaded 3D data, never the selection: while switching scans the
      // selection changes before the new volume is ready.
      if (!store) return;
      const seriesUid = store.seriesUid;
      setReferenceError(undefined);
      try {
        const ref = parseReference(new Uint8Array(await file.arrayBuffer()));
        if (ref.referencedSeriesUid && ref.referencedSeriesUid !== seriesUid) {
          if (opts.silent) return;
          setReferenceError(
            `This outline was drawn on another series (…${ref.referencedSeriesUid.slice(-12)}). Open that scan first — ` +
              'outlines are only compared on the scan they were drawn on.',
          );
          return;
        }
        const raster = rasterizeReference(ref, store.volume);
        const chosen = defaultSegment(raster.segments);
        if (!chosen) {
          setReferenceError('No part of this outline lies on the open series.');
          return;
        }
        const warnings = [...raster.warnings];
        if (!ref.referencedSeriesUid) warnings.push('The file does not name its series; it was placed by patient coordinates only.');
        const segments = raster.segments.map((s) => {
          if (!s.voxelCount) return { ...s, measurement: undefined };
          const lm = segmentLabelmap(store.volume, s);
          return { ...s, measurement: measureLabel(lm, store.volume, 1, { kMin: s.kMin, kMax: s.kMax }) };
        });
        setReference({
          seriesUid,
          selected: chosen.label,
          labelmap: segmentLabelmap(store.volume, chosen),
          info: {
            kind: ref.kind,
            fileName: file.name,
            description: ref.seriesDescription,
            creator: ref.creator,
            segments,
            warnings,
          },
        });
        setShowReference(true);
      } catch (e) {
        setReferenceError(`Could not read ${file.name}: ${errorText(e)}`);
      }
    },
    [store],
  );

  const loadAi = useCallback(
    async (file: File, opts: { silent?: boolean } = {}) => {
      if (!store) return;
      const seriesUid = store.seriesUid; // see loadReference: never the selection
      try {
        const ref = parseReference(new Uint8Array(await file.arrayBuffer()));
        // Automatic imports only accept results that name their scan; nothing is placed by guesswork.
        if (opts.silent && !ref.referencedSeriesUid) return;
        if (ref.referencedSeriesUid && ref.referencedSeriesUid !== seriesUid) {
          if (opts.silent) return;
          setNotice('This AI result was computed on another series. Open that scan first.');
          return;
        }
        const raster = rasterizeReference(ref, store.volume);
        const lobeMap = lobeSegments(raster.segments);
        if (lobeMap) {
          const model = [ref.manufacturer ?? ref.modelName ?? 'AI model', ref.softwareVersion].filter(Boolean).join(' ');
          setLobes({ seriesUid, segments: lobeMap, model });
          if (!opts.silent) setNotice(`Lobe map loaded (${model}) — each finding now gets a suggested lobe.`);
          return;
        }
        const set = candidatesFromSegments(raster.segments, store.volume);
        if (!set) {
          setNotice('The AI result has no nodule segment on this series.');
          return;
        }
        const r = store.addAiCandidates(set.candidates, {
          model: ref.manufacturer ?? ref.modelName ?? 'AI model',
          segment: set.segment,
          version: ref.softwareVersion,
          fileUid: ref.sopInstanceUid,
          runDate: ref.contentDate,
        });
        const tiny = set.hiddenTiny ? ` (${set.hiddenTiny} piece${set.hiddenTiny === 1 ? '' : 's'} under ${set.minVolumeMm3} mm³ ignored)` : '';
        if (r.added) {
          setNotice(`AI found ${set.candidates.length} candidate${set.candidates.length === 1 ? '' : 's'}${tiny}. Review: A accept · R reject · J/K next/previous.`);
          const first = store.get(r.firstId);
          if (first) goToFinding(first);
        } else if (r.skipped) {
          if (!opts.silent) setNotice('This AI result is already in the worklist.');
        }
        else setNotice(`The AI found no nodule candidates on this scan${tiny}.`);
      } catch (e) {
        setNotice(`Could not read the AI result ${file.name}: ${errorText(e)}`);
      }
    },
    [store, goToFinding, setNotice],
  );

  // Public sample: bring in the precomputed AI result and expert outline of whichever scan is open.
  const importSampleExtras = useCallback(async () => {
    const extras = sampleExtras.current;
    if (!extras) return;
    try {
      for (const path of extras.paths) {
        let file = extras.cache.get(path);
        if (!file) {
          file = await fetchSampleFile(path);
          extras.cache.set(path, file);
        }
        if (/reference/i.test(path)) await loadReference(file, { silent: true });
        else await loadAi(file, { silent: true });
      }
    } catch (e) {
      setNotice(`Sample extras unavailable: ${errorText(e)}`);
    }
  }, [loadAi, loadReference, setNotice]);

  useEffect(() => {
    if (store) void importSampleExtras();
  }, [store, importSampleExtras]);

  // AI results inside an opened folder (e.g. written by scripts/run-ai.sh) are imported automatically
  // on the scan they belong to. Expert outlines are only loaded on request.
  useEffect(() => {
    if (!store) return;
    void (async () => {
      for (const f of segFiles) {
        if (f.modality === 'SEG' && /totalsegmentator/i.test(f.manufacturer ?? '')) await loadAi(f.file, { silent: true });
      }
    })();
  }, [store, segFiles, loadAi]);

  useEffect(() => {
    viewerRef.current?.redrawAnnotations();
  }, [reference, showReference, hideOverlays, mipMm]);

  // Agreement of the selected finding with the expert outline (debounced: it scans the voxels).
  useEffect(() => {
    if (!reference || !store || !selectedFinding) {
      setAgreement(undefined);
      return;
    }
    setAgreement({ kind: 'busy' });
    const f = selectedFinding;
    const timer = window.setTimeout(() => {
      const seg = reference.info.segments[reference.selected - 1];
      if (!seg || overlapCount(store.labelmap, f.label, seg.voxels) === 0) {
        setAgreement({ kind: 'no-overlap', finding: f.name });
        return;
      }
      const range = { kMin: Math.min(f.kMin, seg.kMin), kMax: Math.max(f.kMax, seg.kMax) };
      const a = compareToReference(store.labelmap, f.label, reference.labelmap, 1, store.volume, range);
      setAgreement(a ? { kind: 'ok', finding: f.name, segment: seg.name, agreement: a } : { kind: 'no-overlap', finding: f.name });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [reference, store, selectedFinding]);

  // Save a summary of approved findings so later scans of the same patient can compare against them.
  useEffect(() => {
    if (!store || !scanInfo || !seriesUid || !patientId) return;
    const timer = window.setTimeout(() => {
      const records: PriorRecord[] = snap.findings
        .filter((f) => f.status === 'approved' && f.approved)
        .map((f) => {
          const m = f.approved?.measurement;
          const c = m?.centroid;
          return {
            key: `app:${seriesUid}:${f.id}`,
            source: 'app',
            patientId,
            timepoint: scanInfo.timepoint,
            date: scanInfo.studyDate,
            series: scanInfo.series,
            seriesUid,
            noduleId: f.name,
            longMm: m?.longMm,
            shortMm: m?.shortMm,
            volumeMm3: m?.volumeMm3,
            type: f.type,
            lobe: f.lobe,
            notes: f.notes,
            thumbnail: f.thumbnail,
            centroidWorld: c ? voxelToWorld(store.volume, c.i, c.j, c.k) : undefined,
          };
        });
      void idbSet(`summary:${seriesUid}`, records);
      void idbGet<string[]>(`patientSeries:${patientId}`).then((list) => {
        if (!list?.includes(seriesUid)) void idbSet(`patientSeries:${patientId}`, [...(list ?? []), seriesUid]);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [store, snap, scanInfo?.timepoint, scanInfo?.studyDate, scanInfo?.series, seriesUid, patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load earlier measurements: other scans of this patient measured here + imported spreadsheet rows.
  useEffect(() => {
    if (!patientId) {
      setPriors([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const uids = (await idbGet<string[]>(`patientSeries:${patientId}`)) ?? [];
      const fromApp: PriorRecord[] = [];
      for (const uid of uids) {
        if (uid === seriesUid) continue;
        fromApp.push(...((await idbGet<PriorRecord[]>(`summary:${uid}`)) ?? []));
      }
      const fromSheet = (await idbGet<PriorRecord[]>(`imported:${patientId}`)) ?? [];
      if (!cancelled) setPriors([...fromApp, ...fromSheet]);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, seriesUid, priorsVersion]);

  const importSheet = async (file: File) => {
    try {
      const result = importSpreadsheet(await file.text(), file.name);
      const byPatient = new Map<string, PriorRecord[]>();
      for (const r of result.records) byPatient.set(r.patientId, [...(byPatient.get(r.patientId) ?? []), r]);
      for (const [pid, recs] of byPatient) {
        const existing = (await idbGet<PriorRecord[]>(`imported:${pid}`)) ?? [];
        const keys = new Set(recs.map((r) => r.key));
        await idbSet(`imported:${pid}`, [...existing.filter((r) => !keys.has(r.key)), ...recs]);
      }
      setPriorsVersion((v) => v + 1);
      const mine = byPatient.get(patientId)?.length ?? 0;
      const missing = (['patientId', 'long'] as const).filter((f) => !result.mapped[f]);
      setNotice(
        missing.length
          ? `Imported, but could not find column(s): ${missing.join(', ')}. Check the header row.`
          : `Imported ${result.records.length} row(s) from ${file.name} — ${mine} for ${patientId || 'this patient'}.`,
      );
    } catch (e) {
      setNotice(`Could not read ${file.name}: ${errorText(e)}`);
    }
  };

  const suggestion = selectedFinding ? suggestMatch(priors, centroidWorld(selectedFinding)) : undefined;
  const lobeHints = useMemo(() => {
    const out = new Map<string, LobeHint>();
    if (!store || !lobes || lobes.seriesUid !== seriesUid) return out;
    for (const f of snap.findings) {
      if (!f.measurement) continue;
      const h = lobeHint(store.labelmap, f.label, f.kMin, f.kMax, lobes.segments);
      if (h) out.set(f.id, h);
    }
    return out;
  }, [store, lobes, seriesUid, snap.findings]);
  const typeHint = useMemo(
    () =>
      store && selectedFinding?.measurement
        ? densityHint(store.volume.hu, store.labelmap, selectedFinding.label, selectedFinding.kMin, selectedFinding.kMax)
        : undefined,
    // Recompute when the outline changes (measurement object changes on every edit).
    [store, selectedFinding?.measurement, selectedFinding?.label, selectedFinding?.kMin, selectedFinding?.kMax],
  );

  /** Shows the finding's measured slice, then calls back once it has rendered. */
  const withFindingSlice = (f: Finding, then: () => void) => {
    const k = f.measurement?.sliceIndex;
    if (k === undefined) return;
    if (viewerRef.current?.currentSlice() === k) {
      then();
      return;
    }
    viewerRef.current?.goToSlice(k);
    window.setTimeout(then, 400);
  };

  const approve = (id: string, then?: () => void) => {
    if (!store) return;
    const f = store.get(id);
    if (!f?.measurement) return;
    store.approve(id);
    // Fill empty Type / Lobe from the suggestions; the researcher can change them at any time.
    const filled: string[] = [];
    const patch: Partial<Pick<Finding, 'type' | 'lobe'>> = {};
    if (!f.type) {
      const t = densityHint(store.volume.hu, store.labelmap, f.label, f.kMin, f.kMax);
      if (t) {
        patch.type = t.suggestion;
        filled.push(`Type ${t.suggestion}`);
      }
    }
    const lh = lobeHints.get(id);
    if (!f.lobe && lh) {
      patch.lobe = lh.lobe;
      filled.push(`Lobe ${lh.lobe}`);
    }
    if (filled.length) {
      store.setFields(id, patch);
      setNotice(`${f.name} accepted · ${filled.join(', ')} filled from suggestions — change any time.`);
    }
    // Keep a small picture of the measured slice for the record and later follow-up comparison.
    withFindingSlice(f, () => {
      const thumb = viewerRef.current?.capture({ maxWidth: 360, type: 'image/jpeg', quality: 0.8 });
      if (thumb) store.setThumbnail(id, thumb);
      then?.();
    });
  };

  const saveScreenshot = (id: string) => {
    const f = store?.get(id);
    if (!f || !scanInfo) return;
    withFindingSlice(f, () => {
      const png = viewerRef.current?.capture({ type: 'image/png' });
      if (png) downloadDataUrl(screenshotName(scanInfo, f), png);
      else setNotice('Could not capture the image.');
    });
  };

  // A new series invalidates the 3D volume and its findings.
  useEffect(() => {
    buildAbort.current?.abort();
    setStore(undefined);
    setVolumeStatus({ kind: 'none' });
  }, [selectedUid, allSeries]);

  useEffect(() => {
    if (!store) return;
    // Don't lose the last edit if the tab is hidden or closed right after it.
    const flush = () => store.flush();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      store.dispose();
    };
  }, [store]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(undefined), notice.action ? 7000 : 4500);
    return () => window.clearTimeout(t);
  }, [notice, setNotice]);

  /** Once the stack is displayed, decode all slices into a 3D volume in the background. */
  const seriesRef = useRef(series);
  useEffect(() => {
    seriesRef.current = series;
  });
  const onStackReady = useCallback((imageIds: string[]) => {
    const target = seriesRef.current;
    if (!target) return;
    buildAbort.current?.abort();
    const controller = new AbortController();
    buildAbort.current = controller;
    setVolumeStatus({ kind: 'loading', done: 0, total: imageIds.length });
    let lastUpdate = 0;
    buildVolume(
      target,
      imageIds,
      (done, total) => {
        const now = performance.now();
        if (done === total || now - lastUpdate > 120) {
          lastUpdate = now;
          setVolumeStatus({ kind: 'loading', done, total });
        }
      },
      controller.signal,
    )
      .then(async (volume) => {
        if (controller.signal.aborted || seriesRef.current !== target) return;
        const next = new FindingsStore(volume, target.seriesInstanceUid);
        const restored = await next.restore();
        if (controller.signal.aborted || seriesRef.current !== target) {
          next.dispose();
          return;
        }
        setStore(next);
        setVolumeStatus({ kind: 'ready', restored });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setVolumeStatus({ kind: 'error', message: `3D measurement data unavailable: ${errorText(e)}` });
      });
  }, []);


  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, view: ViewMapper) => {
      if (!store) return;
      const brushing = leftTool === 'brush' || leftTool === 'erase';
      const cursor = brushCursor.current;
      if (mipMm > 0 && viewer.voi) drawMip(ctx, view, store.volume, mipMm, viewer.voi);
      if (hideOverlays) return;
      drawAnnotations(ctx, view, {
        labelmap: store.labelmap,
        findings: snap.findings,
        selectedId: snap.selectedId,
        brush: brushing && cursor ? { ...cursor, radiusMm: brushRadiusMm, erase: leftTool === 'erase' } : undefined,
        reference:
          reference && showReference
            ? { labelmap: reference.labelmap, names: [reference.info.segments[reference.selected - 1]?.name ?? 'outline'] }
            : undefined,
      });
    },
    [store, snap, leftTool, brushRadiusMm, reference, showReference, hideOverlays, mipMm, viewer.voi],
  );

  const onPointer = useCallback(
    (e: ViewPointerEvent) => {
      const brushing = leftTool === 'brush' || leftTool === 'erase';
      if (e.kind === 'hover' || e.kind === 'leave' || brushing) {
        brushCursor.current = e.kind === 'leave' ? undefined : { x: e.canvas[0], y: e.canvas[1] };
        if (brushing) viewerRef.current?.redrawAnnotations();
      }
      if (e.kind === 'hover' || e.kind === 'leave') return;
      if (!store) {
        if (e.kind === 'down') {
          setNotice(
            volumeStatus.kind === 'error' ? volumeStatus.message : 'Preparing 3D measurement data — try again in a moment.',
          );
        }
        return;
      }
      const v = e.voxel;
      if (leftTool === 'segment') {
        if (e.kind !== 'down') return;
        const result = store.clickSegment(v, {});
        if (!result.ok) setNotice(result.reason);
        return;
      }
      if (!brushing) return;
      const erase = leftTool === 'erase';
      if (e.kind === 'down') {
        const id = store.beginStroke(snap.selectedId, erase);
        if (!id) {
          setNotice('Select a finding first (click it in the list), then erase.');
          return;
        }
        lastPaint.current = v;
        store.paint(v.k, v.i, v.j, brushRadiusMm, erase, brush3d);
      } else if (e.kind === 'drag') {
        const last = lastPaint.current;
        if (!last) return;
        // Interpolate so fast strokes stay continuous.
        const dx = (v.i - last.i) * store.volume.colSpacing;
        const dy = (v.j - last.j) * store.volume.rowSpacing;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(0.5, brushRadiusMm / 2)));
        for (let s2 = 1; s2 <= steps; s2++) {
          const t = s2 / steps;
          store.paint(v.k, last.i + (v.i - last.i) * t, last.j + (v.j - last.j) * t, brushRadiusMm, erase, brush3d);
        }
        lastPaint.current = v;
      } else if (e.kind === 'up') {
        if (lastPaint.current) store.endStroke();
        lastPaint.current = undefined;
      }
    },
    [store, leftTool, snap.selectedId, brushRadiusMm, brush3d, volumeStatus, setNotice],
  );

  const approveRef = useRef(approve);
  const rejectRef = useRef(rejectWithUndo);
  useEffect(() => {
    approveRef.current = approve;
    rejectRef.current = rejectWithUndo;
  });

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const mod = e.metaKey || e.ctrlKey;
      const id = snap.selectedId;
      if (mod && e.key.toLowerCase() === 'z') {
        if (store && id) {
          e.preventDefault();
          store.undoLast(id);
        }
        return;
      }
      if (mod) return;
      if (e.key === '?') {
        setShowHelp((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setShowHelp(false);
        setShowSummary(false);
      }
      if ((e.key === ',' || e.key === '.') && series && timeline.length > 1) {
        const at = timeline.findIndex((x) => x.seriesInstanceUid === series.seriesInstanceUid);
        const next = timeline[(at + (e.key === '.' ? 1 : -1) + timeline.length) % timeline.length];
        if (next) switchSeries(next.seriesInstanceUid);
        return;
      }
      const lower = e.key.toLowerCase();
      if (lower === 't' && series) {
        setMipMm((v) => (v === 0 ? 10 : v === 10 ? 20 : 0));
        return;
      }
      if (lower === 'm' && store && id && suggestion && !store.get(id)?.match) {
        store.setMatch(id, { status: 'Confident', prior: suggestion.prior, at: Date.now() }, suggestion.prior.noduleId);
        setNotice(`${store.get(id)?.name ?? 'Finding'} matched to ${suggestion.prior.noduleId} (${suggestion.prior.timepoint}) — change shown in the worklist.`);
        return;
      }
      if (e.key === ' ' && series) {
        e.preventDefault();
        setHideOverlays((v) => !v);
        return;
      }
      const tools: Record<string, LeftMouseTool> = { s: 'segment', b: 'brush', e: 'erase', w: 'windowLevel', p: 'pan', z: 'zoom' };
      const key = e.key.toLowerCase();
      if (tools[key] && series) {
        setLeftTool(tools[key]);
        return;
      }
      if (key === '[' || key === ']') {
        const idx = BRUSH_SIZES_MM.indexOf(brushRadiusMm);
        const next = BRUSH_SIZES_MM[Math.max(0, Math.min(BRUSH_SIZES_MM.length - 1, idx + (key === ']' ? 1 : -1)))];
        if (next) setBrushRadiusMm(next);
        return;
      }
      if (!store) return;
      const list = snap.findings;
      const start = list.findIndex((f) => f.id === id);
      const show = (f: Finding | undefined) => {
        if (!f) return;
        store.select(f.id);
        goToFinding(f);
      };
      /** Next finding still to review after `from` (wraps around); undefined when all are reviewed. */
      const nextToReview = (from: number) => {
        for (let step = 1; step <= list.length; step++) {
          const f = list[(from + step + list.length) % list.length] as Finding;
          if (f.status === 'unreviewed' && f.id !== id) return f;
        }
        return undefined;
      };
      const wasToReview = list[start]?.status === 'unreviewed';
      // Review keys act on the image, not on whatever button was clicked last (avoids stray focus rings).
      if ('arjkn'.includes(key) && document.activeElement instanceof HTMLElement && document.activeElement.tagName === 'BUTTON') {
        document.activeElement.blur();
      }
      if (key === 'a' && id) {
        approveRef.current(id, wasToReview ? () => show(nextToReview(start)) : undefined);
      } else if (key === 'r' && id) {
        rejectRef.current(id);
        if (wasToReview) show(nextToReview(start));
      } else if (key === 'n') {
        show(nextToReview(start) ?? list[start]);
      } else if ((key === 'j' || key === 'k') && list.length) {
        e.preventDefault();
        show(list[(start + (key === 'j' ? 1 : -1) + list.length) % list.length]);
      } else if (key === 'escape') store.select(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, snap, series, brushRadiusMm, goToFinding, timeline, switchSeries, suggestion, setNotice]);

  // On start-up: offer to continue the previous session, and check whether a sample CT is deployed.
  useEffect(() => {
    const controller = new AbortController();
    void loadLastSession().then((session) => {
      if (!controller.signal.aborted && session) setLastSession(session);
    });
    void fetchSampleManifest(controller.signal).then((manifest) => {
      if (!controller.signal.aborted) setSampleAvailable(manifest !== undefined);
    });
    return () => controller.abort();
  }, []);

  const loadFiles = useCallback(
    async (files: LocalFile[], newSource: SessionSource, restore?: LastSession) => {
      if (files.length === 0) {
        setStatus({ kind: 'idle' });
        setError('No files were found in the selected location.');
        return;
      }
      setError(undefined);
      if (newSource.kind !== 'sample') sampleExtras.current = undefined;
      const { candidates, skipped: preSkipped } = preFilter(files);
      setStatus({ kind: 'reading', progress: { done: 0, total: candidates.length } });

      let parsed: Awaited<ReturnType<typeof parseDicomHeaders>>;
      try {
        parsed = await parseDicomHeaders(candidates, (progress) => setStatus({ kind: 'reading', progress }));
      } catch (e) {
        setStatus({ kind: 'idle' });
        setError(`Failed to read the selected files: ${errorText(e)}`);
        return;
      }
      const { headers, skipped: parseSkipped } = parsed;
      const { series: built, skipped: buildSkipped } = buildSeries(headers);
      setSegFiles(
        headers
          .filter((h) => h.modality === 'SEG' || h.modality === 'RTSTRUCT')
          .map((h) => ({ file: h.file, path: h.relativePath, description: h.seriesDescription, manufacturer: h.manufacturer, modality: h.modality })),
      );

      // Return to the series and slice of the previous session when it is part of this data.
      const restored = restore?.seriesInstanceUid
        ? built.find((s) => s.seriesInstanceUid === restore.seriesInstanceUid)
        : undefined;
      const selected = restored ?? built[0];
      pendingSlice.current =
        restored && restore?.sliceIndex !== undefined
          ? { seriesInstanceUid: restored.seriesInstanceUid, index: restore.sliceIndex }
          : undefined;

      setSkipped([...preSkipped, ...parseSkipped, ...buildSkipped]);
      setAllSeries(built);
      setSelectedUid(selected?.seriesInstanceUid);
      setViewer({ index: 0, total: selected?.instances.length ?? 0 });
      setSource(newSource);
      setLastSession(undefined);
      setStatus({ kind: 'done', fileCount: files.length });
      if (built.length === 0) {
        setError('No displayable DICOM image series were found in the selected files. See “Skipped files” for details.');
      }
    },
    [],
  );

  const openFolder = useCallback(
    async (handle: DirHandle, restore?: LastSession) => {
      setError(undefined);
      try {
        if (!(await ensureReadPermission(handle))) {
          setError(`Permission to read “${handle.name}” was not granted.`);
          return;
        }
        setStatus({ kind: 'listing', label: `Listing files in “${handle.name}”…` });
        const files = await filesFromDirectory(handle);
        await loadFiles(files, { kind: 'folder', handle, name: handle.name }, restore);
      } catch (e) {
        setStatus({ kind: 'idle' });
        setError(`Could not read the folder “${handle.name}”: ${errorText(e)}. It may have been moved or renamed.`);
      }
    },
    [loadFiles],
  );

  const loadSample = useCallback(
    async (restore?: LastSession) => {
      setError(undefined);
      setStatus({ kind: 'listing', label: 'Checking sample…' });
      try {
        const manifest = await fetchSampleManifest();
        if (!manifest) throw new Error('No sample CT is deployed with this build.');
        setStatus({ kind: 'downloading', done: 0, total: manifest.files.length });
        const files = await downloadSample(manifest, (done, total) => setStatus({ kind: 'downloading', done, total }));
        const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
        const paths = [...list(manifest.reference), ...list(manifest.ai)];
        sampleExtras.current = paths.length ? { paths, cache: new Map() } : undefined;
        await loadFiles(files, { kind: 'sample' }, restore);
      } catch (e) {
        setStatus({ kind: 'idle' });
        setError(`Could not load the sample CT: ${errorText(e)}`);
      }
    },
    [loadFiles],
  );

  // After a reload, reopen the previous scan automatically when no click is needed:
  // the public sample always; a local folder only if the browser still grants read access
  // (otherwise the "Continue" card stays and one click on Reopen is required).
  const autoResumed = useRef(false);
  useEffect(() => {
    if (autoResumed.current || !lastSession || series) return;
    autoResumed.current = true;
    const session = lastSession;
    const src = session.source;
    if (src.kind === 'sample') {
      void loadSample(session);
    } else if (src.kind === 'folder' && src.handle.queryPermission) {
      void src.handle
        .queryPermission({ mode: 'read' })
        .then((state) => {
          if (state === 'granted') void openFolder(src.handle, session);
        })
        .catch(() => undefined);
    }
  }, [lastSession, series, loadSample, openFolder]);

  // Remember where the researcher is (source, series, slice) so a reload doesn't lose it.
  useEffect(() => {
    if (!source || !selectedUid || viewer.total === 0) return;
    const timer = window.setTimeout(() => {
      void saveLastSession({
        source,
        seriesInstanceUid: selectedUid,
        seriesLabel: allSeries.find((s) => s.seriesInstanceUid === selectedUid)?.label,
        sliceIndex: viewer.index,
        savedAt: Date.now(),
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [source, selectedUid, viewer.index, viewer.total, allSeries]);

  // Jump to the restored slice once the restored series has actually rendered.
  useEffect(() => {
    const pending = pendingSlice.current;
    if (!pending || pending.seriesInstanceUid !== selectedUid || !viewer.voi || viewer.total === 0) return;
    pendingSlice.current = undefined;
    viewerRef.current?.goToSlice(pending.index);
  }, [selectedUid, viewer.voi, viewer.total]);

  let resume: ResumeOffer | undefined;
  if (lastSession && !series) {
    const session = lastSession;
    const dismiss = () => {
      setLastSession(undefined);
      void clearLastSession();
    };
    const src = session.source;
    if (src.kind === 'folder') {
      resume = {
        title: `Continue: ${src.name}`,
        detail: describeSession(session),
        onResume: () => void openFolder(src.handle, session),
        onDismiss: dismiss,
      };
    } else if (src.kind === 'sample') {
      resume = {
        title: 'Continue: sample CT',
        detail: describeSession(session),
        onResume: () => void loadSample(session),
        onDismiss: dismiss,
      };
    } else {
      resume = {
        title: `Last opened: ${src.name}`,
        detail: `${describeSession(session)}. Open the same folder again to continue at this slice.`,
        onDismiss: dismiss,
      };
    }
  }

  const win = viewer.voi ? rangeToWindow(viewer.voi) : undefined;
  const busy = status.kind === 'reading' || status.kind === 'listing' || status.kind === 'downloading';

  const overlay = series && (
    <>
      <div className="overlay overlay--tl">
        <div>
          Slice {viewer.index + 1} / {viewer.total || series.instances.length}
        </div>
        {current?.instanceNumber !== undefined && <div>Instance {current.instanceNumber}</div>}
        {current?.sliceLocation !== undefined && <div>Loc {current.sliceLocation.toFixed(1)} mm</div>}
      </div>
      <div className="overlay overlay--tr">
        {win && (
          <div>
            W {Math.round(win.width)} / L {Math.round(win.center)}
          </div>
        )}
        {viewer.zoom !== undefined && <div>Zoom {Math.round(viewer.zoom * 100)}%</div>}
      </div>
      <div className="overlay overlay--bl">Research use only — not for diagnosis</div>
      {hideOverlays && <div className="overlay overlay--center">Outlines hidden — press Space to show</div>}
      {series && (
        <button
          type="button"
          className={`mip-toggle${mipMm ? ' mip-toggle--on' : ''}`}
          onClick={() => setMipMm((v) => (v === 0 ? 10 : v === 10 ? 20 : 0))}
          title="Thick-slab maximum intensity projection: nodules stay round, vessels become lines. Display only — measurements use the original slices. (T cycles 10 mm → 20 mm → off)"
        >
          {mipMm ? `MIP slab ${mipMm} mm` : 'Thick slab (MIP)'} <kbd>T</kbd>
        </button>
      )}
      <div className="overlay overlay--br">Wheel/↑↓ slice · middle-drag pan · right-drag zoom</div>
      {notice && (
        <div className="viewport-notice" role="status">
          {notice.text}
          {notice.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                notice.action?.run();
                setNotice(undefined);
              }}
            >
              {notice.action.label}
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className={`app${leftCollapsed ? ' app--left-collapsed' : ''}`}>
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true" />
        <h1>Nodule Research Copilot</h1>
        <span className="badge">Research prototype · not for clinical use</span>
        <div className="header-right">
          <span className="lock" title="No server: DICOM files are read by this page only, and the browser blocks connections to other sites.">
            Scans stay on this computer
          </span>
          <button type="button" className="ghost small" onClick={() => setLeftCollapsed((v) => !v)} title="Show/hide the scan panel">
            {leftCollapsed ? 'Show scan panel' : 'Hide scan panel'}
          </button>
          <button type="button" className="ghost small" disabled={!store} onClick={() => setShowSummary(true)}>
            Session summary
          </button>
          <button type="button" className="ghost small" onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)">
            Shortcuts <kbd>?</kbd>
          </button>
        </div>
      </header>

      {showSummary && store && (
        <SessionSummary
          findings={snap.findings}
          exportedRows={exportedRows}
          scan={scanInfo}
          onClose={() => setShowSummary(false)}
          onStartOver={() => {
            store.clearAll();
            setExportedRows(0);
            setShowSummary(false);
            if (source?.kind === 'sample' && sampleExtras.current) {
              void importSampleExtras();
            } else {
              setNotice('All findings deleted. Load the AI result again (Worklist → Load AI result…) to start a timed run.');
            }
          }}
        />
      )}

      {showHelp && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setShowHelp(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <dl>
              <dt>Accept finding (then jump to the next one to review)</dt>
              <dd><kbd>A</kbd></dd>
              <dt>Reject finding (then jump to the next one)</dt>
              <dd><kbd>R</kbd></dd>
              <dt>Next / previous finding</dt>
              <dd><kbd>J</kbd> <kbd>K</kbd></dd>
              <dt>Next finding still to review</dt>
              <dd><kbd>N</kbd></dd>
              <dt>Add a missed nodule (click it)</dt>
              <dd><kbd>S</kbd></dd>
              <dt>Brush / erase the selected outline</dt>
              <dd><kbd>B</kbd> <kbd>E</kbd></dd>
              <dt>Brush size</dt>
              <dd><kbd>[</kbd> <kbd>]</kbd></dd>
              <dt>Undo last edit</dt>
              <dd><kbd>⌘</kbd><kbd>Z</kbd></dd>
              <dt>Window/level · pan · zoom (left mouse)</dt>
              <dd><kbd>W</kbd> <kbd>P</kbd> <kbd>Z</kbd></dd>
              <dt>Scroll slices</dt>
              <dd>wheel · <kbd>↑</kbd> <kbd>↓</kbd></dd>
              <dt>Previous / next scan of this patient</dt>
              <dd><kbd>,</kbd> <kbd>.</kbd></dd>
              <dt>Thick-slab MIP to spot nodules (10 → 20 mm → off)</dt>
              <dd><kbd>T</kbd></dd>
              <dt>Same nodule as the suggested earlier one</dt>
              <dd><kbd>M</kbd></dd>
              <dt>Hide / show outlines</dt>
              <dd><kbd>Space</kbd></dd>
              <dt>Close / deselect</dt>
              <dd><kbd>Esc</kbd></dd>
            </dl>
          </div>
        </div>
      )}

      <aside className="sidebar">
        <FileLoader
          disabled={busy}
          onFiles={(files, name) => void loadFiles(files, { kind: 'files', name }, lastSession)}
          onFolder={(handle) => void openFolder(handle, lastSession)}
          onLoadSample={() => void loadSample()}
          sampleAvailable={sampleAvailable}
          resume={resume}
          onError={setError}
        />

        {status.kind === 'listing' && (
          <section className="panel">
            <p>{status.label}</p>
          </section>
        )}

        {status.kind === 'downloading' && (
          <section className="panel">
            <p>
              Downloading public sample… {status.done} / {status.total}
            </p>
            <progress max={status.total} value={status.done} />
          </section>
        )}

        {status.kind === 'reading' && (
          <section className="panel">
            <p>
              Reading headers… {status.progress.done} / {status.progress.total}
            </p>
            <progress max={status.progress.total} value={status.progress.done} />
          </section>
        )}

        {error && (
          <section className="panel panel--error" role="alert">
            {error}
          </section>
        )}

        {allSeries.length > 1 && (
          <section className="panel">
            <h2>Series ({allSeries.length})</h2>
            <select
              value={selectedUid}
              onChange={(e) => {
                setError(undefined);
                setSelectedUid(e.target.value);
                setViewer({ index: 0, total: 0 });
              }}
            >
              {allSeries.map((s) => (
                <option key={s.seriesInstanceUid} value={s.seriesInstanceUid}>
                  {s.label}
                </option>
              ))}
            </select>
          </section>
        )}

        {series && series.warnings.length > 0 && (
          <section className="panel panel--warning">
            <h2>Warnings</h2>
            <ul>
              {series.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}

        {series && segFiles.length > 0 && (
          <section className="panel seg-files">
            <h2>Segmentation files in this folder</h2>
            <ul>
              {segFiles.slice(0, 12).map((f) => (
                <li key={f.path}>
                  <div className="seg-file-name" title={f.path}>
                    {f.description || f.path.split('/').pop()}
                    <span className="muted">
                      {' '}
                      · {f.modality}
                      {f.manufacturer ? ` · ${f.manufacturer}` : ''}
                    </span>
                  </div>
                  <div className="button-row button-row--start">
                    <button type="button" className="ghost small" disabled={!store} onClick={() => void loadAi(f.file)}>
                      As AI candidates
                    </button>
                    <button type="button" className="ghost small" disabled={!store} onClick={() => void loadReference(f.file)}>
                      As expert outline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {segFiles.length > 12 && <p className="hint">…and {segFiles.length - 12} more.</p>}
          </section>
        )}

        {series && (
          <ReferencePanel
            ready={!!store}
            reference={reference?.info}
            show={showReference}
            error={referenceError}
            agreement={agreement}
            onLoad={(file) => void loadReference(file)}
            onShow={setShowReference}
            selected={reference?.selected}
            onSelect={(label) => {
              const seg = reference?.info.segments[label - 1];
              if (!store || !reference || !seg?.voxelCount) return;
              setReference({ ...reference, selected: label, labelmap: segmentLabelmap(store.volume, seg) });
            }}
            onClear={() => setReference(undefined)}
            onGoTo={(k) => viewerRef.current?.goToSlice(k)}
          />
        )}

        {series && <MetadataPanel series={series} current={current} />}

        {skipped.length > 0 && (
          <section className="panel">
            <details>
              <summary>Skipped files ({skipped.length})</summary>
              <ul className="skipped">
                {skipped.slice(0, 200).map((s, i) => (
                  <li key={`${s.relativePath}-${i}`}>
                    <code>{s.relativePath}</code> — {s.reason}
                  </li>
                ))}
                {skipped.length > 200 && <li>…and {skipped.length - 200} more</li>}
              </ul>
            </details>
          </section>
        )}
        <section className="panel about">
          <h2>Data &amp; privacy</h2>
          <p>
            Your scans are read only inside this browser and are never uploaded.
            {import.meta.env.PROD
              ? ' The page’s security policy (CSP) makes the browser block any connection to another server.'
              : ' (Development build: the security policy is applied in production builds.)'}
          </p>
          <p>
            Sample data:{' '}
            <a href="https://doi.org/10.7937/K9/TCIA.2015.U1X8A5NR" target="_blank" rel="noreferrer">
              RIDER Lung CT
            </a>{' '}
            (The Cancer Imaging Archive, CC BY 4.0). Expert outlines:{' '}
            <a href="https://doi.org/10.7937/tcia.2020.jit9grk8" target="_blank" rel="noreferrer">
              RIDER-LungCT-Seg
            </a>
            .
          </p>
          <p className="muted">Research prototype — not a medical device, not for diagnosis.</p>
        </section>
      </aside>

      <main className="main">
        <Toolbar
          disabled={!series}
          measureDisabled={volumeStatus.kind === 'error'}
          leftTool={leftTool}
          voi={viewer.voi}
          brushRadiusMm={brushRadiusMm}
          brush3d={brush3d}
          onLeftTool={setLeftTool}
          onBrushRadius={setBrushRadiusMm}
          onBrush3d={setBrush3d}
          onPreset={(w, c) => viewerRef.current?.setWindow(w, c)}
          onReset={() => viewerRef.current?.resetView()}
        />
        <CtViewport
          ref={viewerRef}
          series={series}
          initialPresetId={DEFAULT_PRESET_ID}
          leftTool={leftTool}
          onStateChange={setViewer}
          onError={setError}
          overlay={overlay}
          onStackReady={onStackReady}
          drawAnnotations={draw}
          annotationVersion={snap.version}
          onPointer={CUSTOM_LEFT_TOOLS.has(leftTool) ? onPointer : undefined}
        />
        <div className="slice-bar">
          <input
            type="range"
            aria-label="Slice"
            min={0}
            max={Math.max(0, (viewer.total || 1) - 1)}
            value={viewer.index}
            disabled={!series || viewer.total < 2}
            onChange={(e) => viewerRef.current?.goToSlice(Number(e.target.value))}
          />
          <span className="slice-bar-label">{series ? `${viewer.index + 1} / ${viewer.total}` : '–'}</span>
        </div>
      </main>

      <FindingsPanel
        header={
          series && (
            <PatientTimeline
              patientId={scanInfo?.patientId ?? ''}
              scans={timeline}
              currentUid={series.seriesInstanceUid}
              timepointOf={timepointOf}
              onOpen={switchSeries}
            />
          )
        }
        scan={scanInfo}
        onTimepoint={setTimepoint}
        onExport={exportCsv}
        onScreenshot={saveScreenshot}
        volume={series ? volumeStatus : { kind: 'none' }}
        findings={snap.findings}
        selected={selectedFinding}
        canUndo={!!store && store.canUndo(snap.selectedId)}
        onSelect={(id) => store?.select(id)}
        onGoTo={goToFinding}
        onApprove={approve}
        onReject={rejectWithUndo}
        onReopen={(id) => store?.reopen(id)}
        onUndo={(id) => store?.undoLast(id)}
        onReset={(id) => store?.resetEdits(id)}
        onDelete={(id) => store?.remove(id)}
        onResegment={(id, thresholdHu) => {
          const r = store?.resegment(id, { thresholdHu });
          if (r && !r.ok) setNotice(r.reason);
        }}
        onFields={(id, patch) => store?.setFields(id, patch)}
        priors={priors}
        suggestion={suggestion}
        onMatch={(id, prior, status) => store?.setMatch(id, { status, prior: { ...prior, thumbnail: prior.thumbnail }, at: Date.now() }, prior.noduleId)}
        onClearMatch={(id) => store?.setMatch(id, undefined)}
        onImport={(file) => void importSheet(file)}
        onLoadAi={(file) => void loadAi(file)}
        typeHint={typeHint}
        lobeHints={lobeHints}
        lobeModel={lobes?.model}
        onGoToPriorPosition={(prior) => {
          if (store && prior.centroidWorld) viewerRef.current?.goToSlice(nearestSlice(store.volume, prior.centroidWorld));
        }}
      />
    </div>
  );
}
