import css from "./RegionLane.sass?inline";
import { Html } from "@opendaw/lib-dom";
import { Lifecycle } from "@opendaw/lib-std";
import { createElement } from "@opendaw/lib-jsx";
import { CanvasPainter } from "@/ui/canvas/painter.ts";
import { Events } from "@opendaw/lib-dom";
import {
  clearSwapMousePos,
  isSwapHovered,
  renderRegions,
  setSwapMousePos,
  hitTestGen, // if you added it
  debugSwapRects, // if you added it
} from "@/ui/timeline/tracks/audio-unit/regions/RegionRenderer.ts";
import { TrackBoxAdapter, TrackType } from "@opendaw/studio-adapters";
import { TracksManager } from "@/ui/timeline/tracks/audio-unit/TracksManager.ts";
import { TimelineRange } from "@opendaw/studio-core";

const className = Html.adoptStyleSheet(css, "RegionLane");
const canvas: HTMLCanvasElement = <canvas />;
const element: HTMLDivElement = (
  <div className={className}>{canvas}</div>
) as any;
// Make it explicit: wrapper gets events, canvas is paint-only.
canvas.style.pointerEvents = "none";

type Construct = {
  lifecycle: Lifecycle;
  trackManager: TracksManager;
  range: TimelineRange;
  adapter: TrackBoxAdapter;
};

export const RegionLane = ({
  lifecycle,
  trackManager,
  range,
  adapter,
}: Construct) => {
  if (adapter.type === TrackType.Undefined) {
    return <div className={Html.buildClassList(className, "deactive")} />;
  }

  let updated = false;
  let visible = false;

  const canvas: HTMLCanvasElement = <canvas />;
  const element: Element = <div className={className}>{canvas}</div>;

  const painter = lifecycle.own(
    new CanvasPainter(canvas, ({ context }) => {
      if (!visible) return;

      renderRegions(context, trackManager, range, adapter.listIndex);
      updated = true;

      element.style.cursor = isSwapHovered(canvas) ? "pointer" : "";
    }),
  );

  const requestUpdate = () => {
    updated = false;
    painter.requestUpdate();
  };

  const toCanvasXY = (e: PointerEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  lifecycle.own(
    Events.subscribe(element, "pointermove", (e: PointerEvent) => {
      if (!visible) return;
      const { x, y } = toCanvasXY(e);
      setSwapMousePos(canvas, x, y);
      requestUpdate(); // hover is decided during paint
    }),
  );

  lifecycle.own(
    Events.subscribe(element, "pointerleave", () => {
      clearSwapMousePos(canvas);
      element.style.cursor = "";
      requestUpdate();
    }),
  );

  lifecycle.own(
    Events.subscribe(element, "pointerdown", (e: PointerEvent) => {
      if (!visible) return;

      const { x, y } = toCanvasXY(e);

      // If you added the debug helpers, these logs will finally show.
      console.log(
        "pointerdown(wrapper)",
        x,
        y,
        "rects",
        debugSwapRects(canvas).count,
      );
      const key = hitTestGen(canvas, x, y);
      console.log("GEN hitTest ->", key);

      if (key) {
        // Important: prevent the DAW drag handlers from stealing the click when GEN is hit.
        e.preventDefault();
        e.stopPropagation();
        console.log("GEN pressed on region:", key);
      }
    }),
  );

  // IMPORTANT: use Events.subscribe (OpenDAW routes pointer events through this system)
  const subDown = lifecycle.own(
    Events.subscribe(canvas, "pointerdown", (e: PointerEvent) => {
      if (!visible) return;

      const { x, y } = toCanvasXY(e);
      console.log("pointerdown", x, y, "rects", debugSwapRects(canvas).count);

      // If rects are empty, we probably clicked before first paint finished.
      // Force a paint and retry once on the next frame.
      if (debugSwapRects(canvas).count === 0) {
        requestUpdate();
        requestAnimationFrame(() => {
          const key = hitTestGen(canvas, x, y);
          console.log("retry hitTestGen ->", key);
          if (key) console.log("GEN pressed on region:", key);
        });
        return;
      }

      const key = hitTestGen(canvas, x, y);
      console.log("hitTestGen ->", key);
      if (key) console.log("GEN pressed on region:", key);
    }),
  );

  // Keep your mousemove if you want hover later
  const subMove = lifecycle.own(
    Events.subscribe(canvas, "pointermove", (e: PointerEvent) => {
      if (!visible) return;
      const { x, y } = toCanvasXY(e);
      setSwapMousePos(canvas, x, y);
      requestUpdate();
    }),
  );

  const subLeave = lifecycle.own(
    Events.subscribe(canvas, "pointerleave", () => {
      clearSwapMousePos(canvas);
      canvas.style.cursor = "";
      requestUpdate();
    }),
  );

  const onMouseMove = (e: MouseEvent) => {
    if (!visible) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setSwapMousePos(canvas, x, y);

    // Hover is decided during paint, so repaint every move
    requestUpdate();
  };

  const onMouseLeave = () => {
    clearSwapMousePos(canvas);
    canvas.style.cursor = "";
    requestUpdate();
  };

  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const state = (window as any).__swapState?.get(canvas);
    if (!state) return;

    for (const r of state.rects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        console.log("GEN pressed on region:", r.key);
        // THIS is where GEN logic goes
        break;
      }
    }
  });

  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseleave", onMouseLeave);

  lifecycle.own({
    terminate: () => {
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onMouseLeave);
    },
  });

  const { timelineFocus } = trackManager.service.project;

  lifecycle.ownAll(
    range.subscribe(requestUpdate),
    adapter.regions.subscribeChanges(requestUpdate),
    adapter.enabled.subscribe(requestUpdate),
    trackManager.service.project.timelineBoxAdapter.catchupAndSubscribeSignature(
      requestUpdate,
    ),
    timelineFocus.track.catchupAndSubscribe((owner) =>
      element.classList.toggle("focused", owner.contains(adapter)),
    ),
    Html.watchIntersection(
      element,
      (entries) =>
        entries.forEach(({ isIntersecting }) => {
          visible = isIntersecting;

          if (!visible) {
            // IMPORTANT: you renamed hover management to mouse-pos based.
            clearSwapMousePos(canvas);
            canvas.style.cursor = "";
            requestUpdate();
            return;
          }

          if (!updated) painter.requestUpdate();
        }),
      { root: trackManager.scrollableContainer },
    ),
  );

  return element;
};
