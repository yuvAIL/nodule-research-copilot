import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Enums, RenderingEngine, type Types } from '@cornerstonejs/core';
import {
  Enums as ToolEnums,
  PanTool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { initCornerstone } from '../cornerstone/initCornerstone';
import { registerSeriesFiles } from '../cornerstone/localImageIds';
import type { CtSeries } from '../dicom/types';
import { getPreset, windowToRange, type VoiRange } from '../viewer/windowPresets';
import type { ViewMapper } from './annotationRenderer';

const RENDERING_ENGINE_ID = 'nrc-rendering-engine';
const VIEWPORT_ID = 'nrc-ct-axial';
const TOOL_GROUP_ID = 'nrc-ct-tools';

const { MouseBindings } = ToolEnums;

export type LeftMouseTool = 'windowLevel' | 'pan' | 'zoom' | 'segment' | 'brush' | 'erase';

/** Left-button modes handled by the app (measurement) instead of Cornerstone tools. */
export const CUSTOM_LEFT_TOOLS: ReadonlySet<LeftMouseTool> = new Set(['segment', 'brush', 'erase']);

export interface ViewPointerEvent {
  kind: 'down' | 'drag' | 'up' | 'hover' | 'leave';
  canvas: [number, number];
  voxel: { i: number; j: number; k: number };
  shiftKey: boolean;
}

export interface ViewerState {
  index: number;
  total: number;
  voi?: VoiRange;
  zoom?: number;
}

export interface CtViewportHandle {
  goToSlice(index: number): void;
  setWindow(width: number, center: number): void;
  resetView(): void;
  /** Redraws the annotation layer (e.g. after a brush-cursor move). */
  redrawAnnotations(): void;
}

interface Props {
  series: CtSeries | undefined;
  initialPresetId: string;
  leftTool: LeftMouseTool;
  onStateChange: (state: ViewerState) => void;
  onError: (message: string) => void;
  /** Read-only information drawn over the image (slice number, window, ...). */
  overlay?: ReactNode;
  /** Called with the stack's imageIds once the first slice is displayed. */
  onStackReady?: (imageIds: string[]) => void;
  /** Draws findings over the image; called on every render and when `annotationVersion` changes. */
  drawAnnotations?: (ctx: CanvasRenderingContext2D, view: ViewMapper) => void;
  annotationVersion?: number;
  /** Mouse input for the custom (measurement) left-button modes. */
  onPointer?: (event: ViewPointerEvent) => void;
  ref?: Ref<CtViewportHandle>;
}

function getStackViewport(engine: RenderingEngine | undefined): Types.IStackViewport | undefined {
  // Cornerstone3D 4.x removed RenderingEngine.getStackViewport(); use getViewport().
  const viewport = engine?.getViewport(VIEWPORT_ID) as Types.IStackViewport | undefined;
  return viewport && typeof viewport.setStack === 'function' ? viewport : undefined;
}

function applyLeftTool(leftTool: LeftMouseTool): void {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) return;

  // Fixed bindings: wheel = scroll, middle = pan, right = zoom.
  // The left button is assignable from the toolbar.
  const bindings: Record<string, { mouseButton: number }[]> = {
    [WindowLevelTool.toolName]: [],
    [PanTool.toolName]: [{ mouseButton: MouseBindings.Auxiliary }],
    [ZoomTool.toolName]: [{ mouseButton: MouseBindings.Secondary }],
  };
  // In measurement modes the app handles the left button itself.
  const leftToolName = (
    {
      windowLevel: WindowLevelTool.toolName,
      pan: PanTool.toolName,
      zoom: ZoomTool.toolName,
    } as Partial<Record<LeftMouseTool, string>>
  )[leftTool];
  if (leftToolName) bindings[leftToolName]?.push({ mouseButton: MouseBindings.Primary });

  for (const [toolName, toolBindings] of Object.entries(bindings)) {
    toolGroup.setToolPassive(toolName, { removeAllBindings: true });
    if (toolBindings.length > 0) toolGroup.setToolActive(toolName, { bindings: toolBindings });
  }
}

