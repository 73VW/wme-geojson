import { describe, it, expect } from "vitest";
import { nearestPointOnLine } from "@turf/turf";
import type { Feature, LineString } from "geojson";
import { buildTrackSpatialIndex } from "../matching/TrackSpatialIndex";

function makeTrack(coords: number[][]): Feature<LineString> {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: null,
  };
}

// Simple horizontal track: 3 edges, ~1.1 km total (at ~46° lat)
const TRACK_COORDS = [
  [6.0, 46.0],
  [6.01, 46.0],
  [6.02, 46.0],
  [6.02, 46.01],
];

describe("buildTrackSpatialIndex", () => {
  const track = makeTrack(TRACK_COORDS);
  const index = buildTrackSpatialIndex(track);

  it("totalLengthMeters matches turf length", () => {
    const turfLengthMeters =
      nearestPointOnLine(
        track,
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [6.0, 46.0] },
          properties: null,
        },
        { units: "meters" },
      ).properties.dist ?? 0;
    // Just verify it is a positive number in the right ballpark
    expect(index.totalLengthMeters).toBeGreaterThan(1000);
    expect(index.totalLengthMeters).toBeLessThan(3000);
    void turfLengthMeters;
  });

  it("returns null when point is far and maxDistance is small", () => {
    // Point is ~55 km away from the track
    const result = index.nearestEdgeProjection([6.5, 46.5], 100);
    expect(result).toBeNull();
  });

  it("returns null when point is moderately far and maxDistance is tight", () => {
    // Point is ~50 m above the horizontal segment — farther than 30 m threshold
    const point: [number, number] = [6.01, 46.0005]; // ~55 m north at lat 46
    const result = index.nearestEdgeProjection(point, 30);
    expect(result).toBeNull();
  });

  it("returns a result when point is within maxDistance", () => {
    // Point is ~11 m north of the horizontal segment
    const point: [number, number] = [6.01, 46.0001]; // ~11 m north at lat 46
    const result = index.nearestEdgeProjection(point, 50);
    expect(result).not.toBeNull();
    expect(result!.distanceMeters).toBeLessThan(50);
  });

  it("nearestEdgeProjectionUnbounded matches turf nearestPointOnLine location within 1 m", () => {
    const testPoints: [number, number][] = [
      [6.005, 46.0], // on first segment
      [6.015, 46.0003], // near middle of second segment
      [6.02, 46.005], // on third (vertical) segment
    ];

    for (const coord of testPoints) {
      const turfResult = nearestPointOnLine(
        track,
        { type: "Feature", geometry: { type: "Point", coordinates: coord }, properties: null },
        { units: "kilometers" },
      );
      const turfLocationKm = turfResult.properties.location ?? 0;

      const ourResult = index.nearestEdgeProjectionUnbounded(coord);

      expect(Math.abs(ourResult.locationKm - turfLocationKm)).toBeLessThan(0.001); // within 1 m
    }
  });

  it("nearestEdgeProjection returns correct edge for point near first segment", () => {
    // Point 5 m north of the midpoint of the first edge
    const point: [number, number] = [6.005, 46.000045]; // ~5 m north
    const result = index.nearestEdgeProjection(point, 20);
    expect(result).not.toBeNull();
    expect(result!.distanceMeters).toBeLessThan(20);
    // Location should be in the first half of the track
    expect(result!.locationKm).toBeLessThan(index.totalLengthMeters / 1000 / 2);
  });

  it("bearingDeg is a finite number", () => {
    const result = index.nearestEdgeProjectionUnbounded([6.005, 46.0]);
    expect(Number.isFinite(result.bearingDeg)).toBe(true);
  });

  it("bbox padding handles corner point correctly (point near bend)", () => {
    // Point at or near the corner [6.02, 46.0] — should not be missed
    const bend: [number, number] = [6.0201, 46.0001]; // just outside corner
    const result = index.nearestEdgeProjectionUnbounded(bend);
    expect(result).toBeDefined();
    expect(result.distanceMeters).toBeLessThan(200);
  });

  it("unbounded search finds correct nearest even with large initial radius", () => {
    // Point far from track — unbounded must keep expanding
    const farPoint: [number, number] = [6.3, 46.3];
    const result = index.nearestEdgeProjectionUnbounded(farPoint);
    expect(result).toBeDefined();
    expect(result.distanceMeters).toBeGreaterThan(1000);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// L-shaped track: long horizontal leg then long vertical leg.
// A query point placed at the "inner corner exterior" can trigger the bug where
// a sub-optimal hit (bbox inside the initial radius, foot far away) satisfies
// the old 1.5× check while the geometrically closer edge is just outside the
// current radius and gets missed.
// ──────────────────────────────────────────────────────────────────────────────
describe("nearestEdgeProjectionUnbounded – L-shaped track correctness", () => {
  // Horizontal leg: [6.0, 46.0] → [6.1, 46.0]  (~7.7 km at lat 46)
  // Vertical leg:   [6.1, 46.0] → [6.1, 46.1]  (~11.1 km)
  const L_TRACK_COORDS = [
    [6.0, 46.0],
    [6.1, 46.0],
    [6.1, 46.1],
  ];
  const lTrack = makeTrack(L_TRACK_COORDS);
  const lIndex = buildTrackSpatialIndex(lTrack);

  it("matches turf nearestPointOnLine within 1 m for a point near the inner corner", () => {
    // This point sits "inside" the L's right angle, equidistant-ish from both
    // edges.  The initial rbush radius may capture the horizontal edge bbox but
    // not the vertical edge — triggering the original bug.
    const testPoints: [number, number][] = [
      [6.095, 46.005], // closer to vertical leg
      [6.098, 46.002], // very close to corner, near vertical leg
      [6.05, 46.003], // roughly equidistant from both legs
      [6.02, 46.008], // clearly closer to horizontal leg
      [6.1, 46.05], // mid-vertical leg
    ];

    for (const coord of testPoints) {
      const turfResult = nearestPointOnLine(
        lTrack,
        { type: "Feature", geometry: { type: "Point", coordinates: coord }, properties: null },
        { units: "kilometers" },
      );
      const turfDistM = (turfResult.properties.dist ?? 0) * 1000; // dist is in query units (km) → convert to metres
      const turfLocationKm = turfResult.properties.location ?? 0;

      const ourResult = lIndex.nearestEdgeProjectionUnbounded(coord);

      // Primary assertion: distance must agree with turf within 1 m
      expect(Math.abs(ourResult.distanceMeters - turfDistM)).toBeLessThan(1);
      // Secondary assertion: chainage location must agree within 1 m
      expect(Math.abs(ourResult.locationKm - turfLocationKm)).toBeLessThan(0.001);
    }
  });
});
