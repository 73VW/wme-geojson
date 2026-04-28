import { describe, it, expect } from "vitest";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { buffer as turfBuffer } from "@turf/turf";
import { matchSegments } from "../matching/SegmentMatcher";
import type { SegmentLike } from "../matching/types";

// ---------------------------------------------------------------------------
// Fixtures — a simple east-west track near Geneva
// ---------------------------------------------------------------------------

const TRACK_LINE = {
  type: "Feature" as const,
  geometry: {
    type: "MultiLineString" as const,
    coordinates: [
      [
        [6.14, 46.20],
        [6.16, 46.20],
      ],
    ],
  },
  properties: null,
};

const BUFFER_METERS = 15;

function makeBufferedTrack(): Feature<Polygon | MultiPolygon> {
  const result = turfBuffer(TRACK_LINE, BUFFER_METERS, { units: "meters" });
  if (!result) throw new Error("turfBuffer returned falsy");
  return result;
}

// ---------------------------------------------------------------------------
// Segment helpers
// ---------------------------------------------------------------------------

function seg(id: number, coords: number[][]): SegmentLike {
  return {
    id,
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("matchSegments", () => {
  const bufferedTrack = makeBufferedTrack();

  it("matches a segment fully inside the buffer", () => {
    // A very short segment that lies right on the track centerline.
    const inside = seg(1, [
      [6.148, 46.20],
      [6.150, 46.20],
    ]);
    const result = matchSegments({ segments: [inside], bufferedTrack });

    expect(result.has(1)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("does not match a segment fully outside the buffer", () => {
    // ~100 m north of the track — well outside the 15 m buffer.
    const outside = seg(2, [
      [6.14, 46.202],
      [6.16, 46.202],
    ]);
    const result = matchSegments({ segments: [outside], bufferedTrack });

    expect(result.has(2)).toBe(false);
    expect(result.size).toBe(0);
  });

  it("matches a segment that crosses the buffer boundary at one point", () => {
    // Starts inside the buffer and extends well outside to the north.
    // At 46.20° lat, 0.0001° ≈ 7 m, so the segment starts ~5 m north of the
    // center (inside the 15 m buffer) and ends ~200 m north (outside).
    const crossing = seg(3, [
      [6.15, 46.200065], // ≈7 m north of centerline — still inside 15 m buffer
      [6.15, 46.202], // ~200 m north — outside buffer
    ]);
    const result = matchSegments({ segments: [crossing], bufferedTrack });

    expect(result.has(3)).toBe(true);
  });

  it("returns only matching IDs from a mixed batch", () => {
    const inside = seg(10, [
      [6.148, 46.20],
      [6.150, 46.20],
    ]);
    const outsideFar = seg(20, [
      [6.14, 46.203],
      [6.16, 46.203],
    ]);
    const outsideFar2 = seg(30, [
      [6.10, 46.21],
      [6.11, 46.21],
    ]);
    const alsoCrossing = seg(40, [
      [6.155, 46.200065],
      [6.155, 46.203],
    ]);

    const result = matchSegments({
      segments: [inside, outsideFar, outsideFar2, alsoCrossing],
      bufferedTrack,
    });

    expect(result.has(10)).toBe(true);
    expect(result.has(40)).toBe(true);
    expect(result.has(20)).toBe(false);
    expect(result.has(30)).toBe(false);
    expect(result.size).toBe(2);
  });

  it("returns an empty Set when no segments are provided", () => {
    const result = matchSegments({ segments: [], bufferedTrack });

    expect(result.size).toBe(0);
  });

  it("handles duplicate segment IDs without growing the Set beyond one entry", () => {
    const seg1 = seg(99, [
      [6.148, 46.20],
      [6.150, 46.20],
    ]);
    // Same geometry, same id — should still only appear once in the result Set.
    const result = matchSegments({ segments: [seg1, seg1], bufferedTrack });

    expect(result.size).toBe(1);
    expect(result.has(99)).toBe(true);
  });
});
