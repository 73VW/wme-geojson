/**
 * Shared types for the matching subsystem.
 *
 * IMPORTANT: This file must remain SDK-free and DOM-free.
 * It is imported by pure modules (GridWalker, SegmentMatcher) that run in plain
 * Node during tests and must never pull in wme-sdk-typings.
 */
import type { BBox, Feature, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";

/**
 * One viewport-sized cell in the grid walk plan.
 * `bbox` is [west, south, east, north] — a GeoJSON BBox.
 */
export interface Cell {
  index: number;
  center: { lat: number; lon: number };
  bbox: BBox;
}

/**
 * Arguments for planWalk. All geometry-related parameters come in as pure
 * GeoJSON / numeric values — no SDK types.
 */
export interface PlanWalkArgs {
  track: MultiLineString;
  viewportSizeDeg: { lonSpan: number; latSpan: number };
  /** Meters to buffer around the track before testing cell intersection. Default 15. */
  bufferMeters: number;
  /** Fraction of viewport size used as overlap between adjacent cells. Default 0.2 (20%). */
  overlapRatio: number;
}

/**
 * Minimal segment shape used by SegmentMatcher.
 *
 * The controller adapts SDK Segment objects to this structural type so that
 * the matcher module itself never imports wme-sdk-typings.
 */
export interface SegmentLike {
  id: number;
  geometry: LineString;
}

/**
 * Arguments for matchSegments.
 */
export interface MatchArgs {
  segments: ReadonlyArray<SegmentLike>;
  bufferedTrack: Feature<Polygon | MultiPolygon>;
}
