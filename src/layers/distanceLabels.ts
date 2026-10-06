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
  /** Text shown on the label when it differs from the position km (origin-offset roadbooks). */
  labelKm?: number;
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
 * Build labels at exact requested cumulative distances.
 *
 * Unlike computeDistanceLabels(), these labels are not restricted to existing
 * vertices. They are linearly interpolated along the segment containing the
 * requested distance, matching the slicing/highlight behaviour.
 */
export function computeDistanceLabelsAtDistances(
  geometry: MultiLineString,
  distancesKm: ReadonlyArray<number>,
  originKm = 0,
): DistanceLabel[] {
  const labels: DistanceLabel[] = [];
  const seenKeys = new Set<string>();
  // Segment lengths computed once and shared by every label: recomputing them
  // per label made a 200-row CSV on a 4000-point track freeze WME for ~4 s.
  const segLens = geometry.coordinates.map((line) =>
    line.slice(1).map((curr, i) => segmentDistanceKm(line[i], curr)),
  );

  for (const km of distancesKm) {
    if (!Number.isFinite(km)) continue;

    const key = km.toFixed(6);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    // The geometry may start at roadbook km `originKm` (leading slice not
    // displayed): place the label at (km − originKm) along the geometry but
    // keep the roadbook value as the label text.
    const positionKm = km - originKm;
    if (positionKm < 0) continue;

    const label = computeDistanceLabelAtDistance(geometry, positionKm, segLens);
    if (label) labels.push({ ...label, labelKm: km });
  }

  return labels.sort((a, b) => a.km - b.km);
}

function computeDistanceLabelAtDistance(
  geometry: MultiLineString,
  targetKm: number,
  segLens: number[][],
): DistanceLabel | null {
  let cumulativeKm = 0;

  for (let subLineIndex = 0; subLineIndex < geometry.coordinates.length; subLineIndex++) {
    const line = geometry.coordinates[subLineIndex];
    if (line.length === 0) continue;

    if (targetKm <= cumulativeKm) {
      const first = line[0];
      return {
        coord: [first[0], first[1]],
        km: targetKm,
        subLineIndex,
        vertexIndex: 0,
      };
    }

    for (let i = 1; i < line.length; i++) {
      const prev = line[i - 1];
      const curr = line[i];
      const segmentKm = segLens[subLineIndex][i - 1];
      const segmentStartKm = cumulativeKm;
      const segmentEndKm = cumulativeKm + segmentKm;

      if (targetKm <= segmentEndKm) {
        const t = segmentKm === 0 ? 0 : Math.max(0, targetKm - segmentStartKm) / segmentKm;
        return {
          coord: [prev[0] + (curr[0] - prev[0]) * t, prev[1] + (curr[1] - prev[1]) * t],
          km: targetKm,
          subLineIndex,
          vertexIndex: i,
        };
      }

      cumulativeKm = segmentEndKm;
    }
  }

  return null;
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
