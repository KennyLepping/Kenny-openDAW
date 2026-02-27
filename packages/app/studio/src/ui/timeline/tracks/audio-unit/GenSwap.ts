// You need a list of candidate audio files to cycle through.
// Fill this from whatever your project already uses to reference imported audio files.
// Common patterns in OpenDAW-ish codebases:
// - project.rootBoxAdapter.audioFiles.collection.asArray()
// - project.boxAdapters.audioFiles.values()
// - project.audioFiles.list()
// For now, wire it from a quick one-time snapshot you can verify in console.

import { Arrays } from "@opendaw/lib-std";
import type { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";

type AudioFileLike = any; // replace once you confirm the type (AudioFileBoxAdapter etc.)

const genIndexByRegion = new Map<string, number>();

export function setGenSamplePool(files: ReadonlyArray<AudioFileLike>) {
  (globalThis as any).__GEN_SAMPLE_POOL__ = files;
}

function getGenSamplePool(): ReadonlyArray<AudioFileLike> {
  return (globalThis as any).__GEN_SAMPLE_POOL__ ?? Arrays.empty();
}

function getRegionKey(region: AudioRegionBoxAdapter): string {
  // region.uuid is Uint8Array(16) in your logs; make a stable string key
  // If you already have region.uuidString or region.id, use that instead.
  return Array.from(region.uuid).join(",");
}

function pickNextFile(region: AudioRegionBoxAdapter): AudioFileLike | null {
  const pool = getGenSamplePool();
  if (pool.length === 0) return null;

  const key = getRegionKey(region);
  const nextIndex = ((genIndexByRegion.get(key) ?? -1) + 1) % pool.length;
  genIndexByRegion.set(key, nextIndex);
  return pool[nextIndex];
}

// Try both common assignment shapes:
// A) region.file is a BoxAdapter reference you can replace by setting region.box.fileField (or similar)
// B) region.fileField exists directly
function assignRegionFile(region: AudioRegionBoxAdapter, nextFile: AudioFileLike) {
  // Option A: region has a fileField
  if ((region as any).fileField && typeof (region as any).fileField.setValue === "function") {
    (region as any).fileField.setValue(nextFile);
    return;
  }

  // Option B: region.box has a file field
  const box = (region as any).box;
  if (box?.fileField && typeof box.fileField.setValue === "function") {
    box.fileField.setValue(nextFile);
    return;
  }
  if (box?.file && typeof box.file.setValue === "function") {
    box.file.setValue(nextFile);
    return;
  }

  // Option C: region.file is observable/ref with setValue
  if ((region as any).file && typeof (region as any).file.setValue === "function") {
    (region as any).file.setValue(nextFile);
    return;
  }

  // If none match, dump shape once so you can wire the correct field name.
  console.warn("GEN: can't assign file, inspect region shape:", region, "box:", box);
}

export function genSwapRegionAudio(
  region: AudioRegionBoxAdapter,
  editing: { modify: (fn: () => void) => void },
) {
  const nextFile = pickNextFile(region);
  if (!nextFile) {
    console.warn("GEN: sample pool empty. Call setGenSamplePool([...files]) once.");
    return;
  }

  editing.modify(() => {
    assignRegionFile(region, nextFile);
  });

  console.log("GEN: swapped region", region.uuid, "to file", nextFile);
}