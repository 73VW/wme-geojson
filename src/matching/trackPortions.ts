/**
 * trackPortions.ts — Pure (SDK-free) helpers for the "compute bbox views"
 * feature.
 *
 * `computePortions` converts a sorted list of kilometre waypoints into a list
 * of [kmA, kmB] slices of the track. `sliceMultiLineByDistance` cuts a
 * MultiLineString geometry to a cumulative-km window, producing a new
 * MultiLineString that spans the same geographic range.
 *
 * Cumulative-km is always continuous across sub-lines — gaps between sub-lines
 * are not counted as distance, matching the behaviour of `computeDistanceLabels`.
 */

import type { BBox, MultiLineString, Position } from "geojson";
import { bbox as turfBbox } from "@turf/turf";

// ─── Types ────────────────────────────────────────────────────────────────────

/** One slice of the track identified by the input waypoint that opened it. */
export interface TrackPortion {
  /** The distance value the user typed that starts this portion (km). */
  inputDistance: number;
  /** Cumulative km start of this slice (inclusive). */
  kmA: number;
  /** Cumulative km end of this slice (exclusive-ish — the slice goes up to but
   *  not past this point). For the last portion this equals `totalKm`. */
  kmB: number;
}

// ─── computePortions ──────────────────────────────────────────────────────────

/**
 * Build an ordered list of track portions from a list of waypoint distances.
 *
 * The distances are sorted ascending before processing. Portions are the
 * intervals between consecutive waypoints; the last portion runs from the
 * largest waypoint to `totalKm`.
 *
 * Empty input → empty output.
 * Single input `[d]` → one portion `(d, totalKm)`.
 *
 * Distances ≤ 0 or ≥ totalKm are kept — the slice helper will handle them
 * gracefully (zero-length output if loKm >= hiKm).
 */
export function computePortions(distancesKm: number[], totalKm: number): TrackPortion[] {
  if (distancesKm.length === 0) return [];

  const sorted = [...distancesKm].sort((a, b) => a - b);

  const portions: TrackPortion[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const kmA = sorted[i];
    const kmB = i + 1 < sorted.length ? sorted[i + 1] : totalKm;
    portions.push({ inputDistance: sorted[i], kmA, kmB });
  }
  return portions;
}

// ─── sliceMultiLineByDistance ─────────────────────────────────────────────────

/**
 * Slice a MultiLineString to the cumulative-km window [kmA, kmB].
 *
 * Cumulative km is continuous across sub-lines (gaps between sub-lines are not
 * counted as distance), matching `computeDistanceLabels`.
 *
 * Sub-lines that overlap the window are clipped at the window edges with linear
 * interpolation (same algorithm as `sliceLineByDistance` in TrackLayer.ts).
 * Sub-lines fully outside the window are omitted. If the window is empty
 * (kmA >= kmB) or no coordinates survive clipping, returns a MultiLineString
 * with an empty coordinates array.
 */
export function sliceMultiLineByDistance(
  geometry: MultiLineString,
  kmA: number,
  kmB: number,
): MultiLineString {
  if (kmA >= kmB) {
    return { type: "MultiLineString", coordinates: [] };
  }

  const resultCoords: Position[][] = [];
  let cumulativeKm = 0;

  for (const lineCoords of geometry.coordinates) {
    const lineLengthKm = sumSegmentDistances(lineCoords);
    const subLineStartKm = cumulativeKm;
    const subLineEndKm = cumulativeKm + lineLengthKm;
    cumulativeKm = subLineEndKm;

    // Skip sub-lines entirely outside the window
    const overlaps = subLineEndKm >= kmA && subLineStartKm <= kmB;
    if (!overlaps) continue;

    // Convert global window to local offsets within this sub-line
    const localLo = Math.max(0, kmA - subLineStartKm);
    const localHi = Math.min(lineLengthKm, kmB - subLineStartKm);

    const clipped = sliceLineByDistance(lineCoords, localLo, localHi);
    if (clipped.length >= 2) {
      resultCoords.push(clipped);
    }
  }

  return { type: "MultiLineString", coordinates: resultCoords };
}

// ─── bboxOfMultiLineString ────────────────────────────────────────────────────

/**
 * Compute the geographic bounding box of a MultiLineString.
 * Thin wrapper around turf.bbox for consistent typing.
 *
 * Returns `null` if the geometry has no coordinates (empty slice).
 */
export function bboxOfMultiLineString(geometry: MultiLineString): BBox | null {
  const allCoords = geometry.coordinates.flat();
  if (allCoords.length === 0) return null;
  return turfBbox({ type: "Feature", geometry, properties: null });
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function sumSegmentDistances(line: Position[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    total += haversineKm(a[0], a[1], b[0], b[1]);
  }
  return total;
}

/**
 * Slice a single LineString from `loKm` to `hiKm` measured along the line.
 * Edge points are linearly interpolated. Same algorithm as TrackLayer's private
 * `sliceLineByDistance` — duplicated here to keep `src/matching/` free of
 * layer imports.
 */
function sliceLineByDistance(line: Position[], loKm: number, hiKm: number): Position[] {
  if (line.length < 2 || hiKm <= loKm) return [];

  const result: Position[] = [];
  let cumulative = 0;
  let started = false;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const segLen = haversineKm(a[0], a[1], b[0], b[1]);
    const segStart = cumulative;
    const segEnd = cumulative + segLen;

    if (segEnd < loKm) {
      cumulative = segEnd;
      continue;
    }
    if (segStart > hiKm) break;

    if (!started) {
      const t = segLen === 0 ? 0 : Math.max(0, loKm - segStart) / segLen;
      result.push(interpolatePosition(a, b, t));
      started = true;
    }

    if (segEnd <= hiKm) {
      result.push(b);
    } else {
      const t = segLen === 0 ? 1 : Math.max(0, hiKm - segStart) / segLen;
      result.push(interpolatePosition(a, b, t));
      break;
    }

    cumulative = segEnd;
  }

  return result;
}

function interpolatePosition(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
