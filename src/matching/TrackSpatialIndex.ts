import RBush from "rbush";
import {
  bearing as turfBearing,
  length as turfLength,
  lineString,
  point,
  pointToLineDistance,
} from "@turf/turf";
import type { Feature, LineString, Position } from "geojson";

// Approximate meters-per-degree latitude (constant)
const METERS_PER_DEG_LAT = 111320;

interface EdgeItem {
  // rbush bbox
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  // edge geometry
  a: Position;
  b: Position;
  edgeLine: Feature<LineString>;
  bearing: number;
  // cumulative chainage at start of edge (km)
  chainageStartKm: number;
  // length of edge (km)
  edgeLengthKm: number;
}

export interface TrackSpatialIndex {
  readonly feature: Feature<LineString>;
  readonly totalLengthMeters: number;
  nearestEdgeProjection(
    posit: Position,
    maxDistanceMeters: number,
  ): { distanceMeters: number; locationKm: number; bearingDeg: number } | null;
  nearestEdgeProjectionUnbounded(posit: Position): {
    distanceMeters: number;
    locationKm: number;
    bearingDeg: number;
  };
}

export function buildTrackSpatialIndex(track: Feature<LineString>): TrackSpatialIndex {
  const coords = track.geometry.coordinates;
  const tree = new RBush<EdgeItem>();
  const items: EdgeItem[] = [];
  let chainageKm = 0;

  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    if (a[0] === b[0] && a[1] === b[1]) continue;

    const edgeLine = lineString([a, b]);
    const edgeLengthKm = turfLength(edgeLine, { units: "kilometers" });
    const bearing = turfBearing(point(a), point(b));

    const item: EdgeItem = {
      minX: Math.min(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxX: Math.max(a[0], b[0]),
      maxY: Math.max(a[1], b[1]),
      a,
      b,
      edgeLine,
      bearing,
      chainageStartKm: chainageKm,
      edgeLengthKm,
    };
    items.push(item);
    chainageKm += edgeLengthKm;
  }

  tree.load(items);

  const totalLengthMeters = chainageKm * 1000;

  function projectOntoEdge(
    posit: Position,
    item: EdgeItem,
  ): { distanceMeters: number; locationKm: number } {
    const distanceMeters = pointToLineDistance(point(posit), item.edgeLine, { units: "meters" });

    // Compute t using cosine-corrected Cartesian projection so longitude and
    // latitude deltas have comparable metric weight.
    const [ax, ay] = item.a;
    const [bx, by] = item.b;
    const cosLat = Math.cos(((ay + by) / 2) * (Math.PI / 180));
    const dx = (bx - ax) * cosLat;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((posit[0] - ax) * cosLat * dx + (posit[1] - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const locationKm = item.chainageStartKm + t * item.edgeLengthKm;
    return { distanceMeters, locationKm };
  }

  function queryBest(
    posit: Position,
    paddingDeg: number,
  ): { distanceMeters: number; locationKm: number; bearingDeg: number } | null {
    const candidates = tree.search({
      minX: posit[0] - paddingDeg,
      minY: posit[1] - paddingDeg,
      maxX: posit[0] + paddingDeg,
      maxY: posit[1] + paddingDeg,
    });

    if (candidates.length === 0) return null;

    let bestDist = Number.POSITIVE_INFINITY;
    let bestLoc = 0;
    let bestBearing = 0;

    for (const item of candidates) {
      const { distanceMeters, locationKm } = projectOntoEdge(posit, item);
      if (distanceMeters < bestDist) {
        bestDist = distanceMeters;
        bestLoc = locationKm;
        bestBearing = item.bearing;
      }
    }

    return { distanceMeters: bestDist, locationKm: bestLoc, bearingDeg: bestBearing };
  }

  return {
    feature: track,
    totalLengthMeters,

    nearestEdgeProjection(
      posit: Position,
      maxDistanceMeters: number,
    ): { distanceMeters: number; locationKm: number; bearingDeg: number } | null {
      // Pad bbox by maxDistance converted to degrees (lat correction for lng)
      const lat = posit[1];
      const latPad = maxDistanceMeters / METERS_PER_DEG_LAT;
      const lngPad = maxDistanceMeters / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      const paddingDeg = Math.max(latPad, lngPad);

      const result = queryBest(posit, paddingDeg);
      if (result === null || result.distanceMeters > maxDistanceMeters) return null;
      return result;
    },

    nearestEdgeProjectionUnbounded(posit: Position): {
      distanceMeters: number;
      locationKm: number;
      bearingDeg: number;
    } {
      if (items.length === 0) {
        return { distanceMeters: 0, locationKm: 0, bearingDeg: 0 };
      }
      // Expand the search radius geometrically until the best candidate's
      // distance is within the searched radius. Once D ≤ R, the AABB
      // argument guarantees no edge outside the search box can be closer:
      // any such edge's bbox is at least R away, so its perpendicular foot
      // is also at least R away. No confirmation pass is needed.
      const cosLat = Math.cos((posit[1] * Math.PI) / 180);
      let radiusMeters = 50;
      const maxRadiusMeters = 100_000;

      while (radiusMeters <= maxRadiusMeters) {
        const latPad = radiusMeters / METERS_PER_DEG_LAT;
        const lngPad = radiusMeters / (METERS_PER_DEG_LAT * Math.max(cosLat, 1e-6));
        const paddingDeg = Math.max(latPad, lngPad);
        const result = queryBest(posit, paddingDeg);
        if (result !== null && result.distanceMeters <= radiusMeters) {
          return result;
        }
        radiusMeters *= 4;
      }

      // Fallback: scan all edges. Should never fire on a normal track.
      let bestDist = Number.POSITIVE_INFINITY;
      let bestLoc = 0;
      let bestBearing = 0;
      for (const item of items) {
        const { distanceMeters, locationKm } = projectOntoEdge(posit, item);
        if (distanceMeters < bestDist) {
          bestDist = distanceMeters;
          bestLoc = locationKm;
          bestBearing = item.bearing;
        }
      }
      return { distanceMeters: bestDist, locationKm: bestLoc, bearingDeg: bestBearing };
    },
  };
}
