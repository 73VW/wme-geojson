// src/__tests__/mteResolver.test.ts
import { describe, expect, it } from "vitest";
import { byUrl, candidatesByBbox, type MteRef } from "../mte/mteResolver";

function mte(overrides: Partial<MteRef>): MteRef {
  return {
    id: "1",
    name: "MTE",
    urlLink: null,
    bbox: [0, 0, 10, 10],
    startDate: "2026-06-20",
    endDate: "2026-06-22",
    ...overrides,
  };
}

describe("byUrl", () => {
  it("returns the first MTE whose urlLink matches", () => {
    const list = [mte({ id: "1", urlLink: "https://a" }), mte({ id: "2", urlLink: "https://b" })];
    expect(byUrl(list, "https://b")?.id).toBe("2");
  });

  it("returns null when no MTE has the URL", () => {
    expect(byUrl([mte({ urlLink: "https://a" })], "https://b")).toBeNull();
  });

  it("ignores MTEs whose urlLink is null", () => {
    expect(byUrl([mte({ urlLink: null })], "https://a")).toBeNull();
  });

  it("requires exact equality (no fuzzy match)", () => {
    expect(byUrl([mte({ urlLink: "https://a/" })], "https://a")).toBeNull();
  });
});

describe("candidatesByBbox", () => {
  const slowupBbox: [number, number, number, number] = [4, 46, 8, 48];
  const slowupDate = "2026-06-21";

  it("returns MTEs whose bbox overlaps and dates cover the slowup date", () => {
    const list = [
      mte({ id: "in", bbox: [5, 47, 7, 47.5], startDate: "2026-06-20", endDate: "2026-06-22" }),
      mte({ id: "outside-bbox", bbox: [20, 20, 21, 21] }),
      mte({ id: "outside-date", bbox: [5, 47, 7, 47.5], startDate: "2026-07-01", endDate: "2026-07-02" }),
    ];
    const result = candidatesByBbox(list, slowupBbox, slowupDate);
    expect(result.map((c) => c.mte.id)).toEqual(["in"]);
  });

  it("sorts by overlap descending", () => {
    const list = [
      mte({ id: "small", bbox: [7.9, 47.9, 8, 48] }),
      mte({ id: "large", bbox: [4, 46, 8, 48] }),
    ];
    const result = candidatesByBbox(list, slowupBbox, slowupDate);
    expect(result.map((c) => c.mte.id)).toEqual(["large", "small"]);
    expect(result[0].overlap).toBeGreaterThan(result[1].overlap);
  });

  it("returns [] when no MTE matches", () => {
    expect(candidatesByBbox([], slowupBbox, slowupDate)).toEqual([]);
  });

  it("treats tangent bboxes as non-overlapping", () => {
    const list = [mte({ bbox: [8, 48, 10, 50] })];
    expect(candidatesByBbox(list, slowupBbox, slowupDate)).toEqual([]);
  });
});
