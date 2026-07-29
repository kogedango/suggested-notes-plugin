import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import {
  MORPHOLOGY_CACHE_FILENAME,
  morphologyCachePath,
  readMorphologyCacheFile,
  writeMorphologyCacheFile,
  type CacheFileAdapter,
} from "./cacheFile";
import {
  MORPHOLOGY_CACHE_VERSION,
  morphologyCacheSignature,
} from "./morphologyCache";

function adapter(files: Record<string, string> = {}): CacheFileAdapter & {
  files: Record<string, string>;
} {
  return {
    files,
    async exists(path) {
      return path in files;
    },
    async read(path) {
      const content = files[path];
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    async write(path, data) {
      files[path] = data;
    },
  };
}

const cache = {
  version: MORPHOLOGY_CACHE_VERSION,
  signature: morphologyCacheSignature(DEFAULT_SETTINGS.customVocabulary),
  titles: [{ path: "a.md", tokens: ["alpha"] }],
  bodies: [
    { path: "a.md", mtime: 1, size: 2, tokens: [["alpha", 1]] as [string, number][] },
  ],
};

describe("morphology cache file", () => {
  it("round-trips a snapshot", async () => {
    const fs = adapter();
    const path = "plugin/morphology-cache.json";
    await writeMorphologyCacheFile(fs, path, cache);

    expect(await readMorphologyCacheFile(fs, path, DEFAULT_SETTINGS)).toEqual(
      cache,
    );
  });

  it("reports no cache when the file does not exist", async () => {
    expect(
      await readMorphologyCacheFile(adapter(), "plugin/x.json", DEFAULT_SETTINGS),
    ).toBeUndefined();
  });

  it("rejects a truncated file instead of throwing", async () => {
    // A write interrupted by a quit leaves exactly this: valid JSON up to the
    // point the process died.
    const truncated = JSON.stringify(cache).slice(0, 40);
    const fs = adapter({ "plugin/x.json": truncated });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await readMorphologyCacheFile(fs, "plugin/x.json", DEFAULT_SETTINGS),
    ).toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("rejects a cache written under different custom vocabulary", async () => {
    const fs = adapter({ "plugin/x.json": JSON.stringify(cache) });

    expect(
      await readMorphologyCacheFile(fs, "plugin/x.json", {
        ...DEFAULT_SETTINGS,
        customVocabulary: ["ヴァイパー"],
      }),
    ).toBeUndefined();
  });

  it("prefers the manifest directory and falls back to the config dir", () => {
    expect(
      morphologyCachePath(".obsidian/plugins/suggested-notes", ".obsidian", "suggested-notes"),
    ).toBe(`.obsidian/plugins/suggested-notes/${MORPHOLOGY_CACHE_FILENAME}`);
    expect(morphologyCachePath(undefined, ".config-dir", "suggested-notes")).toBe(
      `.config-dir/plugins/suggested-notes/${MORPHOLOGY_CACHE_FILENAME}`,
    );
  });
});
