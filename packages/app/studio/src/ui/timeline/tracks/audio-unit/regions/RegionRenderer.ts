import { int, Iterables, Option, unitValue } from "@opendaw/lib-std";
import { LoopableRegion, ValueEvent } from "@opendaw/lib-dsp";
import {
  AudioRegionBoxAdapter,
  NoteRegionBoxAdapter,
  ValueRegionBoxAdapter,
} from "@opendaw/studio-adapters";
import {
  RegionModifyStrategies,
  RegionModifyStrategy,
  TimeGrid,
  TimelineRange,
} from "@opendaw/studio-core";
import { TracksManager } from "@/ui/timeline/tracks/audio-unit/TracksManager.ts";
import { renderNotes } from "@/ui/timeline/renderer/notes.ts";
import { RegionBound } from "@/ui/timeline/renderer/env.ts";
import { renderAudio } from "@/ui/timeline/renderer/audio.ts";
import { renderFading } from "@/ui/timeline/renderer/fading.ts";
import { renderValueStream } from "@/ui/timeline/renderer/value.ts";
import { Context2d } from "@opendaw/lib-dom";
import { RegionPaintBucket } from "@/ui/timeline/tracks/audio-unit/regions/RegionPaintBucket";
import { RegionLabel } from "@/ui/timeline/RegionLabel";

