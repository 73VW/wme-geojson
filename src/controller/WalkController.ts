/**
 * WalkController — orchestrates the grid walk, segment fetching, and matching.
 *
 * This is the Palier 3 full implementation.  It replaces the Palier 2 stub
 * that immediately transitioned idle → walking → done.
 *
 * Responsibilities:
 *  - Measure the viewport size once (cached per instance).
 *  - Call GridWalker.planWalk() to compute the ordered cell list.
 *  - Walk each cell: setMapCenter → waitForMapIdle → getAll segments →
 *    matchSegments → cache new geometries → emit events.
 *  - Honour stop() between cells (current cell always completes).
 *  - Manage state transitions via walkStates.isTransitionAllowed.
 *
 * Event API:
 *  onStateChange  — fires on every state transition.
 *  onProgress     — fires after each cell with (visitedCount, totalCount, newIds[]).
 *  onMatchFound   — fires once per newly-matched ID with (id, geometry).
 */
import type { RoadTypeId, Segment, WmeSDK } from "wme-sdk-typings";
import type { Feature, LineString, MultiLineString, Position } from "geojson";
import {
  bearing as turfBearing,
  buffer as turfBuffer,
  center as turfCenter,
  distance as turfDistance,
  lineString as turfLineString,
  length as turfLength,
  nearestPointOnLine,
  point as turfPoint,
  pointToLineDistance,
} from "@turf/turf";
import { logger } from "../utils/logger";
import { measureViewportAtZ17 } from "../utils/measureViewport";
import { waitForMapIdle } from "../utils/waitForMapIdle";
import { planWalk } from "../matching/GridWalker";
import { matchSegments, matchSegmentsAsync } from "../matching/SegmentMatcher";
import { buildTrackSpatialIndex, type TrackSpatialIndex } from "../matching/TrackSpatialIndex";
import { sliceMultiLineByDistance } from "../matching/trackPortions";
import { effectiveSampleSpacingProjection } from "../matching/sampleSpacing";
import type { ViewportSizeDeg } from "../matching/viewportSize";
import type { Cell } from "../matching/types";
import { type WalkState, isTransitionAllowed } from "./walkStates";

/** Zoom level at which WME reliably loads segment data. */
const SEGMENT_ZOOM_LEVEL = 17 as const;

/** Buffer radius around the track used for matching. */
const BUFFER_METERS = 15;

/** Overlap between adjacent cells; 20% ensures no gaps at cell boundaries. */
const OVERLAP_RATIO = 0.2;

/** Yield duration between cells to keep the UI thread responsive. */
const YIELD_BETWEEN_CELLS_MS = 50;

/**
 * Per-view matching guard: a segment must have at least two vertices near the
 * sliced track centerline, otherwise we treat it as an endpoint-touch false positive.
 */
const MIN_CLOSE_VERTICES_FOR_VIEW_MATCH = 2;
const CLOSE_VERTEX_DISTANCE_METERS = 10;
const MIN_CLOSE_VERTEX_SPAN_METERS = 30;
const CLOSE_SAMPLE_DISTANCE_METERS = 15;
const VERY_CLOSE_SAMPLE_DISTANCE_METERS = 10;
const MIN_CLOSE_SAMPLE_RATIO_FOR_VIEW_MATCH = 0.55;
const MIN_VERY_CLOSE_SAMPLE_RATIO_FOR_VIEW_MATCH = 0.3;
const MIN_CLOSE_SAMPLE_PROJECTED_SPAN_METERS = 30;
const START_BOUNDARY_MAX_DISTANCE_METERS = 20;
const START_BOUNDARY_MAX_ANGLE_DEG = 20;
const END_BOUNDARY_MAX_DISTANCE_METERS = 30;
const END_BOUNDARY_MAX_ANGLE_DEG = 20;
const TRACK_END_EPSILON_KM = 0.001;
const PROJECTED_DISTANCE_MAX_METERS = 45;
const PROJECTED_COVERAGE_MIN_RATIO = 0.6;
const PROJECTED_MAX_SAMPLES_PER_SEGMENT = 25;
const PROJECTED_CHAINAGE_EPSILON_KM = 0.01;
const PROJECTED_OVERRIDE_MIN_SPAN_METERS = 40;
const SAMPLED_CANDIDATE_BBOX_PADDING_DEGREES = 0.0007;
const PAST_BOUNDARY_OFF_SLICE_DISTANCE_METERS = 15;
const PAST_BOUNDARY_MIN_VERTICES = 2;
const PAST_BOUNDARY_MIN_SPAN_METERS = 20;
const PAST_BOUNDARY_CHAINAGE_EPSILON_KM = 0.001;
// Degenerate micro-segment guard: reject when the segment is tiny AND its
// vertices span essentially zero geographic extent.
const DEGENERATE_MICRO_MAX_LENGTH_METERS = 5;
const DEGENERATE_MICRO_MAX_CLOSE_SPAN_METERS = 3;
// Parallel-spur guard: within keptCloseVertexSpan, reject when the ratio of
// very-close samples to close samples falls below this threshold.  Spurs that
// run alongside the route have close samples at 10-15 m whereas real on-route
// segments have most close samples at < 10 m (very close).
const PARALLEL_SPUR_MIN_VERY_CLOSE_OF_CLOSE_RATIO = 0.75;
// Boundary-overhang guard: a segment that has even a single vertex at the
// slice boundary and beyond this distance is treated as having an overhang
// (softer alternative to extendsPastBoundary which requires ≥2 vertices
// and ≥20 m span).
const BOUNDARY_OVERHANG_MIN_DIST_METERS = 8;
// Relaxed coverage thresholds used when a boundary-overhang segment cannot
// satisfy the full hasEnoughSampledSliceCoverage check.
const BOUNDARY_CONTINUATION_MIN_CLOSE_SAMPLES = 2;
const BOUNDARY_CONTINUATION_MIN_VERY_CLOSE_SAMPLES = 1;
// Junction-arc false-positive guard (keptAllVerticesClose branch):
// tiny all-close segments whose samples project to edges with widely-varying
// bearings are roundabout arcs crossing a corner — reject them.
const JUNCTION_ARC_MAX_CLOSE_SPAN_METERS = 25;
const JUNCTION_ARC_MAX_BEARING_RANGE_DEG = 40;
// Chain-link bridge guard: a tiny segment whose BOTH endpoints are shared with
// other matched segments is a real connector — spare it from the junction-arc
// bearing rejection.  Coordinate match tolerance (degrees, ~1 m at mid-Europe).
const CHAIN_LINK_ENDPOINT_TOLERANCE_DEG = 0.00001;
// Boundary-overhang close-ratio floor: a segment kept via hasBoundaryOverhang
// must have at least this fraction of its samples close to the slice.  Prevents
// long "dangling approach" segments (body far from route, only tip at boundary)
// from slipping through on a single shared junction vertex.
const BOUNDARY_OVERHANG_MIN_CLOSE_RATIO = 0.25;

/**
 * Piste B — distance-to-centerline pre-filter.
 * Reject a segment only when ALL probe points are farther than this from the
 * slice centerline.  Using BUFFER_METERS + margin keeps this conservative.
 */
const CENTERLINE_PREFILTER_THRESHOLD_METERS = BUFFER_METERS + 5;

// Per-view matching can run just after map navigation; when data loading lags,
// getAll() may transiently return an empty or partial array even though the
// viewport is valid. Keep a short retry window and log attempts for field
// diagnostics.
const MATCH_SEGMENTS_RETRY_TIMEOUT_MS = 2_500;
const MATCH_SEGMENTS_RETRY_INTERVAL_MS = 150;
const MATCH_SEGMENTS_STABLE_POLLS = 2;
const MATCH_COMPUTE_YIELD_EVERY_SEGMENTS = 20;
/** How long (ms) the map must have been continuously stable before we skip the stable-poll loop. */
const STABILITY_GRACE_MS = 250;

const EXCLUDED_ROAD_TYPE = {
  WALKING_TRAIL: 5 as RoadTypeId,
  WALKWAY: 9 as RoadTypeId,
  PEDESTRIAN_BOARDWALK: 10 as RoadTypeId,
  FERRY: 15 as RoadTypeId,
  STAIRWAY: 16 as RoadTypeId,
  RAILROAD: 18 as RoadTypeId,
  RUNWAY_TAXIWAY: 19 as RoadTypeId,
} as const;

const EXCLUDED_MATCH_ROAD_TYPES = new Set<RoadTypeId>([
  EXCLUDED_ROAD_TYPE.WALKING_TRAIL,
  EXCLUDED_ROAD_TYPE.WALKWAY,
  EXCLUDED_ROAD_TYPE.PEDESTRIAN_BOARDWALK,
  EXCLUDED_ROAD_TYPE.FERRY,
  EXCLUDED_ROAD_TYPE.STAIRWAY,
  EXCLUDED_ROAD_TYPE.RAILROAD,
  EXCLUDED_ROAD_TYPE.RUNWAY_TAXIWAY,
]);

const DIAGNOSTIC_MATCH_SEGMENT_IDS = new Set<number>();

// ---------------------------------------------------------------------------
// Subscriber management helper (reused for all three event types)
// ---------------------------------------------------------------------------

type Callback<T extends unknown[]> = (...args: T) => void;

interface CenterlineFilterMetrics {
  input: number;
  rejected: number;
  kept: number;
  durationMs: number;
}

interface SampledSliceMatchMetrics {
  inputSegments: number;
  alreadyMatchedSkipped: number;
  bboxRejected: number;
  bboxCandidates: number;
  boundaryRejected: number;
  boundaryCandidates: number;
  coverageRejected: number;
  coverageAccepted: number;
  keptBoundaryGapContinuation: number;
}

interface EndpointFilterMetrics {
  inputMatched: number;
  missingSegment: number;
  keptProjectedOverride: number;
  keptBoundaryCoverage: number;
  droppedBoundaryCoverage: number;
  keptAllVerticesClose: number;
  droppedDegenerateMicro: number;
  droppedJunctionArcBearing: number;
  keptChainLink: number;
  keptCloseVertexSpan: number;
  droppedParallelSpur: number;
  keptSampledCoverage: number;
  keptBoundaryOverhangCoverage: number;
  droppedDanglingApproach: number;
  keptStartBoundaryContinuation: number;
  keptEndBoundaryContinuation: number;
  droppedEndpointTouch: number;
}

interface ProjectedSliceMatchMetrics {
  inputSegments: number;
  noGeometrySkipped: number;
  noSamplesSkipped: number;
  sampledSegments: number;
  noProjectedLocations: number;
  coverageRejected: number;
  chainageRejected: number;
  chainageAccepted: number;
}

interface CachedSegmentBBox {
  geometry: LineString;
  bbox: [number, number, number, number];
}

/**
 * Per-segment projection data computed once per (slice, segment) pair against the
 * slice spatial index.  Built lazily by `computeSliceProjection` and stored in a
 * `SegmentProjectionCache` that lives for the duration of a single slice.
 */
export interface SegmentProjection {
  sampleCount: number;
  samples: Array<{ distanceMeters: number; locationKm: number; bearingDeg: number } | null>;
  closeSamples: number;
  veryCloseSamples: number;
  projectedSpanMetersOnSlice: number;
}

/** Keyed by segment id; built once per slice, dropped when the slice completes. */
export type SegmentProjectionCache = Map<number, SegmentProjection>;

