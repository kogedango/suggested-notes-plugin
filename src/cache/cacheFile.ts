import type { PluginSettings } from "../types";
import {
  isUsableMorphologyCache,
  type MorphologyCacheSnapshot,
} from "./morphologyCache";

export const MORPHOLOGY_CACHE_FILENAME = "morphology-cache.json";

// The slice of Obsidian's DataAdapter this module needs. Obsidian's own
// adapter satisfies it structurally; tests supply an in-memory double.
// `remove` is deliberately absent: it only exists from app 1.7.2 and this
// plugin supports 1.4.0, and an obsolete cache is overwritten rather than
// deleted.
export interface CacheFileAdapter {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export function morphologyCachePath(
  manifestDir: string | undefined,
  configDir: string,
  pluginId: string,
): string {
  const dir = manifestDir ?? `${configDir}/plugins/${pluginId}`;
  return `${dir}/${MORPHOLOGY_CACHE_FILENAME}`;
}

// The cache lives outside data.json because `saveData` rewrites its whole
// payload: with the corpus in there, one settings toggle wrote the entire
// vault-sized cache. Nothing here is authoritative — a missing, truncated, or
// stale file is treated exactly like a cold start, and the corpus is rebuilt.
export async function readMorphologyCacheFile(
  adapter: CacheFileAdapter,
  path: string,
  settings: PluginSettings,
): Promise<MorphologyCacheSnapshot | undefined> {
  try {
    if (!(await adapter.exists(path))) return undefined;
    const raw: unknown = JSON.parse(await adapter.read(path));
    return isUsableMorphologyCache(raw, settings) ? raw : undefined;
  } catch (error) {
    // A write interrupted by a quit or crash leaves truncated JSON. Rebuilding
    // is cheap relative to the risk of restoring half a corpus.
    console.error(
      "Suggested Notes: could not read the morphology cache, rebuilding it",
      error,
    );
    return undefined;
  }
}

export async function writeMorphologyCacheFile(
  adapter: CacheFileAdapter,
  path: string,
  cache: MorphologyCacheSnapshot,
): Promise<void> {
  await adapter.write(path, JSON.stringify(cache));
}
