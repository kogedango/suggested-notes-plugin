import { describe, expect, it } from "vitest";
import { outlinkCountPenalty } from "./penalties";

describe("outlinkCountPenalty", () => {
  it("returns 1 for zero outlinks (no division)", () => {
    expect(outlinkCountPenalty(0)).toBe(1);
  });
  it("returns 1 when log(1+n) <= 1 (low-outlink notes untouched)", () => {
    // log(1+1)=0.69, log(1+2)=1.10 — boundary near 2
    expect(outlinkCountPenalty(1)).toBe(1);
    expect(outlinkCountPenalty(2)).toBeGreaterThan(1);
  });
  it("scales sub-linearly with outlink count", () => {
    const p10 = outlinkCountPenalty(10);
    const p100 = outlinkCountPenalty(100);
    expect(p100).toBeGreaterThan(p10);
    // log(101)/log(11) ≈ 1.93 — much less than 10×
    expect(p100 / p10).toBeLessThan(3);
  });
  it("monotonically non-decreasing", () => {
    let prev = outlinkCountPenalty(0);
    for (let n = 1; n <= 50; n++) {
      const cur = outlinkCountPenalty(n);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});
