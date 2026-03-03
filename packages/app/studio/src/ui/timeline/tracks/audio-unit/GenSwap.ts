// GenSwap.ts (patch: make GEN use a passed-in pool, and use PointerField.refer())
// IMPORTANT: PointerField.read()/write() are NOT “get/set value” here.
// read()/write() are serialization methods (need a reader/writer), which is why pf.read() crashes.
//
// The runtime “set pointer” method you DO have is: refer(...)

import type { TracksManager } from "@/ui/timeline/tracks/audio-unit/TracksManager";
import type { AudioFileBoxAdapter } from "@opendaw/studio-adapters";

let GEN_FOLDER_PREFIX: string | null = null;
let GEN_POOL: AudioFileBoxAdapter[] = [];

export const getGenSamplePool = () => GEN_POOL.slice();

export function setGenFolderPrefix(prefix: string | null) {
  GEN_FOLDER_PREFIX = prefix && prefix.length ? prefix : null;
  // re-filter existing pool
  setGenSamplePool(GEN_POOL);
}

const adapterToLabel = (f: any): string => {
  return (
    f?.name ??
    f?.fileName ??
    f?.path ??
    f?.url ??
    f?.box?.name ??
    f?.box?.fileName ??
    f?.box?.path ??
    f?.box?.url ??
    f?.box?.id ??
    ""
  );
};

export const filterByPrefixIfPossible = (
  files: any[],
  prefix: string | null,
) => {
  if (!prefix) return files;
  return files.filter((f) => {
    const label = adapterToLabel(f);
    if (!label) return true;
    return label.includes(prefix);
  });
};

export const setGenSamplePool = (files: AudioFileBoxAdapter[]) => {
  const seen = new Set<any>();
  const out: AudioFileBoxAdapter[] = [];

  for (const f of files ?? []) {
    if (!f) continue;
    const key = (f as any).box ?? f;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }

  GEN_POOL = filterByPrefixIfPossible(out, GEN_FOLDER_PREFIX);

  console.log("GEN pool size:", GEN_POOL.length, GEN_POOL.slice(0, 20));
  (globalThis as any).__genPool = GEN_POOL; // handy debug
};

const genIndexByRegion = new Map<string, number>();
function getRegionKey(region: any): string {
  return region?.uuid ? Array.from(region.uuid).join(",") : String(region);
}

function pickNextFrom(
  pool: readonly AudioFileBoxAdapter[],
  region: any,
): AudioFileBoxAdapter | null {
  if (!pool.length) return null;
  const key = getRegionKey(region);
  const nextIndex = ((genIndexByRegion.get(key) ?? -1) + 1) % pool.length;
  genIndexByRegion.set(key, nextIndex);
  return pool[nextIndex];
}

function assignRegionFile(
  regionAdapter: any,
  nextFileAdapter: AudioFileBoxAdapter,
): boolean {
  const pf = regionAdapter?.box?.file; // PointerField
  const targetBox = (nextFileAdapter as any)?.box;

  if (!pf) {
    console.warn("GEN: region.box.file missing (PointerField not found)");
    return false;
  }
  if (!targetBox) {
    console.warn("GEN: next file adapter has no .box");
    return false;
  }

  // THIS is the correct runtime setter for PointerField in your build:
  if (typeof pf.refer === "function") {
    pf.refer(targetBox);
    return true;
  }

  console.warn("GEN: PointerField has no .refer(). Keys:", Reflect.ownKeys(pf));
  return false;
}

// NEW SIGNATURE: pass pool explicitly to avoid any HMR / duplicate-module weirdness.
export function genSwapRegionAudio(
  region: any,
  editing: any,
  poolOverride?: AudioFileBoxAdapter[],
) {
  const pool = poolOverride ?? GEN_POOL;
  const next = pickNextFrom(pool, region);

  if (!next) {
    console.warn("GEN: pool empty. Import/build pool first.");
    return;
  }

  editing.modify(() => {
    assignRegionFile(region, next);
  });

  console.log("GEN: swapped region file ->", next);
}

export const refreshGenPoolFromRegions = (manager: TracksManager) => {
  const seen = new Set<any>();
  const files: AudioFileBoxAdapter[] = [];

  for (const { trackBoxAdapter } of manager.tracks()) {
    const regions = trackBoxAdapter?.regions?.collection?.asArray?.() ?? [];
    for (const region of regions) {
      // Region adapter has .file as an AudioFileBoxAdapter (your logs confirm this)
      const file = (region as any).file as AudioFileBoxAdapter | undefined;
      if (!file) continue;

      const key = (file as any).box ?? file; // stable identity
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }

  setGenSamplePool(files);

  // Helpful debug: print something string-like if available
  console.log(
    "GEN pool size (from regions):",
    files.length,
    files
      .slice(0, 20)
      .map(
        (f: any) =>
          f?.name ??
          f?.fileName ??
          f?.box?.id ??
          f?.box?.type ??
          f?.constructor?.name,
      ),
  );

  (globalThis as any).__genPool = files;
};
