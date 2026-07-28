import type { PluginSettings } from "../types";
import type { BodyTokenCacheEntry } from "./bodyTokens";
import type { TitleTokenCacheEntry } from "./titleTokens";

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
    Array.isArray(value.bodies)
  );
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
