import { describe, it, expect } from "vitest";
import type { MultiLineString, Feature, Polygon, MultiPolygon } from "geojson";
import { bbox as turfBbox, buffer as turfBuffer } from "@turf/turf";
import { planWalk } from "../matching/GridWalker";

// ---------------------------------------------------------------------------
// Shared viewport size — approximates WME z17 on a typical HD screen.
// The exact values don't matter for logic tests; what matters is consistency.
// ---------------------------------------------------------------------------
const VIEWPORT = { lonSpan: 0.03, latSpan: 0.02 };
const BUFFER_METERS = 15;
const OVERLAP_RATIO = 0.2;

function makePlanArgs(track: MultiLineString) {
  return {
    track,
    viewportSizeDeg: VIEWPORT,
    bufferMeters: BUFFER_METERS,
    overlapRatio: OVERLAP_RATIO,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Roughly 1 km horizontal east-west line near Zurich.
 * At ~47° lat, 0.01° ≈ 750 m.  Two points separated by ~0.013° ≈ ~1 km.
 */
const horizontalLine: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [8.53, 47.37],
      [8.543, 47.37],
    ],
  ],
};

/**
 * LineString that doubles back on itself: goes east then comes back west.
 * Any duplicate-cell test should confirm deduplication.
 */
const doubleBackLine: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [8.53, 47.37],
      [8.543, 47.37],
      [8.53, 47.37], // returns to start
    ],
  ],
};

/**
 * Two disconnected sub-lines separated by ~0.2° lon (≈ 15 km) — no cells
 * should appear in the gap between them.
 */
const disconnectedLines: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [8.4, 47.37],
      [8.413, 47.37],
    ],
    [
      [8.6, 47.37],
      [8.613, 47.37],
    ],
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the buffered track feature used as the "ground truth" footprint.
 */
function bufferedTrack(track: MultiLineString): Feature<Polygon | MultiPolygon> {
  const f = turfBuffer({ type: "Feature", geometry: track, properties: null }, BUFFER_METERS, {
    units: "meters",
  });
  if (!f) throw new Error("turfBuffer returned falsy");
  return f;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("planWalk", () => {
  it("produces cells that cover only along a short horizontal line (~1 km)", () => {
    const cells = planWalk(makePlanArgs(horizontalLine));

    expect(cells.length).toBeGreaterThan(0);

    // For a ~1 km east-west line at z17 viewport (0.03° lon span), we expect
    // very few cells — definitely not dozens spanning unrelated areas.
    // A loose upper bound of 10 covers even very conservative overlap configs.
    expect(cells.length).toBeLessThanOrEqual(10);

    // All cell centers should be longitudinally close to the line
    // (within one viewport width left/right of the endpoints).
    const [minLon, , maxLon] = turfBbox({
      type: "Feature",
      geometry: horizontalLine,
      properties: null,
    });
    for (const cell of cells) {
      expect(cell.center.lon).toBeGreaterThanOrEqual(minLon - VIEWPORT.lonSpan);
      expect(cell.center.lon).toBeLessThanOrEqual(maxLon + VIEWPORT.lonSpan);
    }
  });

  it("returns no duplicate cells when the line doubles back", () => {
    const cells = planWalk(makePlanArgs(doubleBackLine));

    // Cell centers must be unique (no two cells share the same center).
    const centerKeys = cells.map((c) => `${c.center.lon.toFixed(6)},${c.center.lat.toFixed(6)}`);
    const uniqueKeys = new Set(centerKeys);

    expect(uniqueKeys.size).toBe(cells.length);
  });

  it("covers both disconnected sub-lines but produces no cells in the gap between them", () => {
    const cells = planWalk(makePlanArgs(disconnectedLines));

    expect(cells.length).toBeGreaterThan(0);

    // The gap between the two sub-lines is ~0.19° lon.  No cell center should
    // fall in the middle of that gap (outside the buffered track).
    const buffered = bufferedTrack(disconnectedLines);

    // Every cell should intersect the buffered track (this is the filter).
    // We verify by checking that no cell sits entirely in the gap lon range.
    const gapMinLon = 8.413 + VIEWPORT.lonSpan;
    const gapMaxLon = 8.6 - VIEWPORT.lonSpan;

    // There should be NO cell whose center is strictly inside the gap
    // (i.e. away from either sub-line footprint).
    const gapCells = cells.filter((c) => c.center.lon > gapMinLon && c.center.lon < gapMaxLon);
    expect(gapCells.length).toBe(0);

    // But cells must cover both extremes
    const coversLeft = cells.some((c) => c.center.lon < 8.43);
    const coversRight = cells.some((c) => c.center.lon > 8.59);
    expect(coversLeft).toBe(true);
    expect(coversRight).toBe(true);

    void buffered; // used above implicitly via the filter logic
  });

  it("union of cell bboxes contains the buffered track", () => {
    const cells = planWalk(makePlanArgs(horizontalLine));

    expect(cells.length).toBeGreaterThan(0);

    // The buffered track's bounding box must be contained within the bounding
    // box of the union of all cell bboxes.  (We use bbox-of-cells ⊇ bbox-of-buffer
    // as a conservative proxy, since computing a full polygon union is heavier.)
    const buffered = bufferedTrack(horizontalLine);
    const [bufMinLon, bufMinLat, bufMaxLon, bufMaxLat] = turfBbox(buffered);

    const cellMinLon = Math.min(...cells.map((c) => c.bbox[0]));
    const cellMinLat = Math.min(...cells.map((c) => c.bbox[1]));
    const cellMaxLon = Math.max(...cells.map((c) => c.bbox[2]));
    const cellMaxLat = Math.max(...cells.map((c) => c.bbox[3]));

    expect(cellMinLon).toBeLessThanOrEqual(bufMinLon);
    expect(cellMinLat).toBeLessThanOrEqual(bufMinLat);
    expect(cellMaxLon).toBeGreaterThanOrEqual(bufMaxLon);
    expect(cellMaxLat).toBeGreaterThanOrEqual(bufMaxLat);
  });

  it("assigns sequential 0-based indices after ordering", () => {
    const cells = planWalk(makePlanArgs(horizontalLine));

    cells.forEach((cell, i) => {
      expect(cell.index).toBe(i);
    });
  });
});
