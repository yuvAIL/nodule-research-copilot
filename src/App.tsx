import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { FileLoader, type ResumeOffer } from './components/FileLoader';
import { MetadataPanel } from './components/MetadataPanel';
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
import { downloadSample, fetchSampleManifest } from './session/sampleData';

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
  const [notice, setNotice] = useState<string>();
  const brushCursor = useRef<{ x: number; y: number } | undefined>(undefined);
  const lastPaint = useRef<{ i: number; j: number; k: number } | undefined>(undefined);
  const snap = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? emptySnapshot);
  const selectedFinding = snap.findings.find((f) => f.id === snap.selectedId);

  const series = allSeries.find((s) => s.seriesInstanceUid === selectedUid);
  const current = series?.instances[viewer.index];

  const buildAbort = useRef<AbortController | undefined>(undefined);

  // A new series invalidates the 3D volume and its findings.
  useEffect(() => {
    buildAbort.current?.abort();
    setStore(undefined);
    setVolumeStatus({ kind: 'none' });
  }, [selectedUid, allSeries]);

  useEffect(() => () => store?.dispose(), [store]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(undefined), 4500);
    return () => window.clearTimeout(t);
  }, [notice]);

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

  const goToFinding = useCallback((f: Finding) => {
    if (f.measurement) viewerRef.current?.goToSlice(f.measurement.sliceIndex);
  }, []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, view: ViewMapper) => {
      if (!store) return;
      const brushing = leftTool === 'brush' || leftTool === 'erase';
      const cursor = brushCursor.current;
      drawAnnotations(ctx, view, {
        labelmap: store.labelmap,
        findings: snap.findings,
        selectedId: snap.selectedId,
        brush: brushing && cursor ? { ...cursor, radiusMm: brushRadiusMm, erase: leftTool === 'erase' } : undefined,
      });
    },
    [store, snap, leftTool, brushRadiusMm],
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
    [store, leftTool, snap.selectedId, brushRadiusMm, brush3d, volumeStatus],
  );

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
      if (key === 'a' && id) store.approve(id);
      else if (key === 'r' && id) store.reject(id);
      else if (key === 'n') {
        // Next finding still to review (wraps around).
        const list = snap.findings;
        if (list.length === 0) return;
        const start = list.findIndex((f) => f.id === id);
        for (let step = 1; step <= list.length; step++) {
          const f = list[(start + step) % list.length] as Finding;
          if (f.status === 'unreviewed' || step === list.length) {
            store.select(f.id);
            goToFinding(f);
            break;
          }
        }
      } else if (key === 'escape') store.select(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, snap, series, brushRadiusMm, goToFinding]);

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
        await loadFiles(files, { kind: 'sample' }, restore);
      } catch (e) {
        setStatus({ kind: 'idle' });
        setError(`Could not load the sample CT: ${errorText(e)}`);
      }
    },
    [loadFiles],
  );

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
      <div className="overlay overlay--br">Wheel/↑↓ slice · middle-drag pan · right-drag zoom</div>
      {notice && (
        <div className="viewport-notice" role="status">
          {notice}
        </div>
      )}
    </>
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Nodule Research Copilot</h1>
        <span className="badge">Research prototype · not for clinical use</span>
      </header>

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
        volume={series ? volumeStatus : { kind: 'none' }}
        findings={snap.findings}
        selected={selectedFinding}
        canUndo={!!store && store.canUndo(snap.selectedId)}
        onSelect={(id) => store?.select(id)}
        onGoTo={goToFinding}
        onApprove={(id) => store?.approve(id)}
        onReject={(id) => store?.reject(id)}
        onReopen={(id) => store?.reopen(id)}
        onUndo={(id) => store?.undoLast(id)}
        onReset={(id) => store?.resetEdits(id)}
        onDelete={(id) => store?.remove(id)}
        onResegment={(id, thresholdHu) => {
          const r = store?.resegment(id, { thresholdHu });
          if (r && !r.ok) setNotice(r.reason);
        }}
        onFields={(id, patch) => store?.setFields(id, patch)}
      />
    </div>
  );
}
