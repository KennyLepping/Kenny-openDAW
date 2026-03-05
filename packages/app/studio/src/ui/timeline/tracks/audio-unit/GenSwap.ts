// GenSwap.ts (drop-in version)
// - Keeps your pool + filtering
// - Adds "replace region" (create new region at same position, assign file, delete old)
// - No assumptions about private #value fields

import type { TracksManager } from "@/ui/timeline/tracks/audio-unit/TracksManager";
import type { AudioFileBoxAdapter } from "@opendaw/studio-adapters";

/** How we decide "this file is generated" */
export type GenFilterMode =
  | { kind: "prefix"; prefix: string } // checks path-like label (if present)
  | { kind: "nameStartsWith"; prefix: string } // checks fileName (best for your current data)
  | { kind: "nameIncludes"; token: string } // checks fileName contains
  | { kind: "tag"; tag: string }; // checks box.tags contains (if tags exist)

let GEN_FOLDER_PREFIX: string | null = null;
let GEN_MODE: GenFilterMode | null = null;
let GEN_SOURCE_TRACK_NAME: string | null = null;

let GEN_POOL: AudioFileBoxAdapter[] = [];
const genIndexByRegion = new Map<string, number>();

let lastLoggedN = -1;
function logPool() {
  if (GEN_POOL.length === lastLoggedN) return;
  lastLoggedN = GEN_POOL.length;
  console.log("GEN_POOL set:", {
    n: GEN_POOL.length,
    prefix: GEN_FOLDER_PREFIX,
    mode: GEN_MODE,
    sourceTrack: GEN_SOURCE_TRACK_NAME,
    sample: GEN_POOL.slice(0, 8).map((a) => fileNameOf(a) || adapterToLabel(a)),
  });
}

export const getGenSamplePool = () => GEN_POOL.slice();
export const clearGenSamplePool = () => setGenSamplePool([]);
export const getGenFolderPrefix = () => GEN_FOLDER_PREFIX;

export function setGenFolderPrefix(prefix: string | null) {
  GEN_FOLDER_PREFIX = prefix && prefix.length ? prefix : null;
  setGenSamplePool(getGenSamplePool());
  (globalThis as any).__genFolderPrefix = GEN_FOLDER_PREFIX;
}

export function setGenFilterMode(mode: GenFilterMode | null) {
  GEN_MODE = mode;
  setGenSamplePool(getGenSamplePool());
  (globalThis as any).__genFilterMode = GEN_MODE;
}

export function setGenSourceTrackName(name: string | null) {
  GEN_SOURCE_TRACK_NAME = name && name.length ? name : null;
  // don't mutate pool here; it is rebuilt by refreshGenPoolFromRegions anyway
  (globalThis as any).__genSourceTrackName = GEN_SOURCE_TRACK_NAME;
}

function fileNameOf(a: any): string {
  try {
    const v =
      a?.fileName?.getValue?.() ??
      a?.fileName ??
      a?.name?.getValue?.() ??
      a?.name ??
      "";
    return String(v);
  } catch {
    return "";
  }
}

function labelOf(a: any): string {
  try {
    const v =
      a?.url?.getValue?.() ??
      a?.path?.getValue?.() ??
      a?.filePath?.getValue?.() ??
      a?.label?.getValue?.() ??
      a?.url ??
      a?.path ??
      a?.filePath ??
      a?.label ??
      "";
    return String(v);
  } catch {
    return "";
  }
}

function tagsOf(a: any): string[] {
  const t = a?.box?.tags;
  if (!t) return [];
  if (Array.isArray(t)) return t.map(String);

  const tv = (t as any).getValue?.();
  if (Array.isArray(tv)) return tv.map(String);
  if (tv instanceof Set) return Array.from(tv).map(String);

  if (t instanceof Set) return Array.from(t).map(String);
  return [];
}

function adapterToLabel(f: any): string {
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
}

