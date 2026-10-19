import { WINDOW_PRESETS, matchPreset, rangeToWindow, type VoiRange } from '../viewer/windowPresets';
import type { LeftMouseTool } from './CtViewport';

interface Props {
  disabled: boolean;
  measureDisabled: boolean;
  leftTool: LeftMouseTool;
  voi: VoiRange | undefined;
  brushRadiusMm: number;
  brush3d: boolean;
  onLeftTool: (tool: LeftMouseTool) => void;
  onBrushRadius: (mm: number) => void;
  onBrush3d: (on: boolean) => void;
  onPreset: (width: number, center: number) => void;
  onReset: () => void;
}

const VIEW_TOOLS: { id: LeftMouseTool; label: string; key: string }[] = [
  { id: 'windowLevel', label: 'Window/Level', key: 'W' },
  { id: 'pan', label: 'Pan', key: 'P' },
  { id: 'zoom', label: 'Zoom', key: 'Z' },
];

const MEASURE_TOOLS: { id: LeftMouseTool; label: string; key: string; title: string }[] = [
  { id: 'segment', label: 'Click nodule', key: 'S', title: 'Click inside a nodule to outline and measure it in 3D' },
  { id: 'brush', label: 'Brush', key: 'B', title: 'Add to the selected outline (or draw a new one)' },
  { id: 'erase', label: 'Erase', key: 'E', title: 'Remove from the selected outline' },
];

export const BRUSH_SIZES_MM = [1.5, 3, 5, 8, 12];

export function Toolbar(props: Props) {
  const { disabled, measureDisabled, leftTool, voi } = props;
  const active = voi ? matchPreset(voi) : undefined;
  const custom = voi && !active ? rangeToWindow(voi) : undefined;
  const brushing = leftTool === 'brush' || leftTool === 'erase';

  return (
    <div className="toolbar" role="toolbar">
      <div className="toolbar-group" aria-label="Measure">
        <span className="toolbar-label">Measure</span>
        {MEASURE_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled || measureDisabled}
            aria-pressed={leftTool === t.id}
            className={leftTool === t.id ? 'active measure' : 'measure'}
            title={`${t.title} (${t.key})`}
            onClick={() => props.onLeftTool(t.id)}
          >
            {t.label} <kbd>{t.key}</kbd>
          </button>
        ))}
        {brushing && (
          <select
            aria-label="Brush size"
            value={props.brushRadiusMm}
            onChange={(e) => props.onBrushRadius(Number(e.target.value))}
            title="Brush radius ( [ and ] )"
          >
            {BRUSH_SIZES_MM.map((r) => (
              <option key={r} value={r}>
                ⌀ {r * 2} mm
              </option>
            ))}
          </select>
        )}
        {brushing && (
          <label className="toggle" title="Also apply to neighbouring slices within the brush radius (a sphere)">
            <input type="checkbox" checked={props.brush3d} onChange={(e) => props.onBrush3d(e.target.checked)} />
            3D
          </label>
        )}
      </div>
      <div className="toolbar-group" aria-label="Left mouse button">
        <span className="toolbar-label">View</span>
        {VIEW_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            aria-pressed={leftTool === t.id}
            className={leftTool === t.id ? 'active' : ''}
            onClick={() => props.onLeftTool(t.id)}
            title={`${t.label} (${t.key})`}
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
            onClick={() => props.onPreset(p.width, p.center)}
          >
            {p.label}
          </button>
        ))}
        {custom && (
          <span className="toolbar-custom">
            W {Math.round(custom.width)} / L {Math.round(custom.center)}
          </span>
        )}
        <button type="button" disabled={disabled} onClick={props.onReset}>
          Reset view
        </button>
      </div>
    </div>
  );
}
