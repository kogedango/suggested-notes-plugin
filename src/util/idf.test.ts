import { describe, expect, it } from "vitest";
import { inverseDocumentFrequency } from "./idf";

describe("inverseDocumentFrequency", () => {
  it("computes the natural-log document ratio", () => {
    expect(inverseDocumentFrequency(10, 2)).toBeCloseTo(Math.log(5));
  });

  it("returns zero when either corpus value is unavailable", () => {
    expect(inverseDocumentFrequency(0, 0)).toBe(0);
    expect(inverseDocumentFrequency(10, 0)).toBe(0);
    expect(inverseDocumentFrequency(0, 2)).toBe(0);
  });
});