export function CtViewport({
  series,
  initialPresetId,
  leftTool,
  onStateChange,
  onError,
  overlay,
  onStackReady,
  drawAnnotations,
  annotationVersion,
  onPointer,
  ref,
}: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seriesRef = useRef(series);
  const drawRef = useRef(drawAnnotations);
  const pointerRef = useRef(onPointer);
  const stackReadyRef = useRef(onStackReady);
  const frameRef = useRef(0);
  const engineRef = useRef<RenderingEngine | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // Keep the latest callbacks without re-running effects.
  const onStateRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onStateRef.current = onStateChange;
    onErrorRef.current = onError;
    seriesRef.current = series;
    drawRef.current = drawAnnotations;
    pointerRef.current = onPointer;
    stackReadyRef.current = onStackReady;
  });

  /** Voxel <-> canvas mapping for the currently displayed slice, from DICOM geometry. */
  const makeMapper = useCallback((): ViewMapper | undefined => {
    const viewport = getStackViewport(engineRef.current);
    const s = seriesRef.current;
    if (!viewport || !s || viewport.getImageIds().length === 0) return undefined;
    const k = viewport.getCurrentImageIdIndex();
    const h = s.instances[k];
    const ipp = h?.imagePositionPatient;
    const iop = h?.imageOrientationPatient;
    const ps = h?.pixelSpacing;
    if (!ipp || !iop || !ps) return undefined;
    const cs = ps[1];
    const rs = ps[0];
    const world = (i: number, j: number): Types.Point3 => [
      ipp[0] + i * cs * iop[0] + j * rs * iop[3],
      ipp[1] + i * cs * iop[1] + j * rs * iop[4],
      ipp[2] + i * cs * iop[2] + j * rs * iop[5],
    ];
    const voxelToCanvas = (i: number, j: number): [number, number] => {
      const c = viewport.worldToCanvas(world(i, j));
      return [c[0], c[1]];
    };
    const p0 = voxelToCanvas(0, 0);
    const p1 = voxelToCanvas(1, 0);
    const pxPerCol = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    return {
      sliceIndex: k,
      voxelToCanvas,
      canvasToVoxel(x, y) {
        const w = viewport.canvasToWorld([x, y]);
        const d = [w[0] - ipp[0], w[1] - ipp[1], w[2] - ipp[2]];
        return {
          i: (d[0]! * iop[0] + d[1]! * iop[1] + d[2]! * iop[2]) / cs,
          j: (d[0]! * iop[3] + d[1]! * iop[4] + d[2]! * iop[5]) / rs,
          k,
        };
      },
      mmPerPx: pxPerCol > 0 ? cs / pxPerCol : 0,
    };
  }, []);

  const drawNow = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const element = elementRef.current;
    if (!canvas || !element) return;
    const dpr = window.devicePixelRatio || 1;
    const w = element.clientWidth;
    const h = element.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const draw = drawRef.current;
    const mapper = makeMapper();
    if (!draw || !mapper) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, mapper);
  }, [makeMapper]);

  const scheduleDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(drawNow);
  }, [drawNow]);

  const publishState = useCallback(() => {
    const viewport = getStackViewport(engineRef.current);
    if (!viewport) return;
    const imageIds = viewport.getImageIds();
    onStateRef.current({
      index: viewport.getCurrentImageIdIndex(),
      total: imageIds.length,
      voi: viewport.getProperties().voiRange,
      zoom: viewport.getZoom(),
    });
  }, []);

  // 1. Create the rendering engine, viewport and tool group once.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let cancelled = false;
    let engine: RenderingEngine | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const events = [Enums.Events.STACK_NEW_IMAGE, Enums.Events.VOI_MODIFIED, Enums.Events.CAMERA_MODIFIED];

    (async () => {
      await initCornerstone();
      if (cancelled) return;

      engine = new RenderingEngine(RENDERING_ENGINE_ID);
      engineRef.current = engine;
      engine.enableElement({
        viewportId: VIEWPORT_ID,
        type: Enums.ViewportType.STACK,
        element,
        defaultOptions: { background: [0, 0, 0] as Types.Point3 },
      });

      if (ToolGroupManager.getToolGroup(TOOL_GROUP_ID)) ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
      const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
      if (!toolGroup) throw new Error('Could not create the Cornerstone tool group.');
      toolGroup.addTool(StackScrollTool.toolName);
      toolGroup.addTool(WindowLevelTool.toolName);
      toolGroup.addTool(PanTool.toolName);
      toolGroup.addTool(ZoomTool.toolName);
      toolGroup.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
      toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID);

      for (const name of events) element.addEventListener(name, publishState);
      element.addEventListener(Enums.Events.IMAGE_RENDERED, scheduleDraw);

      resizeObserver = new ResizeObserver(() => engine?.resize(true, true));
      resizeObserver.observe(element);

      setReady(true);
    })().catch((error: unknown) => {
      if (!cancelled) {
        onErrorRef.current(
          `Failed to initialise Cornerstone3D: ${error instanceof Error ? error.message : String(error)}. ` +
            'The viewer needs a browser with WebGL2 support.',
        );
      }
    });

    return () => {
      cancelled = true;
      setReady(false);
      resizeObserver?.disconnect();
      for (const name of events) element.removeEventListener(name, publishState);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, scheduleDraw);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0; // otherwise later draw requests think one is still queued
      if (ToolGroupManager.getToolGroup(TOOL_GROUP_ID)) ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
      engine?.destroy();
      engineRef.current = undefined;
    };
  }, [publishState, scheduleDraw]);

  // 2. Left-mouse tool selection.
  useEffect(() => {
    if (ready) applyLeftTool(leftTool);
  }, [ready, leftTool]);

  // 3. Load the selected series.
  useEffect(() => {
    if (!ready || !series) return;
    const viewport = getStackViewport(engineRef.current);
    if (!viewport) return;
    let cancelled = false;

    setLoading(true);
    const imageIds = registerSeriesFiles(series);
    const preset = getPreset(initialPresetId);

    viewport
      .setStack(imageIds, 0)
      .then(() => {
        if (cancelled) return;
        viewport.setProperties({ voiRange: windowToRange(preset.width, preset.center) });
        viewport.resetCamera();
        viewport.render();
        publishState();
        stackReadyRef.current?.(imageIds);
        elementRef.current?.focus();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onErrorRef.current(
          `Could not display the first slice: ${error instanceof Error ? error.message : String(error)}. ` +
            'The transfer syntax may be unsupported or the file may be corrupt.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, series, initialPresetId, publishState]);

  // 4. Redraw annotations when the app's findings change.
  useEffect(() => {
    scheduleDraw();
  }, [annotationVersion, scheduleDraw]);

  // 5. Mouse input for measurement modes (segment / brush / erase).
  const custom = CUSTOM_LEFT_TOOLS.has(leftTool);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !custom) return;
    const emit = (kind: ViewPointerEvent['kind'], e: MouseEvent) => {
      const mapper = makeMapper();
      if (!mapper) return;
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      pointerRef.current?.({ kind, canvas: [x, y], voxel: mapper.canvasToVoxel(x, y), shiftKey: e.shiftKey });
    };
    let dragging = false;
    const onMove = (e: MouseEvent) => emit(dragging ? 'drag' : 'hover', e);
    const onUp = (e: MouseEvent) => {
      if (!dragging) return;
      dragging = false;
      emit('up', e);
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      element.focus();
      dragging = true;
      emit('down', e);
    };
    const onLeave = (e: MouseEvent) => {
      if (!dragging) emit('leave', e);
    };
    element.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    element.addEventListener('mouseleave', onLeave);
    return () => {
      element.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      element.removeEventListener('mouseleave', onLeave);
    };
  }, [custom, makeMapper]);

  const goToSlice = useCallback((index: number) => {
    const viewport = getStackViewport(engineRef.current);
    if (!viewport) return;
    const last = viewport.getImageIds().length - 1;
    if (last < 0) return;
    const target = Math.max(0, Math.min(last, Math.round(index)));
    if (target !== viewport.getCurrentImageIdIndex()) {
      viewport.setImageIdIndex(target).catch((error: unknown) => {
        onErrorRef.current(`Could not load slice ${target + 1}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      goToSlice,
      setWindow(width, center) {
        const viewport = getStackViewport(engineRef.current);
        if (!viewport) return;
        viewport.setProperties({ voiRange: windowToRange(width, center) });
        viewport.render();
        publishState();
      },
      resetView() {
        const viewport = getStackViewport(engineRef.current);
        if (!viewport) return;
        viewport.resetCamera();
        viewport.render();
        publishState();
      },
      redrawAnnotations: scheduleDraw,
    }),
    [goToSlice, publishState, scheduleDraw],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = getStackViewport(engineRef.current);
    if (!viewport) return;
    const current = viewport.getCurrentImageIdIndex();
    const total = viewport.getImageIds().length;
    const page = Math.max(1, Math.round(total / 10));
    const moves: Record<string, number> = {
      ArrowUp: current - 1,
      ArrowLeft: current - 1,
      ArrowDown: current + 1,
      ArrowRight: current + 1,
      PageUp: current - page,
      PageDown: current + page,
      Home: 0,
      End: total - 1,
    };
    const target = moves[event.key];
    if (target !== undefined) {
      event.preventDefault();
      goToSlice(target);
    }
  };

  return (
    <div className="viewport-wrapper">
      <div
        ref={elementRef}
        className={`viewport-element${custom ? ` viewport-element--${leftTool}` : ''}`}
        tabIndex={0}
        aria-label="CT slice viewer. Scroll or use arrow keys to change slice."
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas ref={canvasRef} className="annotation-layer" aria-hidden="true" />
      {series && overlay}
      {!series && ready && <div className="viewport-placeholder">Load a DICOM CT series to begin</div>}
      {!ready && <div className="viewport-placeholder">Initialising viewer…</div>}
      {loading && <div className="viewport-loading">Loading slices…</div>}
    </div>
  );
}