class EventEmitter<T extends unknown[]> {
  private readonly subscribers = new Map<number, Callback<T>>();
  private nextId = 0;

  subscribe(cb: Callback<T>): () => void {
    const id = this.nextId++;
    this.subscribers.set(id, cb);
    return () => {
      this.subscribers.delete(id);
    };
  }

  emit(...args: T): void {
    for (const cb of this.subscribers.values()) {
      try {
        cb(...args);
      } catch (err) {
        logger.error("WalkController: subscriber threw", err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// WalkController
// ---------------------------------------------------------------------------

export class WalkController {
  /** Current state; readable by the panel for initial render. */
  state: WalkState = "idle";

  /** Geometry cache: segmentId → LineString.  Populated during walk. */
  private readonly geometryCache = new Map<number, LineString>();

  /** BBox cache: segmentId → bbox, invalidated when WME swaps geometry objects. */
  private readonly segmentBBoxCache = new Map<number, CachedSegmentBBox>();

  /** Accumulated set of all matched segment IDs across all cells. */
  private readonly matchedIds = new Set<number>();

  /** Cached viewport size; measured once on the first walk. */
  private cachedViewportSize: ViewportSizeDeg | null = null;

  /** Set to true by stop(); checked at the top of each cell iteration. */
  private aborted = false;

  /** Total track length used to detect "last portion" boundary behavior. */
  private readonly trackTotalKm: number;

  /** Flattened full-track line used by projection-based fallback matching. */
  private readonly fullTrackLine: {
    type: "Feature";
    geometry: LineString;
    properties: null;
  } | null;

  // Internal event emitters
  private readonly stateEmitter = new EventEmitter<[WalkState]>();
  private readonly progressEmitter = new EventEmitter<[number, number, number[]]>();
  private readonly matchFoundEmitter = new EventEmitter<[number, LineString]>();

  /**
   * Adaptive polling state.
   * lastMapStableSinceMs — timestamp of the last isMapLoading true→false transition.
   * Starts at 0 so first call always uses the stable-poll path (conservative).
   */
  private lastMapStableSinceMs = 0;
  /** Whether isMapLoading was true on the previous wme-map-data-loaded event. */
  private _prevMapLoading = false;
  /** One-slot snapshot cache for inter-slice reuse. Invalidated when map starts loading. */
  private _snapshotCache: { segments: Segment[]; count: number } | null = null;
  /** Cleanup handle for the wme-map-data-loaded subscription. */
  private _unsubscribeMapDataLoaded: (() => void) | null = null;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly track: MultiLineString,
  ) {
    const flattened = track.coordinates.flat();
    this.fullTrackLine =
      flattened.length >= 2
        ? {
            type: "Feature",
            geometry: turfLineString(flattened).geometry,
            properties: null,
          }
        : null;

    this.trackTotalKm = turfLength(
      {
        type: "Feature",
        geometry: track,
        properties: null,
      },
      { units: "kilometers" },
    );

    // Track map stability for adaptive polling.
    this._subscribeMapDataLoaded();
  }

  /**
   * Release all resources held by this controller. Callers must invoke this
   * when the controller is no longer needed (e.g. new track loaded, panel closed).
   */
  dispose(): void {
    this._unsubscribeMapDataLoaded?.();
    this._unsubscribeMapDataLoaded = null;
    this._snapshotCache = null;
  }

  private _subscribeMapDataLoaded(): void {
    const eventsApi = (
      this.wmeSDK as unknown as {
        Events?: { on?: (args: { eventName: string; eventHandler: () => void }) => () => void };
      }
    ).Events;
    try {
      this._unsubscribeMapDataLoaded =
        eventsApi?.on?.({
          eventName: "wme-map-data-loaded",
          eventHandler: () => {
            const loading = this.isMapLoading();
            if (this._prevMapLoading && !loading) {
              this.lastMapStableSinceMs = Date.now();
            }
            if (loading) {
              this._snapshotCache = null;
            }
            this._prevMapLoading = loading;
          },
        }) ?? null;
    } catch (err) {
      logger.warn("WalkController: failed to subscribe to wme-map-data-loaded", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start the walk.  May be called from idle, done, cancelled, or error states
   * (the state machine allows all of these → walking transitions).
   */
  async start(): Promise<void> {
    // Guard double-start: if already walking, log and bail out instead of
    // raising an invalid-transition error that the caller would have to
    // handle. The transition guard below would still catch it, but a clean
    // early return keeps the API friendly to fire-and-forget callers.
    if (this.state === "walking") {
      logger.warn("WalkController.start: already walking, ignoring");
      return;
    }

    this.transition("walking");
    // Reset per-walk state AFTER the transition succeeds, so a failed
    // transition cannot wipe an in-flight walk's abort flag or accumulators.
    this.aborted = false;
    this.matchedIds.clear();
    this.geometryCache.clear();

    try {
      await this.runWalk();
    } catch (err) {
      // Catastrophic error (e.g. SDK crash).  Per-cell errors are handled
      // inside runWalk and do NOT bubble here.
      logger.error("WalkController: catastrophic walk error", err);
      this.transition("error");
    }
  }

  /**
   * Request cancellation.  The current cell will complete; the next cell
   * will detect the aborted flag and stop the walk.
   */
  stop(): void {
    logger.info("WalkController.stop: cancellation requested");
    this.aborted = true;
  }

  /** Subscribe to state transitions.  Returns an unsubscribe function. */
  onStateChange(cb: (state: WalkState) => void): () => void {
    return this.stateEmitter.subscribe(cb);
  }

  /**
   * Subscribe to per-cell progress updates.
   * Callback receives (visitedCount, totalCount, newIdsThisCell[]).
   */
  onProgress(cb: (visited: number, total: number, newIds: number[]) => void): () => void {
    return this.progressEmitter.subscribe(cb);
  }

  /**
   * Subscribe to match-found events.
   * Fires once per newly-matched segment ID with the segment's geometry.
   */
  onMatchFound(cb: (id: number, geometry: LineString) => void): () => void {
    return this.matchFoundEmitter.subscribe(cb);
  }

  /**
   * Return the cached geometry for a segment ID, or null if not cached.
   * Used by Palier 4 click-to-recenter.
   */
  getCachedGeometry(id: number): LineString | null {
    return this.geometryCache.get(id) ?? null;
  }

  /**
   * Return a snapshot of all matched segment IDs accumulated during the walk.
   *
   * Returns a readonly array so callers cannot mutate the internal set.
   * The snapshot is taken at call time; subsequent walk events will not be
   * reflected in the returned array.
   */
  getMatchedIds(): readonly number[] {
    return Array.from(this.matchedIds);
  }

  /**
   * Select all matched segments in WME via the Editing.setSelection SDK call.
   *
   * Architecture note: the actual SDK call lives here (controller) so that
   * the panel (ui/) stays SDK-free.  The panel owns modal-prompting and error
   * rendering; this method owns the selection call and throws on failure so
   * the panel can surface a typed error message.
   *
   * Throws an Error if the SDK call fails; the caller is responsible for
   * showing the error in the UI.
   */
  selectAll(): void {
    const ids = Array.from(this.matchedIds);

    if (ids.length === 0) {
      logger.warn("WalkController.selectAll: no matched IDs, nothing to select");
      return;
    }

    try {
      this.wmeSDK.Editing.setSelection({
        selection: { ids, objectType: "segment" },
      });
      logger.info(`WalkController.selectAll: selected ${ids.length} segment(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("WalkController.selectAll: SDK setSelection failed", err);
      throw new Error(message);
    }
  }

  /**
   * Navigate the map to a matched segment and select it in WME.
   *
   * Architecture note: this method lives in the controller (not the panel)
   * because it calls multiple SDK APIs (Map.setMapCenter, Editing.setSelection,
   * DataModel.Segments.findSegment) that must stay outside ui/.  The panel
   * calls this from its click handler, remaining presentation-only.
   *
   * Flow:
   *  1. Resolve geometry: prefer the walk cache; fall back to findSegment.
   *  2. Compute the centroid and move the map to it.
   *  3. Wait for the map to finish loading.
   *  4. Select the segment via setSelection.
   *
   * Throws if the segment cannot be located at all (cache miss + findSegment
   * failure), so callers can show a per-item error message.
   */
  async focusSegment(id: number): Promise<void> {
    let geometry = this.geometryCache.get(id) ?? null;

    if (!geometry) {
      // Cache miss: the segment may have been matched in a prior walk or the
      // walk hasn't run yet.  Ask the data model to fetch it.
      logger.info(`WalkController.focusSegment: cache miss for id=${id}, calling findSegment`);
      const segment = await this.wmeSDK.DataModel.Segments.findSegment({ segmentId: id });
      geometry = segment.geometry;
    }

    const centroidFeature = turfCenter({
      type: "Feature",
      geometry,
      properties: null,
    });
    const [lon, lat] = centroidFeature.geometry.coordinates;

    this.wmeSDK.Map.setMapCenter({
      lonLat: { lon, lat },
      zoomLevel: SEGMENT_ZOOM_LEVEL,
    });

    await waitForMapIdle(this.wmeSDK);

    // setSelection throws DataModelNotFoundError if the segment is not in the
    // current viewport after the map move.  Let the error propagate so the
    // panel can show a per-item "unavailable" message.
    this.wmeSDK.Editing.setSelection({
      selection: { ids: [id], objectType: "segment" },
    });
  }

  /**
   * Match only the currently-visible viewport against one track portion.
   *
   * This is used by the per-view "Match" button in the panel. It resets the
   * accumulated results before matching so each click yields an isolated list.
   */
  async matchInCurrentViewport(kmA: number, kmB: number): Promise<void> {
    this.matchedIds.clear();
    this.geometryCache.clear();

    const slicedTrack = sliceMultiLineByDistance(this.track, kmA, kmB);
    if (slicedTrack.coordinates.length === 0) {
      logger.warn(`WalkController.matchInCurrentViewport: empty slice for [${kmA}, ${kmB}]`);
      this.progressEmitter.emit(1, 1, []);
      return;
    }

    const bufferedTrack = turfBuffer(
      {
        type: "Feature" as const,
        geometry: slicedTrack,
        properties: null,
      },
      BUFFER_METERS,
      { units: "meters" },
    );

    if (!bufferedTrack) {
      throw new Error("[WME-geojson] WalkController: failed to buffer sliced track");
    }

    const matchStartedAt = Date.now();

    // Inter-slice cache: if map has stayed stable and segment count unchanged, reuse snapshot.
    const liveCount = this.wmeSDK.DataModel.Segments.getAll().length;
    const cached = this._snapshotCache;
    const canUseCache =
      cached !== null && !this.isMapLoading() && liveCount === cached.count && liveCount > 0;

    let allSegments: Segment[];
    let attempts: number;
    let snapshotElapsedMs: number;
    let snapshotMode: string;

    if (canUseCache) {
      allSegments = cached!.segments;
      attempts = 0;
      snapshotElapsedMs = 0;
      snapshotMode = "cache-hit";
      logger.info(
        "[match-load-debug] WalkController.matchInCurrentViewport: cache-hit (reusing snapshot)",
        {
          kmA,
          kmB,
          count: allSegments.length,
        },
      );
    } else {
      const segmentSnapshot = await this.getSettledSegmentsSnapshot(matchStartedAt);
      allSegments = segmentSnapshot.segments;
      attempts = segmentSnapshot.attempts;
      snapshotElapsedMs = segmentSnapshot.elapsedMs;
      snapshotMode = segmentSnapshot.mode;
      // Update the one-slot cache.
      if (allSegments.length > 0 && !this.isMapLoading()) {
        this._snapshotCache = { segments: allSegments, count: allSegments.length };
      }
    }

    const mapApi = (this.wmeSDK as unknown as { Map?: unknown }).Map as
      | {
          getZoomLevel?: () => number;
          getMapExtent?: () => [number, number, number, number];
        }
      | undefined;
    const zoom = mapApi?.getZoomLevel?.() ?? null;
    const extent = mapApi?.getMapExtent?.() ?? null;

    logger.info("[match-load-debug] WalkController.matchInCurrentViewport: segments snapshot", {
      kmA,
      kmB,
      count: allSegments.length,
      attempts,
      elapsedMs: snapshotElapsedMs,
      mode: snapshotMode,
      zoom,
      extent,
    });

    if (allSegments.length === 0) {
      logger.warn(
        "WalkController.matchInCurrentViewport: getAll returned 0 segment after retry window",
        {
          kmA,
          kmB,
          zoom,
          extent,
        },
      );
    }

    const matchableSegments = filterMatchableSegments(allSegments);

    logger.info("WalkController.matchInCurrentViewport: filtered non-matchable road types", {
      kmA,
      kmB,
      beforeCount: allSegments.length,
      afterCount: matchableSegments.length,
      excludedCount: allSegments.length - matchableSegments.length,
    });

    const segmentLikes = matchableSegments.map((s) => ({
      id: s.id,
      geometry: s.geometry,
    }));

    const bboxPrefilterStartedAt = Date.now();
    const sliceBbox = this.getMultiLineBBox(slicedTrack);
    const bboxCandidateSegments = segmentLikes.filter((segment) =>
      this.bboxIntersects(
        sliceBbox,
        this.getCachedSegmentBBox(segment.id, segment.geometry),
        SAMPLED_CANDIDATE_BBOX_PADDING_DEGREES,
      ),
    );
    const bboxPrefilterDurationMs = Date.now() - bboxPrefilterStartedAt;

    logger.info("WalkController.matchInCurrentViewport: bbox prefilter complete", {
      kmA,
      kmB,
      bboxPrefilterInput: segmentLikes.length,
      bboxPrefilterKept: bboxCandidateSegments.length,
      bboxPrefilterRejected: segmentLikes.length - bboxCandidateSegments.length,
      bboxPrefilterDurationMs,
    });

    // Build the slice spatial index once here — shared by the centerline pre-filter (piste B),
    // the sampled-coverage stage, and the endpoint filter.
    const flattenedSliceCoords = slicedTrack.coordinates.flat();
    const sharedSliceIndex = this.buildSliceIndex(flattenedSliceCoords);

    // Per-slice projection cache: built lazily during the centerline pre-filter and reused by
    // the sampled-coverage and endpoint-filter stages — eliminates redundant re-projection.
    const sliceProjectionCache: SegmentProjectionCache = new Map();

    // Piste B — distance-to-centerline pre-filter.
    // Uses the dense sample projection (cached for downstream reuse).  If ALL dense
    // samples are beyond CENTERLINE_PREFILTER_THRESHOLD_METERS the segment is too far
    // from the track centerline to ever match.
    const centerlineFilterStartedAt = Date.now();
    let centerlineFilteredSegments: typeof bboxCandidateSegments;
    let centerlineFilterMetrics: CenterlineFilterMetrics;
    if (sharedSliceIndex !== null) {
      centerlineFilteredSegments = bboxCandidateSegments.filter((segment) =>
        this.passesCenterlinePrefilter(
          segment.id,
          segment.geometry,
          sharedSliceIndex,
          sliceProjectionCache,
        ),
      );
      centerlineFilterMetrics = {
        input: bboxCandidateSegments.length,
        rejected: bboxCandidateSegments.length - centerlineFilteredSegments.length,
        kept: centerlineFilteredSegments.length,
        durationMs: Date.now() - centerlineFilterStartedAt,
      };
    } else {
      // No index available (degenerate slice) — pass everything through.
      centerlineFilteredSegments = bboxCandidateSegments;
      centerlineFilterMetrics = {
        input: bboxCandidateSegments.length,
        rejected: 0,
        kept: bboxCandidateSegments.length,
        durationMs: 0,
      };
    }

    logger.info("WalkController.matchInCurrentViewport: centerline prefilter complete", {
      kmA,
      kmB,
      ...centerlineFilterMetrics,
    });

    logger.info("WalkController.matchInCurrentViewport: starting buffered intersects", {
      kmA,
      kmB,
      segmentCount: centerlineFilteredSegments.length,
    });

    const bufferedStartedAt = Date.now();
    let bufferedMatchedIds: Set<number>;
    try {
      bufferedMatchedIds = await matchSegmentsAsync(
        { segments: centerlineFilteredSegments, bufferedTrack, track: slicedTrack },
        {
          chunkSize: MATCH_COMPUTE_YIELD_EVERY_SEGMENTS,
          yieldBetweenChunks: yieldToUi,
        },
      );
    } catch (err) {
      logger.error("WalkController.matchInCurrentViewport: matchSegments failed", {
        kmA,
        kmB,
        segmentCount: centerlineFilteredSegments.length,
        err,
      });
      throw err;
    }
    const bufferedDurationMs = Date.now() - bufferedStartedAt;

    logger.info("WalkController.matchInCurrentViewport: buffered intersects complete", {
      kmA,
      kmB,
      bufferedCount: bufferedMatchedIds.size,
      bufferedDurationMs,
    });

    await yieldToUi();

    const sampledStartedAt = Date.now();
    const sampledResult = await this.findSampledSliceMatches(
      centerlineFilteredSegments,
      bufferedMatchedIds,
      slicedTrack,
      sharedSliceIndex,
      sliceProjectionCache,
    );
    const sampledMatchedIds = sampledResult.ids;
    const sampledDurationMs = Date.now() - sampledStartedAt;
    logger.info("WalkController.matchInCurrentViewport: sampled candidates complete", {
      kmA,
      kmB,
      sampledCount: sampledMatchedIds.size,
      sampledDurationMs,
      metrics: sampledResult.metrics,
    });

    await yieldToUi();

    const allowEndBoundaryContinuation = kmB >= this.trackTotalKm - TRACK_END_EPSILON_KM;
    const shouldRunProjectionTolerance =
      allowEndBoundaryContinuation && bufferedMatchedIds.size === 0;
    const projectedStartedAt = Date.now();
    const projectedResult = shouldRunProjectionTolerance
      ? await this.findProjectedSliceMatches(matchableSegments, slicedTrack, kmA, kmB)
      : {
          spanBySegmentId: new Map<number, number>(),
          metrics: this.createProjectedSliceMatchMetrics(matchableSegments.length),
        };
    const projectedSpanBySegmentId = projectedResult.spanBySegmentId;
    const projectedDurationMs = Date.now() - projectedStartedAt;
    logger.info("WalkController.matchInCurrentViewport: projection fallback complete", {
      kmA,
      kmB,
      skipped: !shouldRunProjectionTolerance,
      projectedCount: projectedSpanBySegmentId.size,
      projectedDurationMs,
      metrics: projectedResult.metrics,
    });

    await yieldToUi();

    const matchedIds = new Set<number>([
      ...bufferedMatchedIds,
      ...sampledMatchedIds,
      ...projectedSpanBySegmentId.keys(),
    ]);

    const filterStartedAt = Date.now();
    let filteredResult: { ids: Set<number>; metrics: EndpointFilterMetrics };
    try {
      filteredResult = await this.filterEndpointTouchingMatches(
        matchableSegments,
        matchedIds,
        slicedTrack,
        allowEndBoundaryContinuation,
        projectedSpanBySegmentId,
        sharedSliceIndex,
        sliceProjectionCache,
      );
    } catch (err) {
      logger.error("WalkController.matchInCurrentViewport: endpoint filtering failed", {
        kmA,
        kmB,
        combinedCount: matchedIds.size,
        err,
      });
      throw err;
    }
    const filteredMatchedIds = filteredResult.ids;
    const filterDurationMs = Date.now() - filterStartedAt;
    logger.info("WalkController.matchInCurrentViewport: endpoint filter complete", {
      kmA,
      kmB,
      inputCount: matchedIds.size,
      filteredCount: filteredMatchedIds.size,
      removedCount: matchedIds.size - filteredMatchedIds.size,
      filterDurationMs,
      metrics: filteredResult.metrics,
    });

    await yieldToUi();

    let newIds: number[];
    try {
      newIds = this.cacheAndEmitMatches(matchableSegments, filteredMatchedIds);
    } catch (err) {
      logger.error("WalkController.matchInCurrentViewport: cacheAndEmitMatches failed", {
        kmA,
        kmB,
        filteredCount: filteredMatchedIds.size,
        err,
      });
      throw err;
    }

    this.logDiagnosticSegmentStages({
      kmA,
      kmB,
      allSegments,
      matchableSegments,
      bboxCandidateSegments,
      bufferedMatchedIds,
      sampledMatchedIds,
      projectedSpanBySegmentId,
      combinedMatchedIds: matchedIds,
      filteredMatchedIds,
      emittedIds: newIds,
      slicedTrack,
      allowEndBoundaryContinuation,
    });

    logger.info("WalkController.matchInCurrentViewport: match stages", {
      kmA,
      kmB,
      bufferedCount: bufferedMatchedIds.size,
      sampledCount: sampledMatchedIds.size,
      projectedCount: projectedSpanBySegmentId.size,
      combinedCount: matchedIds.size,
      filteredCount: filteredMatchedIds.size,
      emittedCount: newIds.length,
      bufferedDurationMs,
      sampledDurationMs,
      projectedDurationMs,
      filterDurationMs,
      totalComputeDurationMs:
        bufferedDurationMs + sampledDurationMs + projectedDurationMs + filterDurationMs,
      bboxPrefilterInput: segmentLikes.length,
      bboxPrefilterKept: bboxCandidateSegments.length,
      bboxPrefilterRejected: segmentLikes.length - bboxCandidateSegments.length,
      bboxPrefilterDurationMs,
      centerlineFilterMetrics,
      sampledMetrics: sampledResult.metrics,
      projectedMetrics: projectedResult.metrics,
      filterMetrics: filteredResult.metrics,
      sampleEmittedIds: newIds.slice(0, 10),
    });

    this.progressEmitter.emit(1, 1, newIds);
    logger.info(
      `WalkController.matchInCurrentViewport: matched ${newIds.length} segment(s) for [${kmA}, ${kmB}]`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private walk logic
  // ---------------------------------------------------------------------------

  private async runWalk(): Promise<void> {
    // Measure viewport size on the first walk; reuse cached value thereafter.
    if (!this.cachedViewportSize) {
      this.cachedViewportSize = await measureViewportAtZ17(this.wmeSDK);
    }
    const viewportSizeDeg = this.cachedViewportSize;

    // Buffer the entire track once; used in matchSegments for every cell.
    const trackFeature = {
      type: "Feature" as const,
      geometry: this.track,
      properties: null,
    };
    const bufferedTrack = turfBuffer(trackFeature, BUFFER_METERS, { units: "meters" });
    if (!bufferedTrack) {
      logger.error("WalkController: failed to buffer track; aborting walk");
      this.transition("error");
      return;
    }

    // Plan the grid walk.
    const cells: Cell[] = planWalk({
      track: this.track,
      viewportSizeDeg,
      bufferMeters: BUFFER_METERS,
      overlapRatio: OVERLAP_RATIO,
    });

    logger.info(`WalkController: walk planned — ${cells.length} cells`);

    const totalCells = cells.length;

    for (let i = 0; i < cells.length; i++) {
      // Check abort flag BEFORE each cell (not after) so stop() takes effect
      // at the next cell boundary.
      if (this.aborted) {
        logger.info(`WalkController: aborted at cell ${i}/${totalCells}`);
        this.transition("cancelled");
        return;
      }

      const cell = cells[i];

      try {
        // Navigate to the cell center at z17 so WME loads segment data there.
        this.wmeSDK.Map.setMapCenter({
          lonLat: cell.center,
          zoomLevel: SEGMENT_ZOOM_LEVEL,
        });

        // Wait for the map to finish loading before reading segments.
        await waitForMapIdle(this.wmeSDK);

        // Fetch all segments currently visible in the viewport.
        const allSegments = filterMatchableSegments(this.wmeSDK.DataModel.Segments.getAll());

        // Adapt SDK Segment objects to the structural SegmentLike type that
        // SegmentMatcher expects (keeps matching/ SDK-free).
        const segmentLikes = allSegments.map((s) => ({
          id: s.id,
          geometry: s.geometry,
        }));

        // Match against the buffered track.
        const cellMatchedIds = matchSegments({
          segments: segmentLikes,
          bufferedTrack,
          track: this.track,
        });

        const newIds = this.cacheAndEmitMatches(allSegments, cellMatchedIds);

        // Emit progress after each cell.
        this.progressEmitter.emit(i + 1, totalCells, newIds);

        logger.debug(
          `WalkController: cell ${i + 1}/${totalCells} — ${newIds.length} new segments (${this.matchedIds.size} total)`,
        );
      } catch (err) {
        // Per-cell error: log + skip + continue.  Isolated failures should not
        // abort the whole walk; the user gets a best-effort result.
        logger.warn(`WalkController: error on cell ${i + 1}/${totalCells}, skipping`, err);
      }

      // Yield to the UI thread between cells so the panel can update.
      await new Promise<void>((r) => setTimeout(r, YIELD_BETWEEN_CELLS_MS));
    }

    this.transition("done");
    logger.info(`WalkController: walk complete — ${this.matchedIds.size} total matched segments`);
  }

  private cacheAndEmitMatches(
    allSegments: ReadonlyArray<{ id: number; geometry: LineString }>,
    matchedIdsForBatch: ReadonlySet<number>,
  ): number[] {
    const newIds: number[] = [];
    for (const id of matchedIdsForBatch) {
      if (!this.matchedIds.has(id)) {
        this.matchedIds.add(id);
        newIds.push(id);
      }
    }

    if (newIds.length === 0) {
      return newIds;
    }

    const segById = new Map(allSegments.map((s) => [s.id, s]));
    for (const id of newIds) {
      const seg = segById.get(id);
      if (seg) {
        this.geometryCache.set(id, seg.geometry);
      }
    }

    for (const id of newIds) {
      const geom = this.geometryCache.get(id);
      if (geom) {
        this.matchFoundEmitter.emit(id, geom);
      }
    }

    return newIds;
  }

  private async getSettledSegmentsSnapshot(
    startedAt: number,
  ): Promise<{ segments: Segment[]; attempts: number; elapsedMs: number; mode: string }> {
    let segments = this.wmeSDK.DataModel.Segments.getAll();
    let attempts = 1;

    // Initial-retry loop: if the snapshot is empty, wait for segments to appear.
    // This is the cold-start path (first call after map load).
    while (segments.length === 0 && Date.now() - startedAt < MATCH_SEGMENTS_RETRY_TIMEOUT_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, MATCH_SEGMENTS_RETRY_INTERVAL_MS));
      logger.info(
        "[match-load-debug] WalkController.getSettledSegmentsSnapshot: retrying Segments.getAll after empty snapshot",
        {
          attempt: attempts + 1,
          previousCount: segments.length,
          elapsedMs: Date.now() - startedAt,
          isMapLoading: this.isMapLoading(),
        },
      );
      segments = this.wmeSDK.DataModel.Segments.getAll();
      attempts += 1;
    }

    if (!this.hasMapLoadingState()) {
      return { segments, attempts, elapsedMs: Date.now() - startedAt, mode: "no-loading-state" };
    }

    // Adaptive: if map has been stable for >= STABILITY_GRACE_MS, skip the poll loop entirely.
    const stableDurationMs =
      this.lastMapStableSinceMs > 0 ? Date.now() - this.lastMapStableSinceMs : -1;

    if (stableDurationMs >= STABILITY_GRACE_MS && !this.isMapLoading()) {
      logger.info(
        "[match-load-debug] WalkController.getSettledSegmentsSnapshot: adaptive-skip (map stable)",
        {
          stableDurationMs,
          segmentCount: segments.length,
          elapsedMs: Date.now() - startedAt,
        },
      );
      return { segments, attempts, elapsedMs: Date.now() - startedAt, mode: "adaptive-skip" };
    }

    // Adaptive: grace period not yet elapsed (or map still loading) — use one stable poll
    // instead of the original MATCH_SEGMENTS_STABLE_POLLS (2), saving ~150 ms.
    const maxPolls = 1;
    const mode = "single-poll";

    let stablePolls = 0;
    while (stablePolls < maxPolls && Date.now() - startedAt < MATCH_SEGMENTS_RETRY_TIMEOUT_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, MATCH_SEGMENTS_RETRY_INTERVAL_MS));
      logger.info(
        "[match-load-debug] WalkController.getSettledSegmentsSnapshot: polling Segments.getAll for stable snapshot",
        {
          attempt: attempts + 1,
          currentCount: segments.length,
          stablePolls,
          mode,
          elapsedMs: Date.now() - startedAt,
          isMapLoading: this.isMapLoading(),
        },
      );
      const nextSegments = this.wmeSDK.DataModel.Segments.getAll();
      attempts += 1;

      if (nextSegments.length > segments.length) {
        segments = nextSegments;
        stablePolls = 0;
        continue;
      }

      if (nextSegments.length === segments.length && !this.isMapLoading()) {
        stablePolls += 1;
      } else {
        stablePolls = 0;
      }
    }

    return { segments, attempts, elapsedMs: Date.now() - startedAt, mode };
  }

  private hasMapLoadingState(): boolean {
    return typeof this.wmeSDK.State?.isMapLoading === "function";
  }

  private isMapLoading(): boolean {
    try {
      return this.wmeSDK.State?.isMapLoading?.() ?? false;
    } catch {
      return false;
    }
  }

  private logDiagnosticSegmentStages(args: {
    kmA: number;
    kmB: number;
    allSegments: ReadonlyArray<Segment>;
    matchableSegments: ReadonlyArray<{ id: number; geometry: LineString }>;
    bboxCandidateSegments: ReadonlyArray<{ id: number; geometry: LineString }>;
    bufferedMatchedIds: ReadonlySet<number>;
    sampledMatchedIds: ReadonlySet<number>;
    projectedSpanBySegmentId: ReadonlyMap<number, number>;
    combinedMatchedIds: ReadonlySet<number>;
    filteredMatchedIds: ReadonlySet<number>;
    emittedIds: ReadonlyArray<number>;
    slicedTrack: MultiLineString;
    allowEndBoundaryContinuation: boolean;
  }): void {
    if (DIAGNOSTIC_MATCH_SEGMENT_IDS.size === 0) return;
    const allById = new Map(args.allSegments.map((segment) => [segment.id, segment]));
    const matchableIds = new Set(args.matchableSegments.map((segment) => segment.id));
    const bboxCandidateIds = new Set(args.bboxCandidateSegments.map((segment) => segment.id));
    const emittedIds = new Set(args.emittedIds);
    const sliceBbox = this.getMultiLineBBox(args.slicedTrack);

    const diagnostics = Array.from(DIAGNOSTIC_MATCH_SEGMENT_IDS).map((id) => {
      const segment = allById.get(id);
      if (!segment) {
        return {
          id,
          loaded: false,
          matchable: false,
          bboxCandidate: false,
          buffered: false,
          sampled: false,
          projected: false,
          combined: false,
          filtered: false,
          emitted: false,
        };
      }

      const segmentBbox = this.getCachedSegmentBBox(id, segment.geometry);
      return {
        id,
        loaded: true,
        roadType: segment.roadType,
        matchable: matchableIds.has(id),
        excludedRoadType: EXCLUDED_MATCH_ROAD_TYPES.has(segment.roadType),
        bboxCandidate: bboxCandidateIds.has(id),
        bboxIntersectsSlice: this.bboxIntersects(
          sliceBbox,
          segmentBbox,
          SAMPLED_CANDIDATE_BBOX_PADDING_DEGREES,
        ),
        segmentBbox,
        buffered: args.bufferedMatchedIds.has(id),
        sampled: args.sampledMatchedIds.has(id),
        projected: args.projectedSpanBySegmentId.has(id),
        projectedSpanMeters: args.projectedSpanBySegmentId.get(id) ?? null,
        combined: args.combinedMatchedIds.has(id),
        filtered: args.filteredMatchedIds.has(id),
        emitted: emittedIds.has(id),
        geometryPointCount: segment.geometry.coordinates.length,
        geometryStart: segment.geometry.coordinates[0] ?? null,
        geometryEnd: segment.geometry.coordinates[segment.geometry.coordinates.length - 1] ?? null,
        endpointDiagnostics: this.getEndpointFilterDiagnostics(
          segment.geometry.coordinates,
          args.slicedTrack,
          args.allowEndBoundaryContinuation,
        ),
      };
    });

    const diagnosticPayload = {
      kmA: args.kmA,
      kmB: args.kmB,
      trackTotalKm: this.trackTotalKm,
      allowEndBoundaryContinuation: args.allowEndBoundaryContinuation,
      allSegmentsCount: args.allSegments.length,
      matchableCount: args.matchableSegments.length,
      bboxCandidateCount: args.bboxCandidateSegments.length,
      targetIds: Array.from(DIAGNOSTIC_MATCH_SEGMENT_IDS),
      diagnostics,
    };

    logger.info(
      "[match-load-debug] WalkController.matchInCurrentViewport: diagnostic target segment stages",
      diagnosticPayload,
    );
    logger.info(
      "[match-load-debug] WalkController.matchInCurrentViewport: diagnostic target segment stages JSON",
      JSON.stringify(diagnosticPayload),
    );
  }

  private getEndpointFilterDiagnostics(
    coordinates: ReadonlyArray<Position>,
    slicedTrack: MultiLineString,
    allowEndBoundaryContinuation: boolean,
  ): Record<string, unknown> {
    const slicedTrackLines = this.toLineFeatures(slicedTrack);
    const flattenedSliceCoords = slicedTrack.coordinates.flat();
    const sliceIndex = this.buildSliceIndex(flattenedSliceCoords);
    const slicedTrackPolyline =
      flattenedSliceCoords.length >= 2
        ? {
            type: "Feature" as const,
            geometry: turfLineString(flattenedSliceCoords).geometry,
            properties: null,
          }
        : null;
    const slicedTrackLengthKm = slicedTrackPolyline
      ? turfLength(slicedTrackPolyline, { units: "kilometers" })
      : 0;

    const closeVertexDistancesMeters: number[] = [];
    const closeVertexIndices: number[] = [];
    for (let i = 0; i < coordinates.length; i++) {
      const coordinate = coordinates[i];
      let distanceMeters = Number.POSITIVE_INFINITY;
      for (const lineFeature of slicedTrackLines) {
        const currentDistanceMeters = pointToLineDistance(turfPoint(coordinate), lineFeature, {
          units: "meters",
        });
        if (currentDistanceMeters < distanceMeters) {
          distanceMeters = currentDistanceMeters;
        }
      }

      closeVertexDistancesMeters.push(Number(distanceMeters.toFixed(2)));
      if (distanceMeters <= CLOSE_VERTEX_DISTANCE_METERS) {
        closeVertexIndices.push(i);
      }
    }

    const closeSpanMeters =
      closeVertexIndices.length >= 2
        ? this.distanceAlongSegment(
            coordinates,
            closeVertexIndices[0],
            closeVertexIndices[closeVertexIndices.length - 1],
          )
        : 0;

    const extendsPastStart =
      slicedTrackPolyline !== null &&
      this.extendsPastBoundary(coordinates, slicedTrackPolyline, slicedTrackLengthKm, "start");
    const extendsPastEnd =
      slicedTrackPolyline !== null &&
      !allowEndBoundaryContinuation &&
      this.extendsPastBoundary(coordinates, slicedTrackPolyline, slicedTrackLengthKm, "end");

    return {
      closeVertexDistancesMeters,
      closeVerticesCount: closeVertexIndices.length,
      closeVertexIndices,
      closeSpanMeters: Number(closeSpanMeters.toFixed(2)),
      allVerticesClose: closeVertexIndices.length === coordinates.length,
      hasEnoughSampledSliceCoverage:
        sliceIndex !== null &&
        this.hasEnoughSampledSliceCoverage(this.computeSliceProjection(coordinates, sliceIndex)),
      extendsPastStart,
      extendsPastEnd,
      isStartBoundaryContinuation: this.isStartBoundaryContinuation(
        coordinates,
        this.getStartBoundaryDirection(slicedTrack),
      ),
      isEndBoundaryContinuation: this.isEndBoundaryContinuation(
        coordinates,
        allowEndBoundaryContinuation ? this.getEndBoundaryDirection(slicedTrack) : null,
      ),
    };
  }

  private async filterEndpointTouchingMatches(
    allSegments: ReadonlyArray<{ id: number; geometry: LineString }>,
    matchedIdsForBatch: ReadonlySet<number>,
    slicedTrack: MultiLineString,
    allowEndBoundaryContinuation: boolean,
    projectedSpanBySegmentId: ReadonlyMap<number, number>,
    prebuiltSliceIndex: TrackSpatialIndex | null,
    projectionCache: SegmentProjectionCache,
  ): Promise<{ ids: Set<number>; metrics: EndpointFilterMetrics }> {
    const segmentById = new Map(allSegments.map((segment) => [segment.id, segment]));
    const slicedTrackLines = slicedTrack.coordinates.map((lineCoordinates) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: lineCoordinates,
      },
      properties: null,
    }));
    const filtered = new Set<number>();
    const metrics: EndpointFilterMetrics = {
      inputMatched: matchedIdsForBatch.size,
      missingSegment: 0,
      keptProjectedOverride: 0,
      keptBoundaryCoverage: 0,
      droppedBoundaryCoverage: 0,
      keptAllVerticesClose: 0,
      droppedDegenerateMicro: 0,
      droppedJunctionArcBearing: 0,
      keptChainLink: 0,
      keptCloseVertexSpan: 0,
      droppedParallelSpur: 0,
      keptSampledCoverage: 0,
      keptBoundaryOverhangCoverage: 0,
      droppedDanglingApproach: 0,
      keptStartBoundaryContinuation: 0,
      keptEndBoundaryContinuation: 0,
      droppedEndpointTouch: 0,
    };
    const startBoundary = this.getStartBoundaryDirection(slicedTrack);
    const endBoundary = allowEndBoundaryContinuation
      ? this.getEndBoundaryDirection(slicedTrack)
      : null;

    const flattenedSliceCoords = slicedTrack.coordinates.flat();
    const slicedTrackPolyline =
      flattenedSliceCoords.length >= 2
        ? {
            type: "Feature" as const,
            geometry: turfLineString(flattenedSliceCoords).geometry,
            properties: null,
          }
        : null;
    const slicedTrackLengthKm = slicedTrackPolyline
      ? turfLength(slicedTrackPolyline, { units: "kilometers" })
      : 0;
    // Compute the bearing of the first edge of the slice (used by the junction-arc guard).
    const sliceStartBearingDeg =
      flattenedSliceCoords.length >= 2
        ? turfBearing(turfPoint(flattenedSliceCoords[0]), turfPoint(flattenedSliceCoords[1]))
        : null;
    // Reuse the shared index and projection cache when provided by the caller.
    const sliceIndex = prebuiltSliceIndex ?? this.buildSliceIndex(flattenedSliceCoords);
    const cache = projectionCache;

    // Build a map from endpoint coordinate key → segment IDs.  Used by the
    // chain-link bridge guard: a short segment whose both endpoint coordinates
    // are shared with OTHER matched segments is a real connector.
    const endpointKeyToIds = new Map<string, Set<number>>();
    for (const mid of matchedIdsForBatch) {
      const mseg = segmentById.get(mid);
      if (!mseg || mseg.geometry.coordinates.length < 2) continue;
      const c = mseg.geometry.coordinates;
      for (const coord of [c[0], c[c.length - 1]]) {
        const key = this.coordKey(coord);
        let ids = endpointKeyToIds.get(key);
        if (ids === undefined) {
          ids = new Set();
          endpointKeyToIds.set(key, ids);
        }
        ids.add(mid);
      }
    }

    let processedSegments = 0;
    for (const id of matchedIdsForBatch) {
      processedSegments += 1;
      if (processedSegments % MATCH_COMPUTE_YIELD_EVERY_SEGMENTS === 0) {
        await yieldToUi();
      }

      const segment = segmentById.get(id);
      if (!segment) {
        metrics.missingSegment += 1;
        continue;
      }

      const projectedSpanMeters = projectedSpanBySegmentId.get(id);
      if (
        projectedSpanMeters !== undefined &&
        projectedSpanMeters >= PROJECTED_OVERRIDE_MIN_SPAN_METERS
      ) {
        filtered.add(id);
        metrics.keptProjectedOverride += 1;
        continue;
      }

      const extendsPastStart =
        slicedTrackPolyline !== null &&
        this.extendsPastBoundary(
          segment.geometry.coordinates,
          slicedTrackPolyline,
          slicedTrackLengthKm,
          "start",
        );

      const extendsPastEnd =
        slicedTrackPolyline !== null &&
        !allowEndBoundaryContinuation &&
        this.extendsPastBoundary(
          segment.geometry.coordinates,
          slicedTrackPolyline,
          slicedTrackLengthKm,
          "end",
        );

      if (extendsPastStart || extendsPastEnd) {
        if (sliceIndex !== null) {
          const proj = this.getOrComputeProjection(
            segment.id,
            segment.geometry.coordinates,
            sliceIndex,
            cache,
          );
          // Relaxed fallback for boundary-gap continuation: the segment extends
          // well past the slice boundary (≥2 vertices, ≥20 m span), so a strict
          // coverage check would exclude real on-route segments whose majority
          // of vertices lie in the adjacent slice.  Allow them through when there
          // are at least a few close samples with a meaningful projected span.
          const passesRelaxed =
            this.hasMinimalBoundaryCoverage(proj) &&
            proj.projectedSpanMetersOnSlice >= MIN_CLOSE_SAMPLE_PROJECTED_SPAN_METERS * 2;
          if (this.hasEnoughSampledSliceCoverage(proj) || passesRelaxed) {
            filtered.add(id);
            metrics.keptBoundaryCoverage += 1;
          } else {
            metrics.droppedBoundaryCoverage += 1;
          }
        } else {
          metrics.droppedBoundaryCoverage += 1;
        }
        continue;
      }

      // Universal degenerate micro guard: reject segments whose total path
      // length is below the micro threshold regardless of which kept branch
      // they would otherwise enter.  This catches mapping artefacts (collapsed
      // intersection nodes) before they reach any "kept" decision.
      const segLenMeters = turfLength(
        { type: "Feature", geometry: segment.geometry, properties: null },
        { units: "meters" },
      );
      if (
        segLenMeters <= DEGENERATE_MICRO_MAX_LENGTH_METERS &&
        this.distanceAlongSegment(
          segment.geometry.coordinates,
          0,
          segment.geometry.coordinates.length - 1,
        ) <= DEGENERATE_MICRO_MAX_CLOSE_SPAN_METERS
      ) {
        metrics.droppedDegenerateMicro += 1;
        continue;
      }

      let closeVerticesCount = 0;
      const closeVertexIndices: number[] = [];
      for (let i = 0; i < segment.geometry.coordinates.length; i++) {
        const coordinate = segment.geometry.coordinates[i];
        let distanceMeters = Number.POSITIVE_INFINITY;
        for (const lineFeature of slicedTrackLines) {
          const currentDistanceMeters = pointToLineDistance(turfPoint(coordinate), lineFeature, {
            units: "meters",
          });
          if (currentDistanceMeters < distanceMeters) {
            distanceMeters = currentDistanceMeters;
          }
        }

        if (distanceMeters <= CLOSE_VERTEX_DISTANCE_METERS) {
          closeVerticesCount += 1;
          closeVertexIndices.push(i);
        }
      }

      if (closeVerticesCount >= MIN_CLOSE_VERTICES_FOR_VIEW_MATCH) {
        if (closeVerticesCount === segment.geometry.coordinates.length) {
          const allCloseSpanMeters = this.distanceAlongSegment(
            segment.geometry.coordinates,
            0,
            segment.geometry.coordinates.length - 1,
          );
          if (
            segLenMeters <= DEGENERATE_MICRO_MAX_LENGTH_METERS &&
            allCloseSpanMeters <= DEGENERATE_MICRO_MAX_CLOSE_SPAN_METERS
          ) {
            metrics.droppedDegenerateMicro += 1;
            continue;
          }
          // Junction-arc false-positive guard: tiny all-close segments (like
          // the unused "outside" arc of a 3-arc roundabout) sit at the corner
          // of two slice edges.  The segments we actually travel have their
          // samples projecting primarily to the FIRST slice edge (matching the
          // slice start bearing).  The wrong arc has its samples projecting
          // primarily to the SECOND edge (very different bearing).  Reject when
          // the circular mean of close-sample bearings deviates too far from the
          // slice start bearing.
          if (
            allCloseSpanMeters < JUNCTION_ARC_MAX_CLOSE_SPAN_METERS &&
            sliceIndex !== null &&
            sliceStartBearingDeg !== null
          ) {
            const proj = this.getOrComputeProjection(
              segment.id,
              segment.geometry.coordinates,
              sliceIndex,
              cache,
            );
            if (
              this.computeMeanBearingDeviation(proj, sliceStartBearingDeg) >
              JUNCTION_ARC_MAX_BEARING_RANGE_DEG
            ) {
              // Chain-link bridge exemption: a short 2-vertex segment whose
              // BOTH endpoint coordinates are shared with OTHER matched segments
              // is a real straight connector — keep it even if its bearing
              // deviates from the slice start.  Limit to 2-vertex segments so
              // that curved roundabout arcs (many vertices) are not exempted.
              const coords = segment.geometry.coordinates;
              if (coords.length === 2) {
                const k0 = this.coordKey(coords[0]);
                const k1 = this.coordKey(coords[coords.length - 1]);
                const others0 = endpointKeyToIds.get(k0);
                const others1 = endpointKeyToIds.get(k1);
                const bridgesOthers =
                  others0 !== undefined &&
                  others1 !== undefined &&
                  [...others0].some((oid) => oid !== id) &&
                  [...others1].some((oid) => oid !== id);
                if (bridgesOthers) {
                  filtered.add(id);
                  metrics.keptChainLink += 1;
                  continue;
                }
              }
              metrics.droppedJunctionArcBearing += 1;
              continue;
            }
          }
          filtered.add(id);
          metrics.keptAllVerticesClose += 1;
          continue;
        }

        const closeSpanMeters = this.distanceAlongSegment(
          segment.geometry.coordinates,
          closeVertexIndices[0],
          closeVertexIndices[closeVertexIndices.length - 1],
        );
        if (closeSpanMeters >= MIN_CLOSE_VERTEX_SPAN_METERS) {
          // Parallel-spur guard: even when the close-vertex span is wide, reject
          // if too few of the close samples are also very close.  Spurs that run
          // alongside the route have most samples at 10-15 m (close but not very
          // close); real on-route segments have most samples at < 10 m.
          if (sliceIndex !== null) {
            const proj = this.getOrComputeProjection(
              segment.id,
              segment.geometry.coordinates,
              sliceIndex,
              cache,
            );
            if (
              proj.closeSamples > 0 &&
              proj.veryCloseSamples / proj.closeSamples <
                PARALLEL_SPUR_MIN_VERY_CLOSE_OF_CLOSE_RATIO
            ) {
              metrics.droppedParallelSpur += 1;
              continue;
            }
          }
          filtered.add(id);
          metrics.keptCloseVertexSpan += 1;
          continue;
        }
      }

      if (sliceIndex !== null) {
        const proj = this.getOrComputeProjection(
          segment.id,
          segment.geometry.coordinates,
          sliceIndex,
          cache,
        );
        if (this.hasEnoughSampledSliceCoverage(proj)) {
          filtered.add(id);
          metrics.keptSampledCoverage += 1;
          continue;
        }
        // Boundary-overhang continuation: a segment that was rejected by
        // SegmentMatcher's stricter filters (e.g. ENDPOINT_DRIFT / competition)
        // but has at least one vertex extending past the slice boundary and
        // meaningful sampled coverage on the slice portion it DOES overlap.
        // A minimum projectedSpanMetersOnSlice is required so that pure-spur
        // segments that only touch the boundary endpoint (no span) are excluded.
        if (
          slicedTrackPolyline !== null &&
          proj.projectedSpanMetersOnSlice >= MIN_CLOSE_SAMPLE_PROJECTED_SPAN_METERS / 2 &&
          this.hasMinimalBoundaryCoverage(proj) &&
          (this.hasBoundaryOverhang(
            segment.geometry.coordinates,
            slicedTrackPolyline,
            slicedTrackLengthKm,
            "start",
          ) ||
            this.hasBoundaryOverhang(
              segment.geometry.coordinates,
              slicedTrackPolyline,
              slicedTrackLengthKm,
              "end",
            ))
        ) {
          // Dangling-approach guard: a long segment whose body lies far from the
          // route and only its tip touches the boundary (low close-sample ratio)
          // is a false positive.  Reject when the close-sample fraction is below
          // BOUNDARY_OVERHANG_MIN_CLOSE_RATIO.
          if (
            proj.sampleCount > 0 &&
            proj.closeSamples / proj.sampleCount < BOUNDARY_OVERHANG_MIN_CLOSE_RATIO
          ) {
            metrics.droppedDanglingApproach += 1;
            continue;
          }
          filtered.add(id);
          metrics.keptBoundaryOverhangCoverage += 1;
          continue;
        }
      }

      // Require at least one vertex to be close to the slice before accepting
      // a boundary continuation — pure proximity to the start/end point without
      // any vertex on the route is a false positive (mapping artefact near a
      // junction).
      if (
        closeVerticesCount >= 1 &&
        this.isStartBoundaryContinuation(segment.geometry.coordinates, startBoundary)
      ) {
        filtered.add(id);
        metrics.keptStartBoundaryContinuation += 1;
        continue;
      }

      if (this.isEndBoundaryContinuation(segment.geometry.coordinates, endBoundary)) {
        filtered.add(id);
        metrics.keptEndBoundaryContinuation += 1;
        continue;
      }

      metrics.droppedEndpointTouch += 1;
    }

    return { ids: filtered, metrics };
  }

  private async findSampledSliceMatches(
    allSegments: ReadonlyArray<{ id: number; geometry: LineString }>,
    alreadyMatchedIds: ReadonlySet<number>,
    slicedTrack: MultiLineString,
    prebuiltSliceIndex: TrackSpatialIndex | null,
    projectionCache: SegmentProjectionCache,
  ): Promise<{ ids: Set<number>; metrics: SampledSliceMatchMetrics }> {
    const metrics: SampledSliceMatchMetrics = {
      inputSegments: allSegments.length,
      alreadyMatchedSkipped: 0,
      bboxRejected: 0,
      bboxCandidates: 0,
      boundaryRejected: 0,
      boundaryCandidates: 0,
      coverageRejected: 0,
      coverageAccepted: 0,
      keptBoundaryGapContinuation: 0,
    };
    const flattenedSliceCoords = slicedTrack.coordinates.flat();
    if (flattenedSliceCoords.length < 2) {
      return { ids: new Set(), metrics };
    }

    const slicedTrackPolyline = {
      type: "Feature" as const,
      geometry: turfLineString(flattenedSliceCoords).geometry,
      properties: null,
    };
    const slicedTrackLengthKm = turfLength(slicedTrackPolyline, { units: "kilometers" });
    // Reuse a pre-built index if provided (avoids rebuilding for every findSampledSliceMatches call).
    const sliceIndex = prebuiltSliceIndex ?? this.buildSliceIndex(flattenedSliceCoords);
    const sliceBbox = this.getMultiLineBBox(slicedTrack);
    const matchedIds = new Set<number>();
    let processedSegments = 0;

    for (const segment of allSegments) {
      processedSegments += 1;
      if (processedSegments % MATCH_COMPUTE_YIELD_EVERY_SEGMENTS === 0) {
        await yieldToUi();
      }

      if (alreadyMatchedIds.has(segment.id)) {
        metrics.alreadyMatchedSkipped += 1;
        continue;
      }

      const segmentBbox = this.getLineBBox(segment.geometry.coordinates);
      if (!this.bboxIntersects(sliceBbox, segmentBbox, SAMPLED_CANDIDATE_BBOX_PADDING_DEGREES)) {
        metrics.bboxRejected += 1;
        continue;
      }
      metrics.bboxCandidates += 1;

      const pastStart = this.extendsPastBoundary(
        segment.geometry.coordinates,
        slicedTrackPolyline,
        slicedTrackLengthKm,
        "start",
      );
      const pastEnd = this.extendsPastBoundary(
        segment.geometry.coordinates,
        slicedTrackPolyline,
        slicedTrackLengthKm,
        "end",
      );
      const overhangStart =
        !pastStart &&
        this.hasBoundaryOverhang(
          segment.geometry.coordinates,
          slicedTrackPolyline,
          slicedTrackLengthKm,
          "start",
        );
      const overhangEnd =
        !pastEnd &&
        this.hasBoundaryOverhang(
          segment.geometry.coordinates,
          slicedTrackPolyline,
          slicedTrackLengthKm,
          "end",
        );

      if (!pastStart && !pastEnd && !overhangStart && !overhangEnd) {
        metrics.boundaryRejected += 1;
        continue;
      }
      metrics.boundaryCandidates += 1;

      if (sliceIndex !== null) {
        const proj = this.getOrComputeProjection(
          segment.id,
          segment.geometry.coordinates,
          sliceIndex,
          projectionCache,
        );
        if (this.hasEnoughSampledSliceCoverage(proj)) {
          matchedIds.add(segment.id);
          metrics.coverageAccepted += 1;
        } else if ((overhangStart || overhangEnd) && this.hasMinimalBoundaryCoverage(proj)) {
          matchedIds.add(segment.id);
          metrics.keptBoundaryGapContinuation += 1;
        } else {
          metrics.coverageRejected += 1;
        }
      } else {
        metrics.coverageRejected += 1;
      }
    }

    return { ids: matchedIds, metrics };
  }

  /**
   * Checks sampled coverage from a pre-computed `SegmentProjection`.  All
   * projection work has already been done; this is now a pure aggregate check.
   */
  private hasEnoughSampledSliceCoverage(proj: SegmentProjection): boolean {
    const { sampleCount: total, closeSamples, veryCloseSamples, projectedSpanMetersOnSlice } = proj;
    if (total === 0) return false;
    if (closeSamples / total < MIN_CLOSE_SAMPLE_RATIO_FOR_VIEW_MATCH) return false;
    if (veryCloseSamples / total < MIN_VERY_CLOSE_SAMPLE_RATIO_FOR_VIEW_MATCH) return false;
    // projectedSpanMetersOnSlice is 0 when < 2 close samples exist.
    if (projectedSpanMetersOnSlice < MIN_CLOSE_SAMPLE_PROJECTED_SPAN_METERS) return false;
    return true;
  }

  /**
   * Projection fallback for per-view matching:
   * - project sampled points of each segment on the full track
   * - require enough samples close to the track centerline
   * - keep only segments whose projected chainage belongs to the current slice
   *
   * This catches sparse-vertex segments that are visually on the route but
   * can be missed by strict per-vertex thresholds on the sliced polyline.
   */
  private async findProjectedSliceMatches(
    allSegments: ReadonlyArray<{ id: number; geometry: LineString }>,
    slicedTrack: MultiLineString,
    kmA: number,
    kmB: number,
  ): Promise<{ spanBySegmentId: Map<number, number>; metrics: ProjectedSliceMatchMetrics }> {
    const metrics = this.createProjectedSliceMatchMetrics(allSegments.length);
    if (!this.fullTrackLine) {
      return { spanBySegmentId: new Map(), metrics };
    }

    const flattenedSlice = slicedTrack.coordinates.flat();
    if (flattenedSlice.length < 2) {
      return { spanBySegmentId: new Map(), metrics };
    }

    const slicedTrackLine = {
      type: "Feature" as const,
      geometry: turfLineString(flattenedSlice).geometry,
      properties: null,
    };

    const isLastSlice = kmB >= this.trackTotalKm - TRACK_END_EPSILON_KM;
    const matchedSpanById = new Map<number, number>();

    let processedSegments = 0;
    for (const segment of allSegments) {
      processedSegments += 1;
      if (processedSegments % MATCH_COMPUTE_YIELD_EVERY_SEGMENTS === 0) {
        await yieldToUi();
      }

      if (segment.geometry.coordinates.length < 2) {
        metrics.noGeometrySkipped += 1;
        continue;
      }

      const sampledCoordinates = this.limitSampledCoordinates(
        this.sampleSegmentCoordinates(
          segment.geometry.coordinates,
          effectiveSampleSpacingProjection(
            turfLength(turfLineString(segment.geometry.coordinates), { units: "meters" }),
          ),
        ),
      );
      if (sampledCoordinates.length === 0) {
        metrics.noSamplesSkipped += 1;
        continue;
      }
      metrics.sampledSegments += 1;

      let closeSamples = 0;
      const projectedLocationsKm: number[] = [];
      for (const coordinate of sampledCoordinates) {
        const samplePoint = turfPoint(coordinate);
        const projectedOnSlice = nearestPointOnLine(slicedTrackLine, samplePoint, {
          units: "kilometers",
        });
        const distanceMeters = turfDistance(samplePoint, projectedOnSlice, { units: "meters" });
        if (distanceMeters > PROJECTED_DISTANCE_MAX_METERS) {
          continue;
        }

        closeSamples += 1;
        const projectedOnFullTrack = nearestPointOnLine(this.fullTrackLine, samplePoint, {
          units: "kilometers",
        });
        const locationKm = projectedOnFullTrack.properties.location;
        if (typeof locationKm === "number" && Number.isFinite(locationKm)) {
          projectedLocationsKm.push(locationKm);
        }
      }

      if (projectedLocationsKm.length === 0) {
        metrics.noProjectedLocations += 1;
        continue;
      }

      const coverageRatio = closeSamples / sampledCoordinates.length;
      if (coverageRatio < PROJECTED_COVERAGE_MIN_RATIO) {
        metrics.coverageRejected += 1;
        continue;
      }

      const projectedMinKm = Math.min(...projectedLocationsKm);
      const projectedMaxKm = Math.max(...projectedLocationsKm);
      if (this.isProjectedSpanInSlice(projectedMinKm, projectedMaxKm, kmA, kmB, isLastSlice)) {
        matchedSpanById.set(segment.id, (projectedMaxKm - projectedMinKm) * 1000);
        metrics.chainageAccepted += 1;
      } else {
        metrics.chainageRejected += 1;
      }
    }

    return { spanBySegmentId: matchedSpanById, metrics };
  }

  private createProjectedSliceMatchMetrics(inputSegments: number): ProjectedSliceMatchMetrics {
    return {
      inputSegments,
      noGeometrySkipped: 0,
      noSamplesSkipped: 0,
      sampledSegments: 0,
      noProjectedLocations: 0,
      coverageRejected: 0,
      chainageRejected: 0,
      chainageAccepted: 0,
    };
  }

  private isProjectedSpanInSlice(
    projectedMinKm: number,
    projectedMaxKm: number,
    kmA: number,
    kmB: number,
    isLastSlice: boolean,
  ): boolean {
    if (projectedMaxKm < kmA - PROJECTED_CHAINAGE_EPSILON_KM) {
      return false;
    }

    // Keep "start inclusive / end exclusive" ownership for all non-last slices.
    if (!isLastSlice && projectedMaxKm >= kmB - PROJECTED_CHAINAGE_EPSILON_KM) {
      return false;
    }

    if (isLastSlice) {
      return projectedMinKm <= kmB + PROJECTED_CHAINAGE_EPSILON_KM;
    }

    return projectedMinKm < kmB - PROJECTED_CHAINAGE_EPSILON_KM;
  }

  private sampleSegmentCoordinates(
    coordinates: ReadonlyArray<Position>,
    stepMeters: number,
  ): Position[] {
    if (coordinates.length === 0) {
      return [];
    }

    const sampled: Position[] = [[coordinates[0][0], coordinates[0][1]]];

    for (let i = 1; i < coordinates.length; i++) {
      const a = coordinates[i - 1];
      const b = coordinates[i];
      const segmentLengthMeters = turfDistance(turfPoint(a), turfPoint(b), { units: "meters" });
      if (segmentLengthMeters > stepMeters) {
        const pointsCount = Math.floor(segmentLengthMeters / stepMeters);
        for (let pointIndex = 1; pointIndex < pointsCount; pointIndex++) {
          const ratio = (pointIndex * stepMeters) / segmentLengthMeters;
          sampled.push([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]);
        }
      }

      sampled.push([b[0], b[1]]);
    }

    return sampled;
  }

  private limitSampledCoordinates(coordinates: Position[]): Position[] {
    if (coordinates.length <= PROJECTED_MAX_SAMPLES_PER_SEGMENT) {
      return coordinates;
    }

    return Array.from({ length: PROJECTED_MAX_SAMPLES_PER_SEGMENT }, (_, index) => {
      const sourceIndex = Math.round(
        (index * (coordinates.length - 1)) / (PROJECTED_MAX_SAMPLES_PER_SEGMENT - 1),
      );
      return coordinates[sourceIndex];
    });
  }

  /**
   * Piste B — centerline pre-filter.
   * Uses the cached dense sample projection (Option 2): returns `false` only when
   * ALL dense samples are beyond CENTERLINE_PREFILTER_THRESHOLD_METERS.  A single
   * sample within the threshold keeps the segment.  The dense set (8 m step, ≤25
   * samples) is strictly more sensitive than the old 3-probe approach, so no false
   * negatives are introduced.
   *
   * The cache query radius equals CENTERLINE_PREFILTER_THRESHOLD_METERS, so a
   * non-null sample entry already guarantees distanceMeters ≤ threshold.
   */
  private passesCenterlinePrefilter(
    segmentId: number,
    geometry: LineString,
    sliceIndex: TrackSpatialIndex,
    cache: SegmentProjectionCache,
  ): boolean {
    if (geometry.coordinates.length === 0) return false;
    const proj = this.getOrComputeProjection(segmentId, geometry.coordinates, sliceIndex, cache);
    return proj.samples.some((s) => s !== null);
  }

  private buildSliceIndex(flattenedCoords: Position[]): TrackSpatialIndex | null {
    if (flattenedCoords.length < 2) return null;
    const feature: Feature<LineString> = {
      type: "Feature",
      geometry: turfLineString(flattenedCoords).geometry,
      properties: null,
    };
    return buildTrackSpatialIndex(feature);
  }

  /**
   * Projects all dense samples of `coordinates` onto `sliceIndex` and returns
   * the cached aggregates.  Called at most once per (slice, segment) pair —
   * callers are expected to store the result in a `SegmentProjectionCache`.
   *
   * The query radius is CENTERLINE_PREFILTER_THRESHOLD_METERS (the wider of the
   * two thresholds used by callers), so both the pre-filter and the coverage check
   * can read from the same cache.
   */
  computeSliceProjection(
    coordinates: ReadonlyArray<Position>,
    sliceIndex: TrackSpatialIndex,
  ): SegmentProjection {
    const segLengthMeters =
      coordinates.length >= 2
        ? turfLength(turfLineString(coordinates as Position[]), { units: "meters" })
        : 0;
    const stepMeters = effectiveSampleSpacingProjection(segLengthMeters);
    const sampledCoords = this.limitSampledCoordinates(
      this.sampleSegmentCoordinates(coordinates, stepMeters),
    );
    const sampleCount = sampledCoords.length;
    const samples: SegmentProjection["samples"] = [];
    let closeSamples = 0;
    let veryCloseSamples = 0;
    const closeLocationKms: number[] = [];

    // Use the wider threshold so the pre-filter (20 m) and coverage check (15 m)
    // both read from the same projection without a second query.
    const queryRadiusMeters = CENTERLINE_PREFILTER_THRESHOLD_METERS;

    for (const coord of sampledCoords) {
      const proj = sliceIndex.nearestEdgeProjection(coord, queryRadiusMeters);
      if (proj === null) {
        samples.push(null);
        continue;
      }
      samples.push(proj);
      // Aggregate at the CLOSE_SAMPLE_DISTANCE_METERS threshold (used by coverage check).
      if (proj.distanceMeters <= CLOSE_SAMPLE_DISTANCE_METERS) {
        closeSamples += 1;
        if (proj.distanceMeters <= VERY_CLOSE_SAMPLE_DISTANCE_METERS) {
          veryCloseSamples += 1;
        }
        closeLocationKms.push(proj.locationKm);
      }
    }

    const projectedSpanMetersOnSlice =
      closeLocationKms.length >= 2
        ? (Math.max(...closeLocationKms) - Math.min(...closeLocationKms)) * 1000
        : 0;

    return { sampleCount, samples, closeSamples, veryCloseSamples, projectedSpanMetersOnSlice };
  }

  /**
   * Returns the cached projection for `segmentId`, computing it on first access.
   */
  private getOrComputeProjection(
    segmentId: number,
    coordinates: ReadonlyArray<Position>,
    sliceIndex: TrackSpatialIndex,
    cache: SegmentProjectionCache,
  ): SegmentProjection {
    const cached = cache.get(segmentId);
    if (cached !== undefined) return cached;
    const proj = this.computeSliceProjection(coordinates, sliceIndex);
    cache.set(segmentId, proj);
    return proj;
  }

  private toLineFeatures(slicedTrack: MultiLineString): Array<{
    type: "Feature";
    geometry: LineString;
    properties: null;
  }> {
    return slicedTrack.coordinates
      .filter((lineCoordinates) => lineCoordinates.length >= 2)
      .map((lineCoordinates) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: lineCoordinates,
        },
        properties: null,
      }));
  }

  private getMultiLineBBox(geometry: MultiLineString): [number, number, number, number] {
    return this.getLineBBox(geometry.coordinates.flat());
  }

  private getLineBBox(coordinates: ReadonlyArray<Position>): [number, number, number, number] {
    let minLon = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;

    for (const coordinate of coordinates) {
      const [lon, lat] = coordinate;
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }

    return [minLon, minLat, maxLon, maxLat];
  }

  private getCachedSegmentBBox(id: number, geometry: LineString): [number, number, number, number] {
    const cached = this.segmentBBoxCache.get(id);
    if (cached?.geometry === geometry) {
      return cached.bbox;
    }

    const bbox = this.getLineBBox(geometry.coordinates);
    this.segmentBBoxCache.set(id, { geometry, bbox });
    return bbox;
  }

  private bboxIntersects(
    a: [number, number, number, number],
    b: [number, number, number, number],
    paddingDegrees: number,
  ): boolean {
    return (
      b[0] <= a[2] + paddingDegrees &&
      b[2] >= a[0] - paddingDegrees &&
      b[1] <= a[3] + paddingDegrees &&
      b[3] >= a[1] - paddingDegrees
    );
  }

  private extendsPastBoundary(
    coordinates: ReadonlyArray<Position>,
    slicedTrackPolyline: { type: "Feature"; geometry: LineString; properties: null },
    totalLengthKm: number,
    side: "start" | "end",
  ): boolean {
    let count = 0;
    let firstIndex = -1;
    let lastIndex = -1;

    for (let i = 0; i < coordinates.length; i++) {
      const samplePoint = turfPoint(coordinates[i]);
      const projected = nearestPointOnLine(slicedTrackPolyline, samplePoint, {
        units: "kilometers",
      });
      const locationKm =
        typeof projected.properties.location === "number" ? projected.properties.location : -1;
      const distanceMeters = turfDistance(samplePoint, projected, { units: "meters" });

      const onBoundary =
        side === "start"
          ? locationKm <= PAST_BOUNDARY_CHAINAGE_EPSILON_KM
          : locationKm >= totalLengthKm - PAST_BOUNDARY_CHAINAGE_EPSILON_KM;

      if (onBoundary && distanceMeters > PAST_BOUNDARY_OFF_SLICE_DISTANCE_METERS) {
        count += 1;
        if (firstIndex < 0) {
          firstIndex = i;
        }
        lastIndex = i;
      }
    }

    if (count < PAST_BOUNDARY_MIN_VERTICES) {
      return false;
    }

    const spanMeters = this.distanceAlongSegment(coordinates, firstIndex, lastIndex);
    return spanMeters >= PAST_BOUNDARY_MIN_SPAN_METERS;
  }

  /**
   * Softer alternative to `extendsPastBoundary`: returns true when at least
   * one vertex projects to the slice boundary (chainage ≤ ε or ≥ totalLen−ε)
   * and is farther than BOUNDARY_OVERHANG_MIN_DIST_METERS from the polyline.
   *
   * This catches segments like 432486991 (only one vertex past the boundary)
   * and 210811026 (vertex only ~14 m from slice, below the 15 m threshold of
   * extendsPastBoundary) that are otherwise falsely excluded.
   */
  private hasBoundaryOverhang(
    coordinates: ReadonlyArray<Position>,
    slicedTrackPolyline: { type: "Feature"; geometry: LineString; properties: null },
    totalLengthKm: number,
    side: "start" | "end",
  ): boolean {
    for (const coord of coordinates) {
      const samplePoint = turfPoint(coord);
      const projected = nearestPointOnLine(slicedTrackPolyline, samplePoint, {
        units: "kilometers",
      });
      const locationKm =
        typeof projected.properties.location === "number" ? projected.properties.location : -1;
      const distanceMeters = turfDistance(samplePoint, projected, { units: "meters" });

      const onBoundary =
        side === "start"
          ? locationKm <= PAST_BOUNDARY_CHAINAGE_EPSILON_KM
          : locationKm >= totalLengthKm - PAST_BOUNDARY_CHAINAGE_EPSILON_KM;

      if (onBoundary && distanceMeters > BOUNDARY_OVERHANG_MIN_DIST_METERS) {
        return true;
      }
    }
    return false;
  }

  /**
   * Relaxed coverage check used for boundary-continuation segments that cannot
   * satisfy the full `hasEnoughSampledSliceCoverage` thresholds.  Requires only
   * a few close samples and at least one very-close sample, with no span check.
   *
   * Intended for segments like 474406759 (row 9) whose majority of vertices sit
   * in the previous slice but whose overlap with the current slice is real.
   */
  private hasMinimalBoundaryCoverage(proj: SegmentProjection): boolean {
    return (
      proj.closeSamples >= BOUNDARY_CONTINUATION_MIN_CLOSE_SAMPLES &&
      proj.veryCloseSamples >= BOUNDARY_CONTINUATION_MIN_VERY_CLOSE_SAMPLES
    );
  }

  /**
   * Compute the range (max − min) of bearingDeg values from non-null close
   * samples in a projection.  Uses circular arithmetic so that angles near
   * 0°/360° are handled correctly.
   *
   * Returns 0 when fewer than 2 non-null samples exist.
   */
  /**
   * Compute the angular deviation (degrees) between the circular mean of
   * close-sample bearingDeg values and a reference bearing.
   *
   * Used by the junction-arc false-positive guard: a legitimate segment's
   * close samples project primarily to the first slice edge (small deviation
   * from slice start bearing), while a wrong-arc segment's samples project
   * primarily to a later edge (large deviation).
   *
   * Returns 0 when fewer than 1 non-null close sample exists.
   */
  private computeMeanBearingDeviation(proj: SegmentProjection, refBearingDeg: number): number {
    const bearings: number[] = [];
    for (const s of proj.samples) {
      if (s !== null && s.distanceMeters <= CLOSE_SAMPLE_DISTANCE_METERS) {
        bearings.push(s.bearingDeg);
      }
    }
    if (bearings.length === 0) return 0;

    // Compute the circular mean of sample bearings.
    const sinSum = bearings.reduce((acc, b) => acc + Math.sin((b * Math.PI) / 180), 0);
    const cosSum = bearings.reduce((acc, b) => acc + Math.cos((b * Math.PI) / 180), 0);
    const meanDeg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;

    // Angular distance from the circular mean to the reference bearing.
    let diff = Math.abs(meanDeg - refBearingDeg);
    if (diff > 180) diff = 360 - diff;
    return diff;
  }

  private distanceAlongSegment(
    coordinates: ReadonlyArray<Position>,
    startIndex: number,
    endIndex: number,
  ): number {
    if (endIndex <= startIndex) {
      return 0;
    }

    let distanceMeters = 0;
    for (let i = startIndex + 1; i <= endIndex; i++) {
      const a = coordinates[i - 1];
      const b = coordinates[i];
      distanceMeters += turfDistance(turfPoint(a), turfPoint(b), { units: "meters" });
    }

    return distanceMeters;
  }

  /**
   * Encode a coordinate as a string key rounded to CHAIN_LINK_ENDPOINT_TOLERANCE_DEG
   * precision (~1 m at mid-Europe latitudes).  Used by the chain-link bridge guard.
   */
  private coordKey(coord: Position): string {
    const precision = Math.round(1 / CHAIN_LINK_ENDPOINT_TOLERANCE_DEG);
    return `${Math.round(coord[0] * precision)},${Math.round(coord[1] * precision)}`;
  }

  private getStartBoundaryDirection(slicedTrack: MultiLineString): {
    startPoint: Position;
    direction: [number, number];
  } | null {
    const flattened = slicedTrack.coordinates.flat();
    if (flattened.length < 2) {
      return null;
    }

    const startPointRaw = flattened[0];
    let nextIndex = 1;
    while (
      nextIndex < flattened.length &&
      flattened[nextIndex][0] === startPointRaw[0] &&
      flattened[nextIndex][1] === startPointRaw[1]
    ) {
      nextIndex += 1;
    }

    if (nextIndex >= flattened.length) {
      return null;
    }

    const nextPointRaw = flattened[nextIndex];
    const direction: [number, number] = [
      nextPointRaw[0] - startPointRaw[0],
      nextPointRaw[1] - startPointRaw[1],
    ];

    return {
      startPoint: [startPointRaw[0], startPointRaw[1]],
      direction,
    };
  }

  private isStartBoundaryContinuation(
    coordinates: ReadonlyArray<Position>,
    startBoundary: { startPoint: Position; direction: [number, number] } | null,
  ): boolean {
    if (!startBoundary || coordinates.length < 2) {
      return false;
    }

    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < coordinates.length; index++) {
      const distanceMeters = turfDistance(
        turfPoint(coordinates[index]),
        turfPoint(startBoundary.startPoint),
        { units: "meters" },
      );
      if (distanceMeters < nearestDistance) {
        nearestDistance = distanceMeters;
        nearestIndex = index;
      }
    }

    if (nearestIndex === -1 || nearestDistance > START_BOUNDARY_MAX_DISTANCE_METERS) {
      return false;
    }

    const endpointDirection: [number, number] =
      nearestIndex === 0
        ? [coordinates[1][0] - coordinates[0][0], coordinates[1][1] - coordinates[0][1]]
        : nearestIndex === coordinates.length - 1
          ? [
              coordinates[coordinates.length - 2][0] - coordinates[coordinates.length - 1][0],
              coordinates[coordinates.length - 2][1] - coordinates[coordinates.length - 1][1],
            ]
          : [
              coordinates[nearestIndex + 1][0] - coordinates[nearestIndex - 1][0],
              coordinates[nearestIndex + 1][1] - coordinates[nearestIndex - 1][1],
            ];

    const alignmentDeg = this.minUndirectedAngleDeg(startBoundary.direction, endpointDirection);
    return alignmentDeg <= START_BOUNDARY_MAX_ANGLE_DEG;
  }

  private getEndBoundaryDirection(slicedTrack: MultiLineString): {
    endPoint: Position;
    direction: [number, number];
  } | null {
    const flattened = slicedTrack.coordinates.flat();
    if (flattened.length < 2) {
      return null;
    }

    const endPointRaw = flattened[flattened.length - 1];
    let previousIndex = flattened.length - 2;
    while (
      previousIndex >= 0 &&
      flattened[previousIndex][0] === endPointRaw[0] &&
      flattened[previousIndex][1] === endPointRaw[1]
    ) {
      previousIndex -= 1;
    }

    if (previousIndex < 0) {
      return null;
    }

    const previousPointRaw = flattened[previousIndex];
    const direction: [number, number] = [
      endPointRaw[0] - previousPointRaw[0],
      endPointRaw[1] - previousPointRaw[1],
    ];

    return {
      endPoint: [endPointRaw[0], endPointRaw[1]],
      direction,
    };
  }

  private isEndBoundaryContinuation(
    coordinates: ReadonlyArray<Position>,
    endBoundary: { endPoint: Position; direction: [number, number] } | null,
  ): boolean {
    if (!endBoundary || coordinates.length < 2) {
      return false;
    }

    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < coordinates.length; index++) {
      const distanceMeters = turfDistance(
        turfPoint(coordinates[index]),
        turfPoint(endBoundary.endPoint),
        { units: "meters" },
      );
      if (distanceMeters < nearestDistance) {
        nearestDistance = distanceMeters;
        nearestIndex = index;
      }
    }

    if (nearestIndex === -1 || nearestDistance > END_BOUNDARY_MAX_DISTANCE_METERS) {
      return false;
    }

    const endpointDirection: [number, number] =
      nearestIndex === 0
        ? [coordinates[1][0] - coordinates[0][0], coordinates[1][1] - coordinates[0][1]]
        : nearestIndex === coordinates.length - 1
          ? [
              coordinates[coordinates.length - 2][0] - coordinates[coordinates.length - 1][0],
              coordinates[coordinates.length - 2][1] - coordinates[coordinates.length - 1][1],
            ]
          : [
              coordinates[nearestIndex + 1][0] - coordinates[nearestIndex - 1][0],
              coordinates[nearestIndex + 1][1] - coordinates[nearestIndex - 1][1],
            ];

    const alignmentDeg = this.minUndirectedAngleDeg(endBoundary.direction, endpointDirection);
    return alignmentDeg <= END_BOUNDARY_MAX_ANGLE_DEG;
  }

  private minUndirectedAngleDeg(a: [number, number], b: [number, number]): number {
    const aMag = Math.hypot(a[0], a[1]);
    const bMag = Math.hypot(b[0], b[1]);
    if (aMag === 0 || bMag === 0) {
      return 180;
    }

    const aNorm: [number, number] = [a[0] / aMag, a[1] / aMag];
    const bNorm: [number, number] = [b[0] / bMag, b[1] / bMag];
    const dot = Math.max(-1, Math.min(1, aNorm[0] * bNorm[0] + aNorm[1] * bNorm[1]));
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    return Math.min(angleDeg, 180 - angleDeg);
  }

  /**
   * Transition to a new state, notify subscribers.
   * Throws on invalid transitions to surface state-machine bugs loudly.
   */
  private transition(to: WalkState): void {
    const from = this.state;

    if (!isTransitionAllowed(from, to)) {
      throw new Error(`[WME-geojson] WalkController: invalid transition ${from} → ${to}`);
    }

    this.state = to;
    logger.info(`WalkController: state ${from} → ${to}`);
    this.stateEmitter.emit(this.state);
  }
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function filterMatchableSegments(
  segments: ReadonlyArray<Pick<Segment, "id" | "geometry" | "roadType">>,
): Array<Pick<Segment, "id" | "geometry" | "roadType">> {
  return segments.filter((segment) => !EXCLUDED_MATCH_ROAD_TYPES.has(segment.roadType));
}
