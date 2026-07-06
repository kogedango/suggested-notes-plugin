import { afterEach, describe, expect, it } from "vitest";
import { t } from "./i18n";

// t() reads the locale lazily from localStorage on every call, so tests can
// just stub the global between assertions instead of mocking the module.
function stubLocalStorage(language: string | null): void {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => (key === "language" ? language : null),
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("t", () => {
  it("falls back to English for a key the Japanese dictionary omits", () => {
    // noticeTagAdded is intentionally left untranslated in `ja` (see i18n.ts)
    // since its template has no English words — this exercises the fallback
    // path, not just "locale is English".
    stubLocalStorage("ja");
    expect(t("noticeTagAdded", { tag: "foo" })).toBe("+#foo");
  });

  it("interpolates {param} placeholders", () => {
    stubLocalStorage(null);
    expect(t("suggestAddTag", { tag: "life", count: 3 })).toBe(
      "Add #life (3 notes)",
    );
  });

  it("uses the Japanese dictionary when the locale is ja", () => {
    stubLocalStorage("ja");
    expect(t("statusEmpty")).toBe("関連ノートが見つかりませんでした。");
  });

  it("defaults to English when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(t("statusEmpty")).toBe("No related notes found.");
  });
});
