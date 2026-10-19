import { useCallback, useEffect, useRef, useState } from 'react';
import { CtViewport, type CtViewportHandle, type LeftMouseTool, type ViewerState } from './components/CtViewport';
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

  const series = allSeries.find((s) => s.seriesInstanceUid === selectedUid);
  const current = series?.instances[viewer.index];

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
          leftTool={leftTool}
          voi={viewer.voi}
          onLeftTool={setLeftTool}
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
    </div>
  );
}