function isGenerated(a: AudioFileBoxAdapter): boolean {
  if (GEN_MODE) {
    if (GEN_MODE.kind === "nameStartsWith") {
      return fileNameOf(a)
        .toLowerCase()
        .startsWith(GEN_MODE.prefix.toLowerCase());
    }
    if (GEN_MODE.kind === "nameIncludes") {
      return fileNameOf(a).toLowerCase().includes(GEN_MODE.token.toLowerCase());
    }
    if (GEN_MODE.kind === "prefix") {
      const lbl = labelOf(a);
      if (!lbl) return false;
      return lbl.includes(GEN_MODE.prefix);
    }
    if (GEN_MODE.kind === "tag") {
      const tags = tagsOf(a).map((x) => x.toLowerCase());
      return tags.includes(GEN_MODE.tag.toLowerCase());
    }
  }

  if (GEN_FOLDER_PREFIX) {
    const lbl = labelOf(a);
    if (!lbl) return true; // fail-open (keeps pool from being nuked if label missing)
    return lbl.includes(GEN_FOLDER_PREFIX);
  }

  return true;
}

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

  GEN_POOL = out.filter(isGenerated);

  (globalThis as any).__genPool = GEN_POOL;
  (globalThis as any).__genFolderPrefix = GEN_FOLDER_PREFIX;

  logPool();
};

export const refreshGenPoolFromRegions = (manager: TracksManager) => {
  const seen = new Set<any>();
  const files: AudioFileBoxAdapter[] = [];

  // Optional: narrow pool to a specific track name (best-effort, since TrackBox name is not obvious)
  const wantName = GEN_SOURCE_TRACK_NAME?.toLowerCase() ?? null;

  for (const { trackBoxAdapter } of manager.tracks()) {
    const trackName =
      (trackBoxAdapter as any)?.name?.getValue?.() ??
      (trackBoxAdapter as any)?.name ??
      (trackBoxAdapter as any)?.box?.name?.getValue?.() ??
      (trackBoxAdapter as any)?.box?.name ??
      "";

    const isWanted =
      !wantName ||
      (String(trackName).toLowerCase() === wantName ||
        String(trackName).toLowerCase().includes(wantName));

    if (!isWanted) continue;

    for (const region of trackBoxAdapter.regions.collection.asArray()) {
      const file = (region as any).file as AudioFileBoxAdapter | undefined;
      if (!file) continue;

      const key = (file as any).box ?? file;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }

  setGenSamplePool(files);
  console.log("refreshGenPoolFromRegions ->", files.length, {
    sourceTrack: GEN_SOURCE_TRACK_NAME,
  });
};

function getRegionKey(region: any): string {
  // stable per region adapter instance
  return region?.uuid ? String(region.uuid) : String(region);
}

function pickNextAdapter(region: any): AudioFileBoxAdapter | null {
  if (!GEN_POOL.length) return null;
  const key = getRegionKey(region);
  const nextIndex = ((genIndexByRegion.get(key) ?? -1) + 1) % GEN_POOL.length;
  genIndexByRegion.set(key, nextIndex);
  return GEN_POOL[nextIndex];
}

function findOwningTrackBoxAdapter(manager: TracksManager, region: any): any | null {
  for (const { trackBoxAdapter } of manager.tracks()) {
    const regions = trackBoxAdapter.regions.collection.asArray();
    if (regions.includes(region)) return trackBoxAdapter;
  }
  return null;
}

/**
 * Replace region on timeline:
 * - create a NEW region at same position with same duration
 * - assign file pointer to next.box
 * - delete original region
 */
export function genReplaceRegionWithNextSample(
  region: any,
  manager: TracksManager,
  project: any,
  editing: any,
  selection?: any,
) {
  const next = pickNextAdapter(region);
  if (!next) {
    console.warn("GEN: pool empty. Build pool first.");
    return;
  }

  const trackBoxAdapter = findOwningTrackBoxAdapter(manager, region);
  if (!trackBoxAdapter) {
    console.warn("GEN: couldn't find owning track for region");
    return;
  }

  const position = region.position;
  const duration = region.duration ?? (region.complete - region.position);

  editing.modify(() => {
    project.api
      .createTrackRegion(trackBoxAdapter.box, position, duration)
      .ifSome((newRegion: any) => {
        // assign file pointer on the NEW region (this is the important part)
        newRegion.box?.file?.accept?.(next.box);

        // select new region if selection passed in
        selection?.select?.(newRegion);

        // now delete old
        region.box?.delete?.();
      });
  });

  console.log("GEN: replaced region with:", fileNameOf(next) || adapterToLabel(next));
}

// devtools helpers (optional)
(globalThis as any).setGenFilterMode = setGenFilterMode;
(globalThis as any).setGenFolderPrefix = setGenFolderPrefix;
(globalThis as any).setGenSourceTrackName = setGenSourceTrackName;
(globalThis as any).refreshGenPoolFromRegions = refreshGenPoolFromRegions;
(globalThis as any).getGenSamplePool = getGenSamplePool;
(globalThis as any).clearGenSamplePool = clearGenSamplePool;