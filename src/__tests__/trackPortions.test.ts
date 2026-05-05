import { describe, expect, it } from "vitest";
import type { MultiLineString } from "geojson";
import {
  computeMatchingWorkItems,
  computePortions,
  multiLineLengthKm,
  sliceMultiLineByDistance,
  trimTrailingCoordinate,
} from "../matching/trackPortions";

// ─── computePortions ──────────────────────────────────────────────────────────

describe("computePortions", () => {
  it("returns correct portions for sorted input", () => {
    const portions = computePortions([1.0, 2.5, 4.0], 5.0);
    expect(portions).toHaveLength(3);
    expect(portions[0]).toMatchObject({ inputDistance: 1.0, kmA: 1.0, kmB: 2.5 });
    expect(portions[1]).toMatchObject({ inputDistance: 2.5, kmA: 2.5, kmB: 4.0 });
    expect(portions[2]).toMatchObject({ inputDistance: 4.0, kmA: 4.0, kmB: 5.0 });
  });

  it("sorts unsorted input internally", () => {
    const portions = computePortions([3.0, 1.0, 2.0], 5.0);
    expect(portions).toHaveLength(3);
    expect(portions[0]).toMatchObject({ inputDistance: 1.0, kmA: 1.0, kmB: 2.0 });
    expect(portions[1]).toMatchObject({ inputDistance: 2.0, kmA: 2.0, kmB: 3.0 });
    expect(portions[2]).toMatchObject({ inputDistance: 3.0, kmA: 3.0, kmB: 5.0 });
  });

  it("returns empty array for empty input", () => {
    expect(computePortions([], 5.0)).toEqual([]);
  });

  it("returns single portion from d to totalKm for a single distance", () => {
    const portions = computePortions([1.0], 5.0);
    expect(portions).toHaveLength(1);
    expect(portions[0]).toMatchObject({ inputDistance: 1.0, kmA: 1.0, kmB: 5.0 });
  });
});

describe("computeMatchingWorkItems", () => {
  it("treats two increasing distances as one explicit interval even when schedule metadata differs", () => {
    const workItems = computeMatchingWorkItems(
      [
        { distance: 1.0, startTime: "08:00", endTime: "09:00", date: "2026-04-30" },
        { distance: 2.5, startTime: "08:05", endTime: "09:05", date: "2026-04-30" },
      ],
      5.0,
    );

    expect(workItems).toEqual([{ rowIndex: 0, inputDistance: 1.0, kmA: 1.0, kmB: 2.5 }]);
  });

  it("keeps single-row CSV behavior and matches to the end of the track", () => {
    const workItems = computeMatchingWorkItems(
      [{ distance: 12.4, startTime: "13:00", endTime: "14:00", date: "2026-04-30" }],
      80.0,
    );

    expect(workItems).toEqual([{ rowIndex: 0, inputDistance: 12.4, kmA: 12.4, kmB: 80.0 }]);
  });

  it("treats increasing distances as N-1 explicit intervals", () => {
    const workItems = computeMatchingWorkItems(
      [
        { distance: 10.0, startTime: "13:00", endTime: "14:00", date: "2026-04-30" },
        { distance: 12.0, startTime: "13:07", endTime: "14:07", date: "2026-04-30" },
        { distance: 15.5, startTime: "13:18", endTime: "14:18", date: "2026-04-30" },
      ],
      80.0,
    );

    expect(workItems).toEqual([
      { rowIndex: 0, inputDistance: 10.0, kmA: 10.0, kmB: 12.0 },
      { rowIndex: 1, inputDistance: 12.0, kmA: 12.0, kmB: 15.5 },
    ]);
  });

  it("falls back to one work item per row when distances are not strictly increasing", () => {
    const workItems = computeMatchingWorkItems(
      [
        { distance: 12.4, startTime: "13:00", endTime: "14:00", date: "2026-04-30" },
        { distance: 12.4, startTime: "13:05", endTime: "14:05", date: "2026-04-30" },
      ],
      80.0,
    );

    expect(workItems).toEqual([
      { rowIndex: 0, inputDistance: 12.4, kmA: 12.4, kmB: 12.4 },
      { rowIndex: 1, inputDistance: 12.4, kmA: 12.4, kmB: 80.0 },
    ]);
  });
});

