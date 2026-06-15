import type { MultiLineString, Position } from "geojson";
import type { NormalizedTrack } from "../geojson/types";
import { multiLineLengthKm } from "./trackPortions";

const EARTH_RADIUS_KM = 6371;

export interface TrackChain {
  index: number;
  id: string;
  geometry: MultiLineString;
  lengthKm: number;
}

function isValidSubLine(coordinates: Position[]): boolean {
  return coordinates.length >= 2;
}

/**
 * Enumerate valid chains from a track by splitting on each MultiLineString
 * sub-line while preserving input order.
 */
export function listTrackChains(track: NormalizedTrack): TrackChain[] {
  const chains: TrackChain[] = [];

  track.geometry.coordinates.forEach((subLine) => {
    if (!isValidSubLine(subLine)) {
      return;
    }

    const geometry: MultiLineString = {
      type: "MultiLineString",
      coordinates: [subLine],
    };

    const index = chains.length;
    chains.push({
      index,
      id: `chain-${index}`,
      geometry,
      lengthKm: multiLineLengthKm(geometry),
    });
  });

  return chains;
}

function haversineKm(a: Position, b: Position): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Try to merge chains when endpoints are close enough to be considered
 * continuous. This does not rebuild topology; it only stitches likely
 * contiguous pieces to reduce fragmentation before matching.
 */
export function mergeTrackChainsByEndpoints(
  chains: readonly TrackChain[],
  maxEndpointGapKm = Number.POSITIVE_INFINITY,
): TrackChain[] {
  if (chains.length <= 1) {
    return [...chains];
  }

  interface MutableChain {
    id: string;
    coordinates: Position[];
  }

  const mutable: MutableChain[] = chains
    .map((chain) => {
      const line = chain.geometry.coordinates[0];
      return line && line.length >= 2 ? { id: chain.id, coordinates: [...line] } : null;
    })
    .filter((chain): chain is MutableChain => chain !== null);

  const mergedComponents: MutableChain[] = [];

  type Attachment = {
    remainingIndex: number;
    distance: number;
    mergedCoords: Position[];
    mergedId: string;
  };

  while (mutable.length > 0) {
    // Start from the first remaining piece, then greedily reorder and attach
    // only endpoints that satisfy the distance threshold.
    const seed = mutable.shift();
    if (!seed) {
      break;
    }

    let orderedCoords = [...seed.coordinates];
    let orderedId = seed.id;

    while (mutable.length > 0) {
      const head = orderedCoords[0];
      const tail = orderedCoords[orderedCoords.length - 1];
      let best: Attachment | null = null;

      for (let i = 0; i < mutable.length; i++) {
        const piece = mutable[i];
        const forward = piece.coordinates;
        const backward = [...piece.coordinates].reverse();
        const fStart = forward[0];
        const fEnd = forward[forward.length - 1];
        const bStart = backward[0];
        const bEnd = backward[backward.length - 1];

        const candidates: Attachment[] = [
          {
            remainingIndex: i,
            distance: haversineKm(tail, fStart),
            mergedCoords: [...orderedCoords, ...forward.slice(1)],
            mergedId: `${orderedId}+${piece.id}`,
          },
          {
            remainingIndex: i,
            distance: haversineKm(tail, bStart),
            mergedCoords: [...orderedCoords, ...backward.slice(1)],
            mergedId: `${orderedId}+${piece.id}`,
          },
          {
            remainingIndex: i,
            distance: haversineKm(fEnd, head),
            mergedCoords: [...forward, ...orderedCoords.slice(1)],
            mergedId: `${piece.id}+${orderedId}`,
          },
          {
            remainingIndex: i,
            distance: haversineKm(bEnd, head),
            mergedCoords: [...backward, ...orderedCoords.slice(1)],
            mergedId: `${piece.id}+${orderedId}`,
          },
        ];

        for (const candidate of candidates) {
          if (candidate.distance > maxEndpointGapKm) {
            continue;
          }
          if (!best || candidate.distance < best.distance) {
            best = candidate;
          }
        }
      }

      if (!best) {
        break;
      }

      mutable.splice(best.remainingIndex, 1);
      orderedCoords = best.mergedCoords;
      orderedId = best.mergedId;
    }

    mergedComponents.push({
      id: orderedId,
      coordinates: orderedCoords,
    });
  }

  const result: TrackChain[] = [];

  mergedComponents.forEach((piece, idx) => {
    const geometry: MultiLineString = {
      type: "MultiLineString",
      coordinates: [piece.coordinates],
    };
    result.push({
      index: idx,
      id: `chain-${idx}`,
      geometry,
      lengthKm: multiLineLengthKm(geometry),
    });
  });

  return result;
}
