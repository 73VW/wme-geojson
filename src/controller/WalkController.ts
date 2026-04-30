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
import type { LineString, MultiLineString, Position } from "geojson";
import {
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
import { sliceMultiLineByDistance } from "../matching/trackPortions";
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
const START_BOUNDARY_MAX_DISTANCE_METERS = 20;
const START_BOUNDARY_MAX_ANGLE_DEG = 20;
const END_BOUNDARY_MAX_DISTANCE_METERS = 30;
const END_BOUNDARY_MAX_ANGLE_DEG = 20;
const TRACK_END_EPSILON_KM = 0.001;
const PROJECTED_DISTANCE_MAX_METERS = 45;
const PROJECTED_COVERAGE_MIN_RATIO = 0.6;
const PROJECTED_SAMPLE_STEP_METERS = 8;
const PROJECTED_CHAINAGE_EPSILON_KM = 0.01;
const PROJECTED_OVERRIDE_MIN_SPAN_METERS = 40;

// Per-view matching can run just after map navigation; when data loading lags,
// getAll() may transiently return an empty array even though the viewport is
// valid. Keep a short retry window and log attempts for field diagnostics.
const MATCH_SEGMENTS_RETRY_TIMEOUT_MS = 2_500;
const MATCH_SEGMENTS_RETRY_INTERVAL_MS = 150;
const MATCH_COMPUTE_YIELD_EVERY_SEGMENTS = 20;

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

// ---------------------------------------------------------------------------
// Subscriber management helper (reused for all three event types)
// ---------------------------------------------------------------------------

type Callback<T extends unknown[]> = (...args: T) => void;

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
    let allSegments = this.wmeSDK.DataModel.Segments.getAll();
    let attempts = 1;

    while (
      allSegments.length === 0 &&
      Date.now() - matchStartedAt < MATCH_SEGMENTS_RETRY_TIMEOUT_MS
    ) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, MATCH_SEGMENTS_RETRY_INTERVAL_MS),
      );
      allSegments = this.wmeSDK.DataModel.Segments.getAll();
      attempts += 1;
    }

    const mapApi = (this.wmeSDK as unknown as { Map?: unknown }).Map as
      | {
          getZoomLevel?: () => number;
          getMapExtent?: () => [number, number, number, number];
        }
      | undefined;
    const zoom = mapApi?.getZoomLevel?.() ?? null;
    const extent = mapApi?.getMapExtent?.() ?? null;

    logger.info(
      "WalkController.matchInCurrentViewport: segments snapshot",
      {
        kmA,
        kmB,
        count: allSegments.length,
        attempts,
        elapsedMs: Date.now() - matchStartedAt,
        zoom,
        extent,
      },
    );

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

    logger.info("WalkController.matchInCurrentViewport: starting buffered intersects", {
      kmA,
      kmB,
      segmentCount: segmentLikes.length,
    });

    const bufferedStartedAt = Date.now();
    let bufferedMatchedIds: Set<number>;
    try {
      bufferedMatchedIds = await matchSegmentsAsync(
        { segments: segmentLikes, bufferedTrack },
        {
          chunkSize: MATCH_COMPUTE_YIELD_EVERY_SEGMENTS,
          yieldBetweenChunks: yieldToUi,
        },
      );
    } catch (err) {
      logger.error("WalkController.matchInCurrentViewport: matchSegments failed", {
        kmA,
        kmB,
        segmentCount: segmentLikes.length,
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

    const projectedSpanBySegmentId = new Map<number, number>();
    const projectedDurationMs = 0;
    logger.info("WalkController.matchInCurrentViewport: projection fallback disabled", {
      kmA,
      kmB,
      segmentCount: allSegments.length,
    });

    await yieldToUi();

    const matchedIds = new Set<number>([...bufferedMatchedIds, ...projectedSpanBySegmentId.keys()]);
    const allowEndBoundaryContinuation = kmB >= this.trackTotalKm - TRACK_END_EPSILON_KM;

    const filterStartedAt = Date.now();
    let filteredMatchedIds: Set<number>;
    try {
      filteredMatchedIds = await this.filterEndpointTouchingMatches(
        matchableSegments,
        matchedIds,
        slicedTrack,
        allowEndBoundaryContinuation,
        projectedSpanBySegmentId,
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
    const filterDurationMs = Date.now() - filterStartedAt;

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

    logger.info("WalkController.matchInCurrentViewport: match stages", {
      kmA,
      kmB,
      bufferedCount: bufferedMatchedIds.size,
      projectedCount: projectedSpanBySegmentId.size,
      combinedCount: matchedIds.size,
      filteredCount: filteredMatchedIds.size,
      emittedCount: newIds.length,
      bufferedDurationMs,
      projectedDurationMs,
      filterDurationMs,
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
        const cellMatchedIds = matchSegments({ segments: segmentLikes, bufferedTrack });

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

  private async filterEndpointTouchingMatches(
    allSegments: ReadonlyArray<{ id: number; geometry: LineString }>,
    matchedIdsForBatch: ReadonlySet<number>,
    slicedTrack: MultiLineString,
    allowEndBoundaryContinuation: boolean,
    projectedSpanBySegmentId: ReadonlyMap<number, number>,
  ): Promise<Set<number>> {
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
    const startBoundary = this.getStartBoundaryDirection(slicedTrack);
    const endBoundary = allowEndBoundaryContinuation
      ? this.getEndBoundaryDirection(slicedTrack)
      : null;

    let processedSegments = 0;
    for (const id of matchedIdsForBatch) {
      processedSegments += 1;
      if (processedSegments % MATCH_COMPUTE_YIELD_EVERY_SEGMENTS === 0) {
        await yieldToUi();
      }

      const segment = segmentById.get(id);
      if (!segment) {
        continue;
      }

      const projectedSpanMeters = projectedSpanBySegmentId.get(id);
      if (
        projectedSpanMeters !== undefined &&
        projectedSpanMeters >= PROJECTED_OVERRIDE_MIN_SPAN_METERS
      ) {
        filtered.add(id);
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
          filtered.add(id);
          continue;
        }

        const closeSpanMeters = this.distanceAlongSegment(
          segment.geometry.coordinates,
          closeVertexIndices[0],
          closeVertexIndices[closeVertexIndices.length - 1],
        );
        if (closeSpanMeters >= MIN_CLOSE_VERTEX_SPAN_METERS) {
          filtered.add(id);
          continue;
        }
      }

      if (this.isStartBoundaryContinuation(segment.geometry.coordinates, startBoundary)) {
        filtered.add(id);
        continue;
      }

      if (this.isEndBoundaryContinuation(segment.geometry.coordinates, endBoundary)) {
        filtered.add(id);
      }
    }

    return filtered;
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
    kmA: number,
    kmB: number,
  ): Promise<Map<number, number>> {
    if (!this.fullTrackLine) {
      return new Map<number, number>();
    }

    const isLastSlice = kmB >= this.trackTotalKm - TRACK_END_EPSILON_KM;
    const matchedSpanById = new Map<number, number>();

    let processedSegments = 0;
    for (const segment of allSegments) {
      processedSegments += 1;
      if (processedSegments % MATCH_COMPUTE_YIELD_EVERY_SEGMENTS === 0) {
        await yieldToUi();
      }

      if (segment.geometry.coordinates.length < 2) {
        continue;
      }

      const sampledCoordinates = this.sampleSegmentCoordinates(
        segment.geometry.coordinates,
        PROJECTED_SAMPLE_STEP_METERS,
      );
      if (sampledCoordinates.length === 0) {
        continue;
      }

      let closeSamples = 0;
      const projectedLocationsKm: number[] = [];
      for (const coordinate of sampledCoordinates) {
        const samplePoint = turfPoint(coordinate);
        const projected = nearestPointOnLine(this.fullTrackLine, samplePoint, {
          units: "kilometers",
        });
        const distanceMeters = turfDistance(samplePoint, projected, { units: "meters" });
        if (distanceMeters <= PROJECTED_DISTANCE_MAX_METERS) {
          closeSamples += 1;
          const locationKm = projected.properties.location;
          if (typeof locationKm === "number" && Number.isFinite(locationKm)) {
            projectedLocationsKm.push(locationKm);
          }
        }
      }

      if (projectedLocationsKm.length === 0) {
        continue;
      }

      const coverageRatio = closeSamples / sampledCoordinates.length;
      if (coverageRatio < PROJECTED_COVERAGE_MIN_RATIO) {
        continue;
      }

      const projectedMinKm = Math.min(...projectedLocationsKm);
      const projectedMaxKm = Math.max(...projectedLocationsKm);
      if (this.isProjectedSpanInSlice(projectedMinKm, projectedMaxKm, kmA, kmB, isLastSlice)) {
        matchedSpanById.set(segment.id, (projectedMaxKm - projectedMinKm) * 1000);
      }
    }

    return matchedSpanById;
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

    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const firstDistance = turfDistance(turfPoint(first), turfPoint(startBoundary.startPoint), {
      units: "meters",
    });
    const lastDistance = turfDistance(turfPoint(last), turfPoint(startBoundary.startPoint), {
      units: "meters",
    });

    if (firstDistance > START_BOUNDARY_MAX_DISTANCE_METERS || firstDistance > lastDistance) {
      return false;
    }

    const endpointDirection: [number, number] = [
      coordinates[1][0] - coordinates[0][0],
      coordinates[1][1] - coordinates[0][1],
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
