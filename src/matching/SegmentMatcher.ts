/**
 * SegmentMatcher — pure module, no SDK imports, no DOM.
 *
 * matchSegments() tests each segment's LineString geometry against the
 * pre-buffered track polygon and returns the set of matching segment IDs.
 *
 * Deduplication is implicit because we use a Set<number> as the return type.
 * The caller is responsible for accumulating results across multiple cells and
 * computing the delta of new IDs per cell.
 */
import {
  along,
  bearing as turfBearing,
  booleanIntersects,
  booleanPointInPolygon,
  length as turfLength,
  lineString,
  point,
} from "@turf/turf";
import type {
  Feature,
  LineString,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
import type { MatchArgs } from "./types";
import { buildTrackSpatialIndex, type TrackSpatialIndex } from "./TrackSpatialIndex";

export interface MatchSegmentsAsyncOptions {
  chunkSize?: number;
  yieldBetweenChunks?: () => Promise<void>;
}

const SAMPLE_SPACING_METERS = 10;
const MIN_SAMPLE_COUNT = 7;
const MAX_SAMPLE_COUNT = 41;
const BUFFER_MATCH_METERS = 15.5;

const LONG_OFF_TRACK_MIN_LENGTH_METERS = 50;
const LONG_OFF_TRACK_MAX_INSIDE_RATIO = 0.6;
const LONG_OFF_TRACK_MIN_SPAN_RATIO = 0.45;

const ENDPOINT_DRIFT_MIN_LENGTH_METERS = 40;
const ENDPOINT_DRIFT_MAX_DISTANCE_METERS = 25;
const ENDPOINT_DRIFT_MAX_INSIDE_RATIO = 0.85;
const ENDPOINT_DRIFT_MIN_SPAN_RATIO = 0.75;

const COMPETITION_MIN_OVERLAP_RATIO = 0.7;
const COMPETITION_MIN_BETTER_DISTANCE_METERS = 2.5;
const COMPETITION_MIN_BETTER_MAX_DISTANCE_METERS = 3;
const COMPETITION_MIN_BETTER_BEARING_DEG = 12;
const COMPETITION_NEAR_TRACK_MEAN_DISTANCE_METERS = 6;

const SHORT_SPUR_CLUSTER_MAX_LENGTH_METERS = 20;
const SHORT_SPUR_CLUSTER_MAX_PROJECTED_SPAN_METERS = 4;
const SHORT_SPUR_CLUSTER_MIN_BEARING_DELTA_DEG = 70;

interface TrackIndex {
  spatialIndex: TrackSpatialIndex;
}

interface SegmentAnalysis {
  id: number;
  feature: Feature<LineString>;
  lengthMeters: number;
  insideRatio: number;
  hasInteriorGap: boolean;
  meanDistanceMeters: number;
  maxDistanceMeters: number;
  projectedStartMeters: number;
  projectedEndMeters: number;
  projectedSpanMeters: number;
  projectedSpanRatio: number;
  meanBearingDeltaDeg: number;
}

/**
 * Return the set of segment IDs whose geometry intersects the buffered track.
 *
 * A segment is matched when ANY part of it falls inside or crosses the buffer
 * boundary — even a single shared point suffices.  This matches the PRD
 * criterion "Segment crossing buffer at one point → matched."
 */
export function matchSegments(args: MatchArgs): Set<number> {
  const { segments, bufferedTrack } = args;
  const matched = new Set<number>();
  const trackIndex = buildTrackIndex(resolveTrack(args));
  const acceptedCandidates: SegmentAnalysis[] = [];

  for (const segment of segments) {
    const segFeature: Feature<LineString> = {
      type: "Feature",
      geometry: segment.geometry,
      properties: null,
    };

    if (!booleanIntersects(segFeature, bufferedTrack)) {
      continue;
    }

    if (!trackIndex) {
      matched.add(segment.id);
      continue;
    }

    const analysis = analyzeSegment(segment.id, segFeature, bufferedTrack, trackIndex);
    if (passesIndividualFilters(analysis)) {
      acceptedCandidates.push(analysis);
    }
  }

  for (const candidate of applyCompetitionFilter(acceptedCandidates)) {
    matched.add(candidate.id);
  }

  return matched;
}

/**
 * Async variant of matchSegments that yields between chunks so callers can
 * keep the browser responsive during large per-view matching runs.
 */
export async function matchSegmentsAsync(
  args: MatchArgs,
  options: MatchSegmentsAsyncOptions = {},
): Promise<Set<number>> {
  const { segments, bufferedTrack } = args;
  const matched = new Set<number>();
  const chunkSize = options.chunkSize ?? 20;
  const yieldBetweenChunks = options.yieldBetweenChunks;
  const trackIndex = buildTrackIndex(resolveTrack(args));
  const acceptedCandidates: SegmentAnalysis[] = [];

  for (let start = 0; start < segments.length; start += chunkSize) {
    const chunk = segments.slice(start, start + chunkSize);

    for (const segment of chunk) {
      const segFeature: Feature<LineString> = {
        type: "Feature",
        geometry: segment.geometry,
        properties: null,
      };

      if (!booleanIntersects(segFeature, bufferedTrack)) {
        continue;
      }

      if (!trackIndex) {
        matched.add(segment.id);
        continue;
      }

      const analysis = analyzeSegment(segment.id, segFeature, bufferedTrack, trackIndex);
      if (passesIndividualFilters(analysis)) {
        acceptedCandidates.push(analysis);
      }
    }

    if (yieldBetweenChunks && start + chunkSize < segments.length) {
      await yieldBetweenChunks();
    }
  }

  for (const candidate of applyCompetitionFilter(acceptedCandidates)) {
    matched.add(candidate.id);
  }

  return matched;
}

function resolveTrack(args: MatchArgs): MultiLineString | null {
  if (args.track) return args.track;

  const properties = args.bufferedTrack.properties as { track?: unknown } | null | undefined;
  const track = properties?.track;
  if (
    typeof track === "object" &&
    track !== null &&
    (track as { type?: unknown }).type === "MultiLineString" &&
    Array.isArray((track as { coordinates?: unknown }).coordinates)
  ) {
    return track as MultiLineString;
  }

  return null;
}

function buildTrackIndex(track: MultiLineString | null): TrackIndex | null {
  if (!track || track.coordinates.length === 0) {
    return null;
  }

  const flattened = track.coordinates.flat();
  if (flattened.length < 2) {
    return null;
  }

  const flatFeature: Feature<LineString> = {
    type: "Feature",
    geometry: lineString(flattened).geometry,
    properties: null,
  };

  const spatialIndex = buildTrackSpatialIndex(flatFeature);
  if (spatialIndex.totalLengthMeters === 0) {
    return null;
  }

  return { spatialIndex };
}

function analyzeSegment(
  id: number,
  feature: Feature<LineString>,
  bufferedTrack: Feature<Polygon | MultiPolygon>,
  trackIndex: TrackIndex,
): SegmentAnalysis {
  const lengthMeters = turfLength(feature, { units: "meters" });
  const samples = sampleSegment(feature, lengthMeters);
  const inside = samples.map((sample) =>
    booleanPointInPolygon(sample, bufferedTrack, { ignoreBoundary: false }),
  );
  const projections = samples.map((sample) =>
    trackIndex.spatialIndex.nearestEdgeProjectionUnbounded(sample.geometry.coordinates),
  );
  const distances = projections.map((p) => p.distanceMeters);
  const locations = projections.map((p) => p.locationKm * 1000);
  const projectedStartMeters = Math.min(...locations);
  const projectedEndMeters = Math.max(...locations);
  const projectedSpanMeters = projectedEndMeters - projectedStartMeters;

  return {
    id,
    feature,
    lengthMeters,
    insideRatio: inside.filter(Boolean).length / inside.length,
    hasInteriorGap: containsInteriorGap(inside),
    meanDistanceMeters: mean(distances),
    maxDistanceMeters: Math.max(...distances),
    projectedStartMeters,
    projectedEndMeters,
    projectedSpanMeters,
    projectedSpanRatio: lengthMeters > 0 ? projectedSpanMeters / lengthMeters : 0,
    meanBearingDeltaDeg: mean(
      segmentBearingDeltas(feature.geometry.coordinates, trackIndex.spatialIndex),
    ),
  };
}

function passesIndividualFilters(analysis: SegmentAnalysis): boolean {
  if (analysis.hasInteriorGap && analysis.insideRatio < 0.7) {
    return false;
  }

  if (
    analysis.lengthMeters >= LONG_OFF_TRACK_MIN_LENGTH_METERS &&
    analysis.insideRatio < LONG_OFF_TRACK_MAX_INSIDE_RATIO &&
    analysis.projectedSpanRatio >= LONG_OFF_TRACK_MIN_SPAN_RATIO
  ) {
    return false;
  }

  if (
    analysis.lengthMeters >= ENDPOINT_DRIFT_MIN_LENGTH_METERS &&
    analysis.maxDistanceMeters > ENDPOINT_DRIFT_MAX_DISTANCE_METERS &&
    analysis.insideRatio < ENDPOINT_DRIFT_MAX_INSIDE_RATIO &&
    analysis.projectedSpanRatio >= ENDPOINT_DRIFT_MIN_SPAN_RATIO
  ) {
    return false;
  }

  return true;
}

function applyCompetitionFilter(candidates: SegmentAnalysis[]): SegmentAnalysis[] {
  const rejected = new Set<number>();

  for (const candidate of candidates) {
    if (isShortSpurClusterMember(candidate, candidates)) {
      rejected.add(candidate.id);
      continue;
    }

    for (const rival of candidates) {
      if (candidate === rival) continue;
      if (rejected.has(candidate.id)) continue;
      if (rejected.has(rival.id)) continue;
      if (!stronglyOverlaps(candidate, rival)) continue;

      const rivalIsClearlyCloser =
        candidate.meanDistanceMeters - rival.meanDistanceMeters >=
        COMPETITION_MIN_BETTER_DISTANCE_METERS;
      const rivalIsClearlyBetterAligned =
        candidate.meanBearingDeltaDeg - rival.meanBearingDeltaDeg >=
        COMPETITION_MIN_BETTER_BEARING_DEG;
      const candidateIsNotCenterline =
        candidate.meanDistanceMeters > COMPETITION_NEAR_TRACK_MEAN_DISTANCE_METERS ||
        candidate.meanBearingDeltaDeg > COMPETITION_MIN_BETTER_BEARING_DEG;
      const rivalIsCloserTwin =
        candidate.insideRatio > 0.95 &&
        candidate.meanDistanceMeters - rival.meanDistanceMeters >= 0.5 &&
        candidate.maxDistanceMeters - rival.maxDistanceMeters >=
          COMPETITION_MIN_BETTER_MAX_DISTANCE_METERS;

      if (
        (candidateIsNotCenterline && rivalIsClearlyCloser && rivalIsClearlyBetterAligned) ||
        rivalIsCloserTwin
      ) {
        rejected.add(candidate.id);
      }
    }
  }

  return candidates.filter((candidate) => !rejected.has(candidate.id));
}

function isShortSpurClusterMember(
  candidate: SegmentAnalysis,
  candidates: SegmentAnalysis[],
): boolean {
  if (
    candidate.lengthMeters > SHORT_SPUR_CLUSTER_MAX_LENGTH_METERS ||
    candidate.projectedSpanMeters > SHORT_SPUR_CLUSTER_MAX_PROJECTED_SPAN_METERS ||
    candidate.meanBearingDeltaDeg < SHORT_SPUR_CLUSTER_MIN_BEARING_DELTA_DEG
  ) {
    return false;
  }

  return candidates.some(
    (rival) =>
      rival !== candidate &&
      rival.lengthMeters <= SHORT_SPUR_CLUSTER_MAX_LENGTH_METERS &&
      rival.projectedSpanMeters <= SHORT_SPUR_CLUSTER_MAX_PROJECTED_SPAN_METERS &&
      rival.meanBearingDeltaDeg >= SHORT_SPUR_CLUSTER_MIN_BEARING_DELTA_DEG &&
      stronglyOverlaps(candidate, rival),
  );
}

function stronglyOverlaps(a: SegmentAnalysis, b: SegmentAnalysis): boolean {
  const overlap =
    Math.min(a.projectedEndMeters, b.projectedEndMeters) -
    Math.max(a.projectedStartMeters, b.projectedStartMeters);
  if (overlap <= 0) return false;

  const shorterSpan = Math.min(a.projectedSpanMeters, b.projectedSpanMeters);
  if (shorterSpan <= 0) return false;

  return overlap / shorterSpan >= COMPETITION_MIN_OVERLAP_RATIO;
}

function sampleSegment(feature: Feature<LineString>, lengthMeters: number): Feature<Point>[] {
  if (lengthMeters === 0) {
    return [point(feature.geometry.coordinates[0])];
  }

  const count = Math.max(
    MIN_SAMPLE_COUNT,
    Math.min(MAX_SAMPLE_COUNT, Math.ceil(lengthMeters / SAMPLE_SPACING_METERS) + 1),
  );

  return Array.from({ length: count }, (_, index) =>
    along(feature, (lengthMeters * index) / (count - 1), { units: "meters" }),
  );
}

function containsInteriorGap(inside: boolean[]): boolean {
  const firstInside = inside.indexOf(true);
  const lastInside = inside.lastIndexOf(true);
  if (firstInside < 0 || lastInside <= firstInside) return false;

  return inside.slice(firstInside, lastInside + 1).some((value) => !value);
}

function segmentBearingDeltas(coordinates: Position[], spatialIndex: TrackSpatialIndex): number[] {
  const deltas: number[] = [];

  for (let index = 1; index < coordinates.length; index++) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    if (a[0] === b[0] && a[1] === b[1]) continue;

    const midpoint: Position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const segmentBearing = normalizeHalfCircleBearing(turfBearing(point(a), point(b)));
    const projection = spatialIndex.nearestEdgeProjectionUnbounded(midpoint);
    const trackBearing = normalizeHalfCircleBearing(projection.bearingDeg);
    deltas.push(angleDelta(segmentBearing, trackBearing));
  }

  return deltas;
}

function normalizeHalfCircleBearing(value: number): number {
  return ((value % 180) + 180) % 180;
}

function angleDelta(a: number, b: number): number {
  const delta = Math.abs(a - b) % 180;
  return delta > 90 ? 180 - delta : delta;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
