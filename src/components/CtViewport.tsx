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

const RENDERING_ENGINE_ID = 'nrc-rendering-engine';
const VIEWPORT_ID = 'nrc-ct-axial';
const TOOL_GROUP_ID = 'nrc-ct-tools';

const { MouseBindings } = ToolEnums;

export type LeftMouseTool = 'windowLevel' | 'pan' | 'zoom';

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
}

interface Props {
  series: CtSeries | undefined;
  initialPresetId: string;
  leftTool: LeftMouseTool;
  onStateChange: (state: ViewerState) => void;
  onError: (message: string) => void;
  /** Read-only information drawn over the image (slice number, window, ...). */
  overlay?: ReactNode;
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
  const leftToolName = {
    windowLevel: WindowLevelTool.toolName,
    pan: PanTool.toolName,
    zoom: ZoomTool.toolName,
  }[leftTool];
  bindings[leftToolName]?.push({ mouseButton: MouseBindings.Primary });

  for (const [toolName, toolBindings] of Object.entries(bindings)) {
    toolGroup.setToolPassive(toolName, { removeAllBindings: true });
    if (toolBindings.length > 0) toolGroup.setToolActive(toolName, { bindings: toolBindings });
  }
}

export function CtViewport({ series, initialPresetId, leftTool, onStateChange, onError, overlay, ref }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RenderingEngine | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // Keep the latest callbacks without re-running effects.
  const onStateRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onStateRef.current = onStateChange;
    onErrorRef.current = onError;
  });

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
      if (ToolGroupManager.getToolGroup(TOOL_GROUP_ID)) ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
      engine?.destroy();
      engineRef.current = undefined;
    };
  }, [publishState]);

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
    }),
    [goToSlice, publishState],
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
        className="viewport-element"
        tabIndex={0}
        aria-label="CT slice viewer. Scroll or use arrow keys to change slice."
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      />
      {series && overlay}
      {!series && ready && <div className="viewport-placeholder">Load a DICOM CT series to begin</div>}
      {!ready && <div className="viewport-placeholder">Initialising viewer…</div>}
      {loading && <div className="viewport-loading">Loading slices…</div>}
    </div>
  );
}
