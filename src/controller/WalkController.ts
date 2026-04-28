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
import type { WmeSDK } from "wme-sdk-typings";
import type { LineString, MultiLineString } from "geojson";
import { buffer as turfBuffer, center as turfCenter } from "@turf/turf";
import { logger } from "../utils/logger";
import { measureViewportAtZ17 } from "../utils/measureViewport";
import { waitForMapIdle } from "../utils/waitForMapIdle";
import { planWalk } from "../matching/GridWalker";
import { matchSegments } from "../matching/SegmentMatcher";
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

  // Internal event emitters
  private readonly stateEmitter = new EventEmitter<[WalkState]>();
  private readonly progressEmitter = new EventEmitter<[number, number, number[]]>();
  private readonly matchFoundEmitter = new EventEmitter<[number, LineString]>();

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly track: MultiLineString,
  ) {}

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
        const allSegments = this.wmeSDK.DataModel.Segments.getAll();

        // Adapt SDK Segment objects to the structural SegmentLike type that
        // SegmentMatcher expects (keeps matching/ SDK-free).
        const segmentLikes = allSegments.map((s) => ({
          id: s.id,
          geometry: s.geometry,
        }));

        // Match against the buffered track.
        const cellMatchedIds = matchSegments({ segments: segmentLikes, bufferedTrack });

        // Compute the delta: IDs that are new in this cell.
        const newIds: number[] = [];
        for (const id of cellMatchedIds) {
          if (!this.matchedIds.has(id)) {
            this.matchedIds.add(id);
            newIds.push(id);
          }
        }

        // Cache geometries for new IDs (used in Palier 4 click-to-recenter).
        if (newIds.length > 0) {
          const segById = new Map(allSegments.map((s) => [s.id, s]));
          for (const id of newIds) {
            const seg = segById.get(id);
            if (seg) {
              this.geometryCache.set(id, seg.geometry);
            }
          }

          // Emit per-match events.
          for (const id of newIds) {
            const geom = this.geometryCache.get(id);
            if (geom) {
              this.matchFoundEmitter.emit(id, geom);
            }
          }
        }

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