// ─── sliceMultiLineByDistance ─────────────────────────────────────────────────

/**
 * Build a simple 2-sub-line MultiLineString for testing.
 * Sub-line 0: from [0,0] to [1,0] (approximately 111 km along the equator).
 * Sub-line 1: from [1,1] to [2,1] (approximately 111 km, starting at a gap).
 *
 * We use a very short track so the numbers are predictable without exact
 * haversine values. Instead we test structure: both sub-lines present in output.
 */
function buildTwoSubLineMLS(): MultiLineString {
  return {
    type: "MultiLineString",
    coordinates: [
      // Sub-line 0: goes east ~ 1.1 km (0.01° at equator ≈ 1.11 km)
      [
        [7.0, 46.0],
        [7.01, 46.0],
      ],
      // Sub-line 1: continues (cumulative-km is continuous across the gap)
      [
        [8.0, 46.0],
        [8.01, 46.0],
      ],
    ],
  };
}

describe("sliceMultiLineByDistance", () => {
  it("returns empty geometry when kmA >= kmB", () => {
    const geom = buildTwoSubLineMLS();
    const result = sliceMultiLineByDistance(geom, 1.0, 0.5);
    expect(result.coordinates).toHaveLength(0);
  });

  it("returns the full geometry when window covers everything", () => {
    const geom = buildTwoSubLineMLS();
    // The two sub-lines together cover ~2.22 km — window 0 to 10 covers all
    const result = sliceMultiLineByDistance(geom, 0, 10);
    expect(result.coordinates).toHaveLength(2);
  });

  it("returns only the first sub-line when window ends before the second", () => {
    const geom = buildTwoSubLineMLS();
    // Sub-line 0 is ~1.11 km; window [0, 0.5] stays inside it
    const result = sliceMultiLineByDistance(geom, 0, 0.5);
    expect(result.coordinates).toHaveLength(1);
  });

  it("straddles the sub-line boundary — both sub-lines appear in output", () => {
    const geom = buildTwoSubLineMLS();
    // Sub-line 0 is ~1.11 km; window [0.5, 1.8] crosses into sub-line 1
    const result = sliceMultiLineByDistance(geom, 0.5, 1.8);
    // Both sub-lines should have been clipped and included
    expect(result.coordinates).toHaveLength(2);
    // Each clipped sub-line must have at least 2 points
    for (const coords of result.coordinates) {
      expect(coords.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("preserves MultiLineString type", () => {
    const geom = buildTwoSubLineMLS();
    const result = sliceMultiLineByDistance(geom, 0, 10);
    expect(result.type).toBe("MultiLineString");
  });
});

describe("trimTrailingCoordinate", () => {
  it("removes the last coordinate from the trailing sub-line", () => {
    const geometry: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [7.0, 46.0],
          [7.01, 46.0],
          [7.02, 46.0],
        ],
      ],
    };

    const trimmed = trimTrailingCoordinate(geometry);

    expect(trimmed).toEqual({
      type: "MultiLineString",
      coordinates: [
        [
          [7.0, 46.0],
          [7.01, 46.0],
        ],
      ],
    });
  });

  it("drops the trailing sub-line when removing its last coordinate would make it invalid", () => {
    const geometry: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [7.0, 46.0],
          [7.01, 46.0],
        ],
        [
          [8.0, 46.0],
          [8.01, 46.0],
        ],
      ],
    };

    const trimmed = trimTrailingCoordinate(geometry);

    expect(trimmed).toEqual({
      type: "MultiLineString",
      coordinates: [
        [
          [7.0, 46.0],
          [7.01, 46.0],
        ],
      ],
    });
  });
});

describe("multiLineLengthKm", () => {
  it("ignores gaps between sub-lines", () => {
    const geom = buildTwoSubLineMLS();

    expect(multiLineLengthKm(geom)).toBeGreaterThan(1.4);
    expect(multiLineLengthKm(geom)).toBeLessThan(1.7);
  });
});
