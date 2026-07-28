import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import {
  MORPHOLOGY_CACHE_VERSION,
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
});
