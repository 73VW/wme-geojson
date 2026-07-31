import { describe, expect, it } from "vitest";
import { groupByWindow } from "../ui/groupByWindow";
import type { ClosuresBySegment } from "../csv/closuresFromSource";

const GEO_A = { lon: 7.1, lat: 46.1, zoom: 15 };
const GEO_B = { lon: 8.2, lat: 47.2, zoom: 17 };

const WIN_1 = { startISO: "2026-05-21T08:00", endISO: "2026-05-21T12:00", geo: GEO_A };
const WIN_2 = { startISO: "2026-05-21T14:00", endISO: "2026-05-21T18:00", geo: GEO_B };

describe("groupByWindow", () => {
  it("empty input → empty output", () => {
    expect(groupByWindow([])).toEqual([]);
  });

  it("two segments with same window → one WindowGroup with both segmentIds", () => {
    const bySegment: ClosuresBySegment[] = [
      { segmentId: 100, windows: [{ ...WIN_1 }] },
      { segmentId: 101, windows: [{ ...WIN_1 }] },
    ];
    const result = groupByWindow(bySegment);
    expect(result).toHaveLength(1);
    expect(result[0].startISO).toBe(WIN_1.startISO);
    expect(result[0].endISO).toBe(WIN_1.endISO);
    expect(result[0].segmentIds).toHaveLength(2);
    expect(result[0].segmentIds).toContain(100);
    expect(result[0].segmentIds).toContain(101);
  });

  it("two segments with different windows → two WindowGroups, one segment each", () => {
    const bySegment: ClosuresBySegment[] = [
      { segmentId: 100, windows: [{ ...WIN_1 }] },
      { segmentId: 101, windows: [{ ...WIN_2 }] },
    ];
    const result = groupByWindow(bySegment);
    expect(result).toHaveLength(2);
    const group1 = result.find((g) => g.startISO === WIN_1.startISO)!;
    const group2 = result.find((g) => g.startISO === WIN_2.startISO)!;
    expect(group1.segmentIds).toEqual([100]);
    expect(group2.segmentIds).toEqual([101]);
  });

  it("one segment with two non-overlapping windows → two WindowGroups, one segment each", () => {
    const bySegment: ClosuresBySegment[] = [
      { segmentId: 100, windows: [{ ...WIN_1 }, { ...WIN_2 }] },
    ];
    const result = groupByWindow(bySegment);
    expect(result).toHaveLength(2);
    const group1 = result.find((g) => g.startISO === WIN_1.startISO)!;
    const group2 = result.find((g) => g.startISO === WIN_2.startISO)!;
    expect(group1.segmentIds).toEqual([100]);
    expect(group2.segmentIds).toEqual([100]);
  });

  it("two segments, same window but different geo → two WindowGroups", () => {
    const bySegment: ClosuresBySegment[] = [
      { segmentId: 100, windows: [{ ...WIN_1, geo: GEO_A }] },
      { segmentId: 101, windows: [{ ...WIN_1, geo: GEO_B }] },
    ];
    const result = groupByWindow(bySegment);
    expect(result).toHaveLength(2);
    expect(result.find((g) => g.geo === GEO_A)?.segmentIds).toEqual([100]);
    expect(result.find((g) => g.geo === GEO_B)?.segmentIds).toEqual([101]);
  });

  it("three segments with same window → one WindowGroup with three segmentIds", () => {
    const bySegment: ClosuresBySegment[] = [
      { segmentId: 100, windows: [{ ...WIN_1 }] },
      { segmentId: 101, windows: [{ ...WIN_1 }] },
      { segmentId: 102, windows: [{ ...WIN_1 }] },
    ];
    const result = groupByWindow(bySegment);
    expect(result).toHaveLength(1);
    expect(result[0].segmentIds).toHaveLength(3);
    expect(result[0].segmentIds).toContain(100);
    expect(result[0].segmentIds).toContain(101);
    expect(result[0].segmentIds).toContain(102);
  });
});
