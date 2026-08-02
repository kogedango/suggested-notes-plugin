import type { PluginSettings } from "../types";
import {
  isUsableMorphologyCache,
  type MorphologyCacheSnapshot,
} from "./morphologyCache";

export const MORPHOLOGY_CACHE_FILENAME = "morphology-cache.json";

// The slice of Obsidian's DataAdapter this module needs. Obsidian's own
// adapter satisfies it structurally; tests supply an in-memory double.
// `remove` and `rename` are absent only because nothing here needs them yet:
// an obsolete cache is overwritten rather than deleted. Both are available at
// the declared minAppVersion, so widening this interface is a free change —
// writing to a temporary path and renaming it into place would make a write
// interrupted by a quit leave the previous cache intact.
export interface CacheFileAdapter {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export function morphologyCachePath(
  manifestDir: string | undefined,
  configDir: string,
  pluginId: string,
): string {
  const dir = manifestDir ?? `${configDir}/plugins/${pluginId}`;
  // Joined, not normalized: `obsidian` ships no runtime entry point, so a value
  // import here would break this module's unit tests. The caller passes the
  // result through `normalizePath` before it reaches DataAdapter.
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

const CACHE_WRITE_CHUNK_SIZE = 256 * 1024;

export async function writeMorphologyCacheFileStreaming(
  adapter: CacheFileAdapter,
  path: string,
  header: Pick<MorphologyCacheSnapshot, "version" | "signature">,
  titles: Iterable<MorphologyCacheSnapshot["titles"][number]>,
  bodies: Iterable<MorphologyCacheSnapshot["bodies"][number]>,
): Promise<void> {
  await adapter.write(
    path,
    `{"version":${JSON.stringify(header.version)},"signature":${JSON.stringify(header.signature)},"titles":[`,
  );
  await appendJsonArray(adapter, path, titles);
  await adapter.append(path, `],"bodies":[`);
  await appendJsonArray(adapter, path, bodies);
  await adapter.append(path, "]}");
}

async function appendJsonArray(
  adapter: CacheFileAdapter,
  path: string,
  values: Iterable<unknown>,
): Promise<void> {
  let chunk = "";
  let first = true;
  for (const value of values) {
    const json = `${first ? "" : ","}${JSON.stringify(value)}`;
    first = false;
    if (chunk && chunk.length + json.length > CACHE_WRITE_CHUNK_SIZE) {
      await adapter.append(path, chunk);
      chunk = "";
    }
    if (json.length > CACHE_WRITE_CHUNK_SIZE) {
      await adapter.append(path, json);
    } else {
      chunk += json;
    }
  }
  if (chunk) await adapter.append(path, chunk);
}
