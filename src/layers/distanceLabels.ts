import type { MultiLineString, Position } from "geojson";
import { distance as turfDistance } from "@turf/turf";

/**
 * One distance label point: a 2D coordinate where the label sits, the cumulative
 * distance from the start of the track in kilometres, and the index of the
 * sub-line + vertex it belongs to (used to build stable feature IDs).
 */
export interface DistanceLabel {
  coord: [number, number];
  km: number;
  subLineIndex: number;
  vertexIndex: number;
}

/**
 * Walk every vertex of a MultiLineString and build a label for the END of each
 * line-segment. The cumulative distance counter is continuous across sub-lines
 * (we do not insert the gap between sub-line[i].end and sub-line[i+1].start).
 *
 * The very first vertex (km = 0) gets no label since "distance from start" of
 * zero carries no information.
 */
export function computeDistanceLabels(geometry: MultiLineString): DistanceLabel[] {
  const labels: DistanceLabel[] = [];
  let cumulativeKm = 0;

  geometry.coordinates.forEach((line, subLineIndex) => {
    for (let i = 1; i < line.length; i++) {
      const prev = line[i - 1];
      const curr = line[i];
      cumulativeKm += segmentDistanceKm(prev, curr);

      labels.push({
        coord: [curr[0], curr[1]],
        km: cumulativeKm,
        subLineIndex,
        vertexIndex: i,
      });
    }
  });

  return labels;
}

/**
 * Distance between two GeoJSON positions in kilometres. turf.distance accepts
 * 2D-or-3D coordinates and ignores the third dimension itself, so callers can
 * pass [lon, lat, ele] as-is.
 */
function segmentDistanceKm(a: Position, b: Position): number {
  return turfDistance([a[0], a[1]], [b[0], b[1]], { units: "kilometers" });
}

/**
 * Format a distance in km for on-map display: "0.42 km" below 1 km, "1.2 km"
 * up to 10 km, "12 km" beyond. Keeps the labels short enough to read.
 */
export function formatLabelKm(km: number): string {
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 10) return `${km.toFixed(2)} km`;
  return `${km.toFixed(1)} km`;
}
