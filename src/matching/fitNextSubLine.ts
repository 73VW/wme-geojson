import type { MultiLineString } from "geojson";
import { bbox4OfMultiLineString, multiLineLengthKm } from "./trackPortions";

const VIEW_SLICE_EPSILON_KM = 0.005;
const DEFAULT_MIN_SPAN_KM = 0.01;
const VIEW_SLICE_HEAD_RATIO = 0.75;

export interface PendingRange {
  kmA: number;
  kmB: number;
}

export interface FittedSubLine {
  kmA: number;
  kmB: number;
  bbox: [number, number, number, number];
  view: { lon: number; lat: number; zoom: number };
}

export interface FitInput {
  pending: PendingRange;
  geometry: MultiLineString; // geometry covering [pending.kmA, pending.kmB]
  targetZoom: number;
  evaluateZoom(geom: MultiLineString): number; // pure delegate (Pipeline wraps zoomToExtent)
  sliceByKm(geom: MultiLineString, kmA: number, kmB: number): MultiLineString;
  minSpanKm?: number;
}

export interface FitResult {
  accepted: FittedSubLine;
  remainder: PendingRange | null;
}

export function fitNextSubLine(input: FitInput): FitResult {
  const minSpan = input.minSpanKm ?? DEFAULT_MIN_SPAN_KM;
  let headKmA = input.pending.kmA;
  let headGeom = input.geometry;
  // Track whether we've sliced the geometry: if we haven't, use pending.kmB to
  // avoid floating-point drift from geodesic length re-measurement.
  let sliced = false;

  while (headGeom.coordinates.length > 0) {
    const zoom = input.evaluateZoom(headGeom);
    const headKmB = sliced ? headKmA + multiLineLengthKm(headGeom) : input.pending.kmB;
    const box4 = bbox4OfMultiLineString(headGeom);
    if (!box4) {
      throw new Error("fitNextSubLine: empty bbox");
    }
    const span = headKmB - headKmA;
    const accept = (): FitResult => {
      const remainder =
        input.pending.kmB - headKmB > VIEW_SLICE_EPSILON_KM
          ? { kmA: headKmB, kmB: input.pending.kmB }
          : null;
      return {
        accepted: {
          kmA: headKmA,
          kmB: headKmB,
          bbox: box4,
          view: { lon: (box4[0] + box4[2]) / 2, lat: (box4[1] + box4[3]) / 2, zoom },
        },
        remainder,
      };
    };
    if (zoom >= input.targetZoom) return accept();
    if (span <= minSpan) return accept();

    const newKmB = headKmA + span * VIEW_SLICE_HEAD_RATIO;
    if (newKmB - headKmA <= VIEW_SLICE_EPSILON_KM) return accept();

    const next = input.sliceByKm(input.geometry, headKmA, newKmB);
    if (next.coordinates.length === 0) return accept();
    headGeom = next;
    sliced = true;
  }

  throw new Error("fitNextSubLine: exited loop without accepting a slice");
}
