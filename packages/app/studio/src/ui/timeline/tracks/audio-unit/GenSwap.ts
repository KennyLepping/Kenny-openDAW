import { Arrays } from "@opendaw/lib-std";
import type { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";

type AudioFileLike = any;

let pool: ReadonlyArray<AudioFileLike> = Arrays.empty();
const genIndexByRegion = new Map<string, number>();

// Optional: set this to only use samples from a "folder"
let folderPrefix: string | null = null;

export function setGenFolderPrefix(prefix: string | null) {
  folderPrefix = prefix && prefix.length ? prefix : null;
}

export function setGenSamplePool(files: ReadonlyArray<AudioFileLike>) {
  pool = files;
}

function getRegionKey(region: AudioRegionBoxAdapter): string {
  return Array.from(region.uuid).join(",");
}

function filePathLike(f: any): string {
  return (f.filePath ?? f.path ?? f.url ?? f.name ?? f.label ?? "").toString();
}

function getFilteredPool(): ReadonlyArray<AudioFileLike> {
  if (!folderPrefix) return pool;
  return pool.filter((f) => filePathLike(f).includes(folderPrefix));
}

function pickNextFile(region: AudioRegionBoxAdapter): AudioFileLike | null {
  const p = getFilteredPool();
  if (p.length === 0) return null;

  const key = getRegionKey(region);
  const nextIndex = ((genIndexByRegion.get(key) ?? -1) + 1) % p.length;
  genIndexByRegion.set(key, nextIndex);
  return p[nextIndex];
}

function assignRegionFile(
  region: AudioRegionBoxAdapter,
  nextFile: AudioFileLike,
) {
  const r: any = region;
  if (r.fileField?.setValue) return r.fileField.setValue(nextFile);

  const box = r.box;
  if (box?.fileField?.setValue) return box.fileField.setValue(nextFile);
  if (box?.file?.setValue) return box.file.setValue(nextFile);

  if (r.file?.setValue) return r.file.setValue(nextFile);

  console.warn("GEN: can't assign file. Inspect region:", region, "box:", box);
}

export function genSwapRegionAudio(
  region: AudioRegionBoxAdapter,
  editing: { modify: (fn: () => void) => void },
) {
  const nextFile = pickNextFile(region);
  if (!nextFile) {
    console.warn("GEN: pool empty (or folder filter matched nothing).");
    console.log("GEN pool size:", pool.length);
    return;
  }
  console.log("GEN pool sample:", pool[0]);
  console.log("GEN pool keys:", pool[0] ? Object.keys(pool[0]) : "empty");
  console.log("GEN pool path candidates:", {
    path: (pool[0] as any)?.path,
    filePath: (pool[0] as any)?.filePath,
    url: (pool[0] as any)?.url,
    name: (pool[0] as any)?.name,
    label: (pool[0] as any)?.label,
  });
  editing.modify(() => assignRegionFile(region, nextFile));
  console.log("GEN: swapped", Array.from(region.uuid), "to", nextFile);
  console.log(
    "GEN filtered size:",
    getFilteredPool().length,
    "prefix:",
    folderPrefix,
  );
}