const SWAP_BTN_SIZE = 12;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawSwapButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  ctx.save();
  // background
  ctx.globalAlpha = 0.22;
  roundRectPath(ctx, x, y, size, size, 3);
  ctx.fill();
  // icon
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.2;

  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.33;

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.2, Math.PI * 1.55, false);
  ctx.stroke();

  const ax = cx + Math.cos(Math.PI * 0.2) * r;
  const ay = cy + Math.sin(Math.PI * 0.2) * r;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - 3, ay + 1);
  ctx.lineTo(ax - 1, ay - 3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

export const renderRegions = (
  context: CanvasRenderingContext2D,
  tracks: TracksManager,
  range: TimelineRange,
  index: int,
): void => {
  const canvas = context.canvas;
  const { width, height } = canvas;
  const { fontFamily } = getComputedStyle(canvas);

  // subtract one pixel to avoid making special cases for a possible outline
  const unitMin = range.unitMin - range.unitPadding - range.unitsPerPixel;
  const unitMax = range.unitMax;

  const dpr = devicePixelRatio;
  const fontSize = RegionLabel.fontSize() * dpr;
  const labelHeight = RegionLabel.labelHeight() * dpr;
  const bound: RegionBound = { top: labelHeight + 1.0, bottom: height - 2.5 };

  context.clearRect(0, 0, width, height);
  context.textBaseline = "middle";
  context.font = `${fontSize}px ${fontFamily}`;

  const grid = true;
  if (grid) {
    const {
      timelineBoxAdapter: { signatureTrack },
    } = tracks.service.project;
    context.fillStyle = "rgba(0, 0, 0, 0.3)";
    TimeGrid.fragment(
      signatureTrack,
      range,
      ({ pulse }) => {
        const x0 = Math.floor(range.unitToX(pulse)) * dpr;
        context.fillRect(x0, 0, dpr, height);
      },
      { minLength: 32 },
    );
  }
  const renderRegions = (
    strategy: RegionModifyStrategy,
    filterSelected: boolean,
    hideSelected: boolean,
  ): void => {
    const optTrack = tracks.getByIndex(strategy.translateTrackIndex(index));
    if (optTrack.isEmpty()) {
      return;
    }
    const trackBoxAdapter = optTrack.unwrap().trackBoxAdapter;
    const trackDisabled = !trackBoxAdapter.enabled.getValue();
    const regions = strategy.iterateRange(
      trackBoxAdapter.regions.collection,
      unitMin,
      unitMax,
    );
    for (const [region, next] of Iterables.pairWise(regions)) {
      let audioLabelStartX: number | null = null;
      if (region.isSelected ? hideSelected : !filterSelected) {
        continue;
      }
      const actualComplete = strategy.readComplete(region);
      const position = strategy.readPosition(region);
      const complete = region.isSelected
        ? actualComplete
        : // for no-stretched audio region
          Math.min(actualComplete, next?.position ?? Number.POSITIVE_INFINITY);
      const x0Int =
        Math.floor(range.unitToX(Math.max(position, unitMin))) * dpr;
      const x1Int = Math.max(
        Math.floor(range.unitToX(Math.min(complete, unitMax)) - 1) * dpr,
        x0Int + dpr,
      );
      const xnInt = x1Int - x0Int;
      const {
        labelColor,
        labelBackground,
        contentColor,
        contentBackground,
        loopStrokeColor,
      } = RegionPaintBucket.create(
        region,
        region.isSelected && !filterSelected,
        trackDisabled,
      );
      context.clearRect(x0Int, 0, xnInt, height);
      context.fillStyle = labelBackground;
      context.fillRect(x0Int, 0, xnInt, labelHeight);
      context.fillStyle = contentBackground;
      context.fillRect(x0Int, labelHeight, xnInt, height - labelHeight);

      context.fillStyle = labelColor;
      if (strategy.readMirror(region)) {
        context.font = `italic ${fontSize}px ${fontFamily}`;
      } else {
        context.font = `${fontSize}px ${fontFamily}`;
      }
      const text = region.label.length === 0 ? "◻" : region.label;

      region.accept({
        visitNoteRegionBoxAdapter: () => {},
        visitValueRegionBoxAdapter: () => {},
        visitAudioRegionBoxAdapter: (ar: AudioRegionBoxAdapter) => {
          const isAudioFileWave = ar.type === "audio-region" && ar.file != null;
          if (!isAudioFileWave) return;

          const btnX = x0Int + 3 * dpr;
          const btnY = 1 + (labelHeight - SWAP_BTN_SIZE) / 2;

          const prevFill = context.fillStyle;
          const prevStroke = context.strokeStyle;
          context.fillStyle = labelColor;
          context.strokeStyle = labelColor;

          drawSwapButton(context, btnX, btnY, SWAP_BTN_SIZE);

          const swapText = "GEN";
          const swapTextX = btnX + SWAP_BTN_SIZE + 4 * dpr;
          context.fillText(swapText, swapTextX, 1 + labelHeight / 2);

          const swapTextWidth = context.measureText(swapText).width;
          const dividerX = swapTextX + swapTextWidth + 4 * dpr;

          context.globalAlpha = 0.4;
          context.fillRect(dividerX, 2 * dpr, dpr, labelHeight - 4 * dpr);
          context.globalAlpha = 1;

          audioLabelStartX = dividerX + 6 * dpr;

          context.fillStyle = prevFill;
          context.strokeStyle = prevStroke;
        },
      });

      const baseLabelX = x0Int + 3 * dpr;
      const labelX = audioLabelStartX ?? baseLabelX;
      const maxLabelTextWidth = Math.max(0, x1Int - labelX - 3 * dpr);

      context.fillText(
        Context2d.truncateText(context, text, maxLabelTextWidth).text,
        labelX,
        1 + labelHeight / 2,
      );

      if (!region.hasCollection) {
        continue;
      }

      context.fillStyle = contentColor;
      region.accept({
        visitNoteRegionBoxAdapter: (region: NoteRegionBoxAdapter): void => {
          for (const pass of LoopableRegion.locateLoops(
            {
              position,
              complete,
              loopOffset: strategy.readLoopOffset(region),
              loopDuration: strategy.readLoopDuration(region),
            },
            unitMin,
            unitMax,
          )) {
            if (pass.index > 0) {
              const x = Math.floor(range.unitToX(pass.resultStart) * dpr);
              context.fillStyle = loopStrokeColor;
              context.fillRect(x, labelHeight, 1, height - labelHeight);
            }
            renderNotes(context, range, region, bound, contentColor, pass);
          }
        },
        visitAudioRegionBoxAdapter: (region: AudioRegionBoxAdapter): void => {
          const g: any = globalThis as any;
          if (!g.__loggedOneAudioRegion_v2) {
            g.__loggedOneAudioRegion_v2 = true;
            console.log("AudioRegionBoxAdapter:", region);
            console.log("Audio file (region.file):", region.file);
            console.log("Track adapter:", region.trackBoxAdapter);
          }
          for (const pass of LoopableRegion.locateLoops(
            {
              position,
              complete,
              loopOffset: strategy.readLoopOffset(region),
              loopDuration: strategy.readLoopDuration(region),
            },
            unitMin,
            unitMax,
          )) {
            if (pass.index > 0) {
              const x = Math.floor(range.unitToX(pass.resultStart) * dpr);
              context.fillStyle = loopStrokeColor;
              context.fillRect(x, labelHeight, 1, height - labelHeight);
            }
            const tempoMap = region.trackBoxAdapter.unwrap().context.tempoMap;
            renderAudio(
              context,
              range,
              region.file,
              tempoMap,
              region.observableOptPlayMode,
              region.waveformOffset.getValue(),
              region.gain.getValue(),
              bound,
              contentColor,
              pass,
            );
          }
          renderFading(
            context,
            range,
            region.fading,
            bound,
            position,
            complete,
            labelBackground,
          );
          const isRecording =
            region.file.getOrCreateLoader().state.type === "record";
          if (isRecording) {
          }
        },
        visitValueRegionBoxAdapter: (region: ValueRegionBoxAdapter) => {
          const padding = dpr;
          const top = labelHeight + padding;
          const bottom = height - padding * 2;
          context.save();
          context.beginPath();
          context.rect(
            x0Int + padding,
            top,
            x1Int - x0Int - padding,
            bottom - top + padding,
          );
          context.clip();
          const valueToY = (value: unitValue): number =>
            bottom + value * (top - bottom);
          const events = region.events.unwrap();
          for (const pass of LoopableRegion.locateLoops(
            {
              position,
              complete,
              loopOffset: strategy.readLoopOffset(region),
              loopDuration: strategy.readLoopDuration(region),
            },
            unitMin,
            unitMax,
          )) {
            if (pass.index > 0) {
              const x = Math.floor(range.unitToX(pass.resultStart) * dpr);
              context.fillStyle = loopStrokeColor;
              context.fillRect(x, labelHeight, 1, height - labelHeight);
            }
            const windowMin = pass.resultStart - pass.rawStart;
            const windowMax = pass.resultEnd - pass.rawStart;
            context.strokeStyle = contentColor;
            context.beginPath();
            const adapters = ValueEvent.iterateWindow(
              events,
              windowMin,
              windowMax,
            );
            renderValueStream(
              context,
              range,
              adapters,
              valueToY,
              contentColor,
              0.2,
              0.0,
              pass,
            );
            context.stroke();
          }
          context.restore();
        },
      });
      const isEditing =
        tracks.service.project.userEditingManager.timeline.isEditing(
          region.box,
        );
      if (isEditing) {
        context.fillStyle = labelBackground;
        context.fillRect(
          x1Int - dpr,
          labelHeight,
          dpr,
          height - labelHeight - dpr,
        );
        context.fillRect(x0Int, labelHeight, dpr, height - labelHeight - dpr);
        context.fillRect(x0Int, height - dpr, xnInt, height - dpr);
      }
    }
  };

  const modifier: Option<RegionModifyStrategies> = tracks.currentRegionModifier;
  const strategy = modifier.unwrapOrElse(RegionModifyStrategies.Identity);

  renderRegions(
    strategy.unselectedModifyStrategy(),
    true,
    !strategy.showOrigin(),
  );
  renderRegions(strategy.selectedModifyStrategy(), false, false);
};
