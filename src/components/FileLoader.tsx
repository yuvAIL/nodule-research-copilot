import { useRef, useState, type DragEvent } from 'react';
import { fromDataTransfer, fromFileList } from '../dicom/collectFiles';
import type { LocalFile } from '../dicom/parseHeader';
import {
  directoryHandleFromDrop,
  pickDirectory,
  supportsDirectoryHandles,
  type DirHandle,
} from '../session/folderAccess';

export interface ResumeOffer {
  title: string;
  detail: string;
  /** Undefined when the source cannot be re-opened automatically. */
  onResume?: () => void;
  onDismiss: () => void;
}

interface Props {
  disabled: boolean;
  /** Files without a re-openable folder handle (file input, older browsers). */
  onFiles: (files: LocalFile[], name: string) => void;
  /** A folder opened through the File System Access API (re-openable after reload). */
  onFolder: (handle: DirHandle) => void;
  onLoadSample: () => void;
  /** undefined while checking, false when no sample is deployed with this build. */
  sampleAvailable: boolean | undefined;
  resume?: ResumeOffer;
  onError: (message: string) => void;
}

function nameOf(files: LocalFile[]): string {
  const first = files[0]?.relativePath ?? '';
  return first.includes('/') ? (first.split('/')[0] ?? 'selected files') : `${files.length} file(s)`;
}

/** Open a local CT folder, individual files, a dropped folder, or the public sample. Nothing is uploaded. */
export function FileLoader({ disabled, onFiles, onFolder, onLoadSample, sampleAvailable, resume, onError }: Props) {
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openFolder = async () => {
    if (!supportsDirectoryHandles()) {
      folderInput.current?.click();
      return;
    }
    try {
      const handle = await pickDirectory();
      if (handle) onFolder(handle);
    } catch (error) {
      onError(`Could not open the folder: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    // Both calls read the DataTransfer synchronously, before it is cleared.
    const handlePromise = directoryHandleFromDrop(event.dataTransfer);
    const filesPromise = fromDataTransfer(event.dataTransfer);
    void (async () => {
      const handle = await handlePromise;
      if (handle) {
        onFolder(handle);
        return;
      }
      const files = await filesPromise;
      onFiles(files, nameOf(files));
    })().catch((error: unknown) =>
      onError(`Could not read the dropped items: ${error instanceof Error ? error.message : String(error)}`),
    );
  };

  return (
    <section className="panel">
      <h2>Load CT series</h2>

      {resume && (
        <div className="resume">
          <div className="resume-title">{resume.title}</div>
          <div className="resume-detail">{resume.detail}</div>
          <div className="button-row button-row--start">
            {resume.onResume && (
              <button type="button" className="primary" disabled={disabled} onClick={resume.onResume}>
                Reopen
              </button>
            )}
            <button type="button" onClick={resume.onDismiss}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div
        className={`dropzone${dragging ? ' dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <p>Drop a DICOM folder or files here</p>
        <div className="button-row">
          <button type="button" disabled={disabled} onClick={() => void openFolder()}>
            Open CT folder…
          </button>
          <button type="button" disabled={disabled} onClick={() => filesInput.current?.click()}>
            Open files…
          </button>
        </div>
        <p className="hint">Your scans are read locally in this browser — nothing is uploaded.</p>
      </div>

      <div className="sample-row">
        <button
          type="button"
          disabled={disabled || sampleAvailable !== true}
          onClick={onLoadSample}
          title={sampleAvailable === false ? 'No sample CT is deployed with this build.' : 'Public RIDER Lung CT sample (TCIA)'}
        >
          Load sample CT
        </button>
        <span className="hint">
          {sampleAvailable === false ? 'Sample not available in this build' : 'Public de-identified scan (TCIA)'}
        </span>
      </div>

      <input
        ref={folderInput}
        type="file"
        hidden
        multiple
        // Fallback for browsers without the File System Access API.
        {...{ webkitdirectory: '', directory: '' }}
        onChange={(e) => {
          const files = fromFileList(e.currentTarget.files);
          onFiles(files, nameOf(files));
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={filesInput}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = fromFileList(e.currentTarget.files);
          onFiles(files, nameOf(files));
          e.currentTarget.value = '';
        }}
      />
    </section>
  );
}
