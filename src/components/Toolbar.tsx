import { WINDOW_PRESETS, matchPreset, rangeToWindow, type VoiRange } from '../viewer/windowPresets';
import type { LeftMouseTool } from './CtViewport';

interface Props {
  disabled: boolean;
  leftTool: LeftMouseTool;
  voi: VoiRange | undefined;
  onLeftTool: (tool: LeftMouseTool) => void;
  onPreset: (width: number, center: number) => void;
  onReset: () => void;
}

const TOOLS: { id: LeftMouseTool; label: string }[] = [
  { id: 'windowLevel', label: 'Window/Level' },
  { id: 'pan', label: 'Pan' },
  { id: 'zoom', label: 'Zoom' },
];

export function Toolbar({ disabled, leftTool, voi, onLeftTool, onPreset, onReset }: Props) {
  const active = voi ? matchPreset(voi) : undefined;
  const custom = voi && !active ? rangeToWindow(voi) : undefined;

  return (
    <div className="toolbar" role="toolbar">
      <div className="toolbar-group" aria-label="Left mouse button">
        <span className="toolbar-label">Left drag</span>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            aria-pressed={leftTool === t.id}
            className={leftTool === t.id ? 'active' : ''}
            onClick={() => onLeftTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="toolbar-group" aria-label="Window presets">
        <span className="toolbar-label">Window</span>
        {WINDOW_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            aria-pressed={active?.id === p.id}
            className={active?.id === p.id ? 'active' : ''}
            title={`W ${p.width} / L ${p.center}`}
            onClick={() => onPreset(p.width, p.center)}
          >
            {p.label}
          </button>
        ))}
        {custom && (
          <span className="toolbar-custom">
            Custom W {Math.round(custom.width)} / L {Math.round(custom.center)}
          </span>
        )}
      </div>
      <div className="toolbar-group">
        <button type="button" disabled={disabled} onClick={onReset}>
          Reset view
        </button>
      </div>
      <div className="toolbar-help">Wheel / ↑↓: slice · Middle drag: pan · Right drag: zoom</div>
    </div>
  );
}
