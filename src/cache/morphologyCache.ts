import type { PluginSettings } from "../types";
import {
  isBodyTokenCacheEntry,
  type BodyTokenCacheEntry,
} from "./bodyTokens";
import {
  isTitleTokenCacheEntry,
  type TitleTokenCacheEntry,
} from "./titleTokens";

// Bump when canonical tokenization or serialization changes.
export const MORPHOLOGY_CACHE_VERSION = 2;
const ANALYZER_REVISION =
  "kuromoji-ipadic-cross-lane-compounds-wink-custom-v5";

export interface MorphologyCacheSnapshot {
  version: number;
  signature: string;
  titles: TitleTokenCacheEntry[];
  bodies: BodyTokenCacheEntry[];
}

// The shape data.json had while the cache still travelled with
// the settings. Current versions write the settings object alone and keep the
// cache in its own file; this type exists to read the old layout.
export interface PersistedPluginData {
  settings: PluginSettings;
  morphologyCache?: MorphologyCacheSnapshot;
}

export function morphologyCacheSignature(
  customVocabulary: string[],
): string {
  return JSON.stringify([ANALYZER_REVISION, customVocabulary]);
}

export function isUsableMorphologyCache(
  value: unknown,
  settings: PluginSettings,
): value is MorphologyCacheSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.version === MORPHOLOGY_CACHE_VERSION &&
    value.signature === morphologyCacheSignature(settings.customVocabulary) &&
    Array.isArray(value.titles) &&
    value.titles.every(isTitleTokenCacheEntry) &&
    Array.isArray(value.bodies) &&
    value.bodies.every(isBodyTokenCacheEntry)
  );
}

// An upgrade from that layout reuses the cache already sitting in
// data.json instead of forcing a rebuild. The next flush writes it to the
// cache file and rewrites data.json without it.
export function extractLegacyMorphologyCache(
  raw: unknown,
  settings: PluginSettings,
): MorphologyCacheSnapshot | undefined {
  if (!isPersistedPluginData(raw)) return undefined;
  return isUsableMorphologyCache(raw.morphologyCache, settings)
    ? raw.morphologyCache
    : undefined;
}

// True while data.json still carries a cache — including an unusable one, which
// is exactly the copy worth dropping.
export function hasLegacyMorphologyCache(raw: unknown): boolean {
  return isPersistedPluginData(raw) && raw.morphologyCache !== undefined;
}

export function isPersistedPluginData(
  value: unknown,
): value is Record<string, unknown> & {
  settings: Record<string, unknown>;
  morphologyCache?: unknown;
} {
  return isRecord(value) && isRecord(value.settings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
