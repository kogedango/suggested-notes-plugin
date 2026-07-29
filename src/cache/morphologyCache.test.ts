import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import {
  MORPHOLOGY_CACHE_VERSION,
  extractLegacyMorphologyCache,
  hasLegacyMorphologyCache,
  isUsableMorphologyCache,
  morphologyCacheSignature,
} from "./morphologyCache";

describe("morphology cache", () => {
  it("invalidates cached tokens when custom vocabulary changes", () => {
    const cache = {
      version: MORPHOLOGY_CACHE_VERSION,
      signature: morphologyCacheSignature(["ヴァイパー"]),
      titles: [],
      bodies: [],
    };

    expect(
      isUsableMorphologyCache(cache, {
        ...DEFAULT_SETTINGS,
        customVocabulary: ["ヴァイパー"],
      }),
    ).toBe(true);
    expect(
      isUsableMorphologyCache(cache, {
        ...DEFAULT_SETTINGS,
        customVocabulary: ["ヴァイパーX"],
      }),
    ).toBe(false);
  });

  it("reuses a cache left in an earlier data.json", () => {
    const legacy = {
      settings: DEFAULT_SETTINGS,
      morphologyCache: {
        version: MORPHOLOGY_CACHE_VERSION,
        signature: morphologyCacheSignature(DEFAULT_SETTINGS.customVocabulary),
        titles: [],
        bodies: [],
      },
    };

    expect(extractLegacyMorphologyCache(legacy, DEFAULT_SETTINGS)).toBe(
      legacy.morphologyCache,
    );
    expect(hasLegacyMorphologyCache(legacy)).toBe(true);
  });

  it("still reports an unusable legacy cache so it can be dropped", () => {
    const legacy = {
      settings: DEFAULT_SETTINGS,
      morphologyCache: { version: 0, signature: "old", titles: [], bodies: [] },
    };

    expect(extractLegacyMorphologyCache(legacy, DEFAULT_SETTINGS)).toBeUndefined();
    expect(hasLegacyMorphologyCache(legacy)).toBe(true);
  });

  it("finds nothing in a settings-only data.json", () => {
    expect(hasLegacyMorphologyCache(DEFAULT_SETTINGS)).toBe(false);
    expect(
      extractLegacyMorphologyCache(DEFAULT_SETTINGS, DEFAULT_SETTINGS),
    ).toBeUndefined();
  });
});
