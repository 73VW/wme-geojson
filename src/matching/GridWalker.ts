/**
 * GridWalker — pure module, no SDK imports, no DOM.
 *
 * planWalk() computes an ordered list of viewport-sized cells that collectively
 * cover the buffered track. The list is ordered greedily starting from the
 * first point of the track, which minimises back-and-forth map panning and
 * roughly follows the track's geographic direction.
 *
 * Cell-ordering algorithm choice: greedy nearest-unvisited-neighbour starting
 * from the track's first coordinate. Rationale: it is O(N²) in the number of
 * cells but N is typically < 200 for the target track lengths (5-50 km), so the
 * cost is negligible. A more sophisticated TSP solver is not warranted. This
 * also naturally handles doubled-back tracks and disconnected MultiLineStrings
 * because we only care about proximity, not track-index order.
 */
import {
  bbox as turfBbox,
  buffer as turfBuffer,
  booleanIntersects,
  distance as turfDistance,
  featureCollection,
  bboxPolygon,
} from "@turf/turf";
import type { Feature, MultiLineString, Polygon } from "geojson";
import type { Cell, PlanWalkArgs } from "./types";

/**
 * Compute a GeoJSON BBox [west, south, east, north] for a single cell whose
 * center is at (lon, lat) and whose half-spans are given.
 */
function cellBbox(
  lon: number,
  lat: number,
  halfLonSpan: number,
  halfLatSpan: number,
): [number, number, number, number] {
  return [
    lon - halfLonSpan,
    lat - halfLatSpan,
    lon + halfLonSpan,
    lat + halfLatSpan,
  ];
}

/**
 * Return the coordinates [lon, lat] of the first vertex on the track.
 * Falls back to [0, 0] if the track has no coordinates (should never happen
 * on a validated track, but we guard defensively).
 */
function trackFirstPoint(track: MultiLineString): { lon: number; lat: number } {
  const firstLine = track.coordinates[0];
  if (!firstLine || firstLine.length === 0) {
    return { lon: 0, lat: 0 };
  }
  const [lon, lat] = firstLine[0];
  return { lon, lat };
}

/**
 * Plan a grid walk that covers the buffered track.
 *
 * Returns an ordered array of cells. The order is greedy-nearest-neighbour
 * starting from the first coordinate of the track (see module-level comment).
 */
export function planWalk(args: PlanWalkArgs): Cell[] {
  const { track, viewportSizeDeg, bufferMeters, overlapRatio } = args;

  // The effective step size accounts for the overlap so adjacent cells share
  // a strip of viewport, ensuring no segment falls in a gap.
  const stepLon = viewportSizeDeg.lonSpan * (1 - overlapRatio);
  const stepLat = viewportSizeDeg.latSpan * (1 - overlapRatio);
  const halfLon = viewportSizeDeg.lonSpan / 2;
  const halfLat = viewportSizeDeg.latSpan / 2;

  // Buffer the track in metres; result is a Feature<Polygon | MultiPolygon>.
  // We treat it as a Feature<Polygon> for intersection tests (booleanIntersects
  // accepts both).
  const trackFeature: Feature<MultiLineString> = {
    type: "Feature",
    geometry: track,
    properties: null,
  };
  const buffered = turfBuffer(trackFeature, bufferMeters, { units: "meters" });
  if (!buffered) {
    // turfBuffer can return undefined/null when the input is degenerate.
    return [];
  }

  // Compute the bounding box of the track (NOT the buffer) as the grid extent.
  // Using the track bbox keeps the candidate grid small; cells are then filtered
  // by intersection with the buffer.
  const [minLon, minLat, maxLon, maxLat] = turfBbox(trackFeature);

  // Expand the bbox slightly to ensure the first/last cells fully overlap the
  // endpoints.  One half-step of padding is sufficient.
  const gridMinLon = minLon - halfLon;
  const gridMinLat = minLat - halfLat;
  const gridMaxLon = maxLon + halfLon;
  const gridMaxLat = maxLat + halfLat;

  // Generate candidate cells on a regular grid.
  const candidates: Cell[] = [];
  let index = 0;

  for (let lat = gridMinLat; lat <= gridMaxLat + stepLat * 0.01; lat += stepLat) {
    for (let lon = gridMinLon; lon <= gridMaxLon + stepLon * 0.01; lon += stepLon) {
      const bbox = cellBbox(lon, lat, halfLon, halfLat);
      const cellPoly = bboxPolygon(bbox) as Feature<Polygon>;

      // Keep only cells that actually intersect the buffered track.
      const intersects = booleanIntersects(cellPoly, buffered);
      if (!intersects) {
        continue;
      }

      candidates.push({
        index: index++,
        center: { lat, lon },
        bbox,
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  // --- Greedy nearest-neighbour ordering ---
  // Start from the cell whose center is closest to the first track vertex,
  // then repeatedly pick the closest unvisited remaining cell.
  const startPoint = trackFirstPoint(track);

  const ordered: Cell[] = [];
  const remaining = new Set(candidates);

  // Find the starting cell — the one closest to the track's first point.
  let current = candidates.reduce((best, cell) => {
    const dBest = turfDistance(
      [best.center.lon, best.center.lat],
      [startPoint.lon, startPoint.lat],
      { units: "degrees" },
    );
    const dCell = turfDistance(
      [cell.center.lon, cell.center.lat],
      [startPoint.lon, startPoint.lat],
      { units: "degrees" },
    );
    return dCell < dBest ? cell : best;
  });

  remaining.delete(current);
  ordered.push(current);

  while (remaining.size > 0) {
    let nearestDist = Infinity;
    let nearest: Cell | null = null;

    for (const candidate of remaining) {
      const d = turfDistance(
        [current.center.lon, current.center.lat],
        [candidate.center.lon, candidate.center.lat],
        { units: "degrees" },
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearest = candidate;
      }
    }

    if (!nearest) {
      break;
    }

    remaining.delete(nearest);
    ordered.push(nearest);
    current = nearest;
  }

  // Re-assign sequential indices after ordering so consumers can use
  // index as a progress counter without gaps.
  return ordered.map((cell, i) => ({ ...cell, index: i }));
}

// Re-export featureCollection so callers can build test fixtures conveniently.
export { featureCollection };
