/**
 * MatchingPipeline — orchestrates the CSV-driven guided matching flow.
 *
 * For each CSV row (in order from store.currentIndex onward):
 *  1. Compute bbox view(s) for the portion via recursive bisection.
 *  2. Navigate the map + wait for idle.
 *  3. Run matchInCurrentViewport to populate the WalkController's match set.
 *  4. Select the matched segments in WME.
 *  5. Emit onRowMatched and wait for the UI's "Validate" button.
 *  6. On validate: read current WME selection (user may have corrected it),
 *     call store.validateRow, and advance.
 *
 * The pipeline never touches localStorage — Lot 5 wires persistence by
 * subscribing to the store and saving on every mutation.
 */

import type { WmeSDK, ZoomLevel } from "wme-sdk-typings";
import type { NormalizedTrack } from "../geojson/types";
import type { TrackLayer } from "../layers/TrackLayer";
import type { WalkController } from "./WalkController";
import type { SessionStore } from "../state/SessionStore";
import type { ClosureRowGroup, RowGeo } from "../csv/buildClosuresCsv";
import {
  computeMatchingWorkItems,
  sliceMultiLineByDistance,
  bboxOfMultiLineString,
  multiLineLengthKm,
} from "../matching/trackPortions";
import { waitForMapIdle } from "../utils/waitForMapIdle";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants (canonical values from the previous MatchPanel bbox logic)
// ---------------------------------------------------------------------------

const MIN_BBOX_ZOOM = 16 as const;
const VIEW_SLICE_EPSILON_KM = 0.005;
const VIEW_SLICE_MIN_SPAN_KM = 0.01;
const MAX_VIEW_SLICES_PER_ROW = 200;
const VIEW_SLICE_HEAD_RATIO = 0.75;
const MATCH_VIEW_SETTLE_DELAY_MS = 650;
const MATCH_POST_IDLE_DELAY_MS = 0;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PipelineEvents {
  onRowStarted?: (index: number, totalRows: number) => void;
  onRowMatched?: (index: number, segments: number[]) => void;
  onStep?: (event: PipelineStepEvent) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  onAborted?: () => void;
  onPaused?: () => void;
}

export interface PipelineStepEvent {
  key:
    | "planningStart"
    | "splitTail"
    | "sliceAccepted"
    | "sliceDropped"
    | "planningDone"
    | "processingLeaf"
    | "leafMatched"
    | "waitingLeafValidation";
  rowIndex: number;
  values?: Record<string, number | string>;
}

export interface MatchingPipelineOptions {
  burstMode?: boolean;
}

type PendingRowAction = "validate" | "skip" | "back" | "rerun" | "abort" | "pause";

// ---------------------------------------------------------------------------
// MatchingPipeline
// ---------------------------------------------------------------------------

export class MatchingPipeline {
  private readonly matchedGroups: ClosureRowGroup[] = [];

  // Abort flag: set by abort(), checked between rows and bbox views
  private abortRequested = false;
  private pauseRequested = false;
  private paused = false;

  // Tracks whether the loop is currently executing
  private running = false;

  // Resolve handle for the "waiting for validate" pause point. When the user
  // clicks Validate, validateCurrentRow() calls this to unblock the loop.
  private pendingResolver: ((action: PendingRowAction) => void) | null = null;

  // Resolve handle for abort while waiting for validate
  private pendingAbortReject: (() => void) | null = null;

  // Resolve handle for the in-loop burst pause gate. When set, the loop is
  // suspended after a leaf in burst mode until resume()/abort()/back resolves it.
  private burstPauseGate: ((action: "validate" | "abort" | "back") => void) | null = null;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly store: SessionStore,
    private readonly controller: WalkController,
    private readonly track: NormalizedTrack,
    private readonly trackLayer: TrackLayer,
    private readonly events: PipelineEvents,
    private readonly options: MatchingPipelineOptions,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Begin processing from store.currentIndex. No-op if already running.
   */
  start(): void {
    if (this.running) {
      logger.warn("MatchingPipeline.start: already running, ignoring");
      return;
    }
    logger.info("MatchingPipeline.start: requested", {
      currentIndex: this.store.getState().currentIndex,
      rowCount: this.store.getState().csvRows.length,
    });
    this.abortRequested = false;
    this.pauseRequested = false;
    this.paused = false;
    this.running = true;

    // Fire-and-forget: the pipeline runs asynchronously; errors surface via
    // events.onError rather than propagating to the caller.
    this.runLoop().catch((err: unknown) => {
      logger.error("MatchingPipeline: unexpected error in loop", err);
      const message = err instanceof Error ? err.message : String(err);
      this.events.onError?.(message);
      this.running = false;
    });
  }

  /**
   * Request a graceful stop. The current bbox view's await completes first;
   * the loop then exits after the current row if it is waiting for validate,
   * or between rows otherwise.
   */
  abort(): void {
    logger.info("MatchingPipeline.abort: requested");
    this.abortRequested = true;
    // If we are paused waiting for the user's validate click, unblock the
    // pause point so the loop can see the abort flag and exit cleanly.
    this.pendingAbortReject?.();
    this.burstPauseGate?.("abort");
  }

  /**
   * Request a soft pause. The current navigation/matching unit is allowed to
   * complete, then the loop emits onPaused without switching to done/aborted.
   */
  pause(): void {
    logger.info("MatchingPipeline.pause: requested");
    this.pauseRequested = true;
    this.pendingResolver?.("pause");
  }

  resume(): void {
    logger.info("MatchingPipeline.resume: requested", {
      paused: this.paused,
      running: this.running,
      hasBurstPauseGate: this.burstPauseGate !== null,
    });
    // Mid-loop burst pause: the runLoop is still active and awaiting our
    // signal. Resolving the gate counts as the user's implicit validation
    // of the current selection.
    if (this.burstPauseGate) {
      const gate = this.burstPauseGate;
      this.burstPauseGate = null;
      this.pauseRequested = false;
      gate("validate");
      return;
    }
    if (!this.paused || this.running) {
      return;
    }
    this.start();
  }

  /**
   * Called by the UI when the user clicks "Validate". Reads the current WME
   * selection (the user may have manually corrected it), then persists the
   * row via the store and resolves the pending loop pause.
   */
  validateCurrentRow(): void {
    if (!this.pendingResolver) {
      logger.warn("MatchingPipeline.validateCurrentRow: no pending row, ignoring");
      return;
    }
    logger.info("MatchingPipeline.validateCurrentRow: resolving pending validation gate");
    this.pendingResolver("validate");
  }

  skipCurrentRow(): void {
    if (!this.pendingResolver) {
      logger.warn("MatchingPipeline.skipCurrentRow: no pending row, ignoring");
      return;
    }
    logger.info("MatchingPipeline.skipCurrentRow: resolving pending skip gate");
    this.pendingResolver("skip");
  }

  goBackOneRow(): void {
    // Burst pause: rewind via the burst gate.
    if (this.burstPauseGate) {
      const gate = this.burstPauseGate;
      this.burstPauseGate = null;
      this.pauseRequested = false;
      logger.info("MatchingPipeline.goBackOneRow: resolving burst pause gate as back");
      gate("back");
      return;
    }
    if (!this.pendingResolver) {
      logger.warn("MatchingPipeline.goBackOneRow: no pending row, ignoring");
      return;
    }
    logger.info("MatchingPipeline.goBackOneRow: resolving pending back gate");
    this.pendingResolver("back");
  }

  rerunCurrentRow(): void {
    if (!this.pendingResolver) {
      logger.warn("MatchingPipeline.rerunCurrentRow: no pending row, ignoring");
      return;
    }
    logger.info("MatchingPipeline.rerunCurrentRow: resolving pending rerun gate");
    this.pendingResolver("rerun");
  }

  isRunning(): boolean {
    return this.running;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Read-only snapshot of per-leaf groups captured during the run. */
  getMatchedGroups(): readonly ClosureRowGroup[] {
    return this.matchedGroups;
  }

  // ---------------------------------------------------------------------------
  // Private — main loop
  // ---------------------------------------------------------------------------

  private async runLoop(): Promise<void> {
    const state = this.store.getState();
    const { csvRows } = state;
    const totalKm = state.trackLengthKm ?? 0;

    logger.info("MatchingPipeline.runLoop: starting", {
      rowCount: csvRows.length,
      currentIndex: state.currentIndex,
      totalKm,
    });

    if (csvRows.length === 0) {
      this.events.onError?.("No CSV rows loaded");
      this.running = false;
      return;
    }

    const workItems = computeMatchingWorkItems(csvRows, totalKm);

    logger.info("MatchingPipeline.runLoop: portions computed", {
      portionCount: workItems.length,
      firstPortion: workItems[0] ?? null,
    });

    for (let workItemIndex = 0; workItemIndex < workItems.length; workItemIndex++) {
      const workItem = workItems[workItemIndex];
      const i = workItem.rowIndex;
      if (i < this.store.getState().currentIndex) {
        continue;
      }

      if (this.stopIfRequested("before row", i)) {
        return;
      }

      this.events.onRowStarted?.(i, workItems.length);

      const row = csvRows[i];
      const collectedIds = new Set<number>();

      // Overlay the row's slice on the track layer in a contrasting colour so
      // the operator can confirm visually that the slice boundaries align with
      // the displayed km labels before validating.
      const rowSliceGeometry = sliceMultiLineByDistance(
        this.track.geometry,
        workItem.kmA,
        workItem.kmB,
      );
      this.trackLayer.setHighlightedSlice(rowSliceGeometry);

      logger.info("MatchingPipeline.runLoop: row started", {
        rowIndex: i,
        totalRows: workItems.length,
        distance: row.distance,
        startTime: row.startTime,
        endTime: row.endTime,
        kmA: workItem.kmA,
        kmB: workItem.kmB,
      });

      // --- Compute zoom-fitting leaf slices and run matching per slice -------

      const leafSlices = await this.planLeafSlices(i, workItem.kmA, workItem.kmB);

      this.events.onStep?.({
        key: "planningDone",
        rowIndex: i,
        values: { count: leafSlices.length },
      });

      if (this.stopIfRequested("after planning", i)) {
        return;
      }

      // Per-leaf validated contributions. Index aligns with leafSlices.
      // null = pending (not yet validated). [] = explicitly skipped or empty.
      const leafValidatedIds: (number[] | null)[] = leafSlices.map(() => null);
      const leafGroups: (ClosureRowGroup | null)[] = leafSlices.map(() => null);
      let backToPreviousRow = false;

      let leafIndex = 0;
      while (leafIndex < leafSlices.length) {
        const leafSlice = leafSlices[leafIndex];
        if (this.abortRequested || this.pauseRequested) break;

        const leafIds = new Set<number>();
        this.events.onStep?.({
          key: "processingLeaf",
          rowIndex: i,
          values: {
            index: leafIndex + 1,
            total: leafSlices.length,
            kmA: Number(leafSlice.kmA.toFixed(2)),
            kmB: Number(leafSlice.kmB.toFixed(2)),
          },
        });

        // Mirror the historical manual per-view flow exactly: once bbox
        // discovery has produced a center+zoom leaf, matching is launched from
        // that recorded view via setMapCenter, not by recomputing zoomToExtent.
        this.wmeSDK.Map.setMapCenter({
          lonLat: { lon: leafSlice.lon, lat: leafSlice.lat },
          zoomLevel: leafSlice.zoom,
        });
        await waitForMapIdle(this.wmeSDK, { settleDelayMs: MATCH_VIEW_SETTLE_DELAY_MS });
        await new Promise<void>((resolve) => setTimeout(resolve, MATCH_POST_IDLE_DELAY_MS));

        if (this.abortRequested || this.pauseRequested) break;

        // Subscribe to matchFound before calling matchInCurrentViewport so we
        // capture all results including the sync ones.
        const unsub = this.controller.onMatchFound((id) => {
          leafIds.add(id);
        });

        try {
          await this.controller.matchInCurrentViewport(leafSlice.kmA, leafSlice.kmB);
          this.events.onStep?.({
            key: "leafMatched",
            rowIndex: i,
            values: {
              index: leafIndex + 1,
              total: leafSlices.length,
              count: leafIds.size,
            },
          });
        } finally {
          unsub();
        }

        const leafMatchedIds = Array.from(leafIds);

        if (this.options.burstMode) {
          let validatedIds = leafMatchedIds;

          if (this.pauseRequested && !this.abortRequested) {
            // Burst pause: select the leaf's matched ids so the operator can
            // inspect/correct, then halt until resume(). Resume implicitly
            // validates the current WME selection.
            try {
              this.wmeSDK.Editing.setSelection({
                selection: { ids: leafMatchedIds, objectType: "segment" },
              });
              this.events.onRowMatched?.(i, leafMatchedIds);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              logger.warn(
                `MatchingPipeline: setSelection failed during burst pause for leaf ${leafIndex + 1}/${leafSlices.length} of row ${i}: ${message}`,
              );
              this.events.onError?.(message);
            }

            this.paused = true;
            this.pauseRequested = false;
            this.running = false;
            this.events.onPaused?.();

            const action = await new Promise<"validate" | "abort" | "back">((resolve) => {
              this.burstPauseGate = resolve;
            });

            this.paused = false;
            this.running = true;

            if (action === "abort") {
              this.trackLayer.setHighlightedSlice(null);
              this.running = false;
              this.events.onAborted?.();
              return;
            }

            if (action === "back") {
              // Drop the current row's progress entirely and rewind to the
              // previous row — the user paused too late and wants to redo it.
              backToPreviousRow = true;
              break;
            }

            // Treat resume as implicit validation: capture any manual
            // correction the operator made to the WME selection.
            const selection = this.wmeSDK.Editing.getSelection();
            if (selection !== null && selection.objectType === "segment") {
              validatedIds = (selection.ids as number[]).slice();
            }
          }

          leafValidatedIds[leafIndex] = validatedIds;
          validatedIds.forEach((id) => collectedIds.add(id));
          if (validatedIds.length > 0) {
            leafGroups[leafIndex] = {
              rowIndex: i,
              segmentIds: validatedIds,
              geo: { lon: leafSlice.lon, lat: leafSlice.lat, zoom: leafSlice.zoom },
            };
          }
          leafIndex += 1;
          continue;
        }

        // --- Set selection on this leaf's matched ids ------------------------
        // All ids were just collected via onMatchFound in the current viewport,
        // so they are guaranteed loaded — no need to filter via Segments.getAll.
        try {
          this.wmeSDK.Editing.setSelection({
            selection: { ids: leafMatchedIds, objectType: "segment" },
          });
          // Surface the leaf's matched ids to the UI so the segment count
          // updates and Reselect works on the currently visible selection.
          this.events.onRowMatched?.(i, leafMatchedIds);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(
            `MatchingPipeline: setSelection failed for leaf ${leafIndex + 1}/${leafSlices.length} of row ${i}: ${message}`,
          );
          this.events.onError?.(message);
        }

        this.events.onStep?.({
          key: "waitingLeafValidation",
          rowIndex: i,
          values: {
            index: leafIndex + 1,
            total: leafSlices.length,
          },
        });

        const action = await this.waitForValidate();

        if (action === "abort") {
          this.trackLayer.setHighlightedSlice(null);
          this.running = false;
          this.events.onAborted?.();
          return;
        }

        if (action === "pause") {
          this.trackLayer.setHighlightedSlice(null);
          this.paused = true;
          this.running = false;
          this.events.onPaused?.();
          return;
        }

        if (action === "rerun") {
          // Forget this leaf's pending contribution and re-execute the same leaf.
          leafValidatedIds[leafIndex] = null;
          leafGroups[leafIndex] = null;
          continue;
        }

        if (action === "back") {
          if (leafIndex > 0) {
            // Drop the previous leaf's contribution and re-execute it.
            leafIndex -= 1;
            leafValidatedIds[leafIndex] = null;
            leafGroups[leafIndex] = null;
            continue;
          }
          // First leaf: behave as row-level back.
          backToPreviousRow = true;
          break;
        }

        if (action === "skip") {
          // Skip this leaf's contribution. If there is more than one leaf,
          // continue with the next; otherwise the row will be persisted with
          // an empty selection (matching the previous row-level skip).
          leafValidatedIds[leafIndex] = [];
          leafGroups[leafIndex] = null;
          leafIndex += 1;
          continue;
        }

        // action === "validate": read the current selection so manual
        // corrections are captured.
        const validatedIds = (() => {
          const selection = this.wmeSDK.Editing.getSelection();
          if (selection === null || selection.objectType !== "segment") {
            return leafMatchedIds;
          }
          return (selection.ids as number[]).slice();
        })();
        leafValidatedIds[leafIndex] = validatedIds;
        validatedIds.forEach((id) => collectedIds.add(id));
        if (validatedIds.length > 0) {
          leafGroups[leafIndex] = {
            rowIndex: i,
            segmentIds: validatedIds,
            geo: { lon: leafSlice.lon, lat: leafSlice.lat, zoom: leafSlice.zoom },
          };
        }
        leafIndex += 1;
      }

      if (this.stopIfRequested("after leaf matching", i)) {
        return;
      }

      if (backToPreviousRow) {
        const restartIndex = Math.max(0, i - 1);
        logger.info("MatchingPipeline.runLoop: rewinding to previous row", {
          rowIndex: i,
          restartIndex,
        });
        this.store.rewindToRow(restartIndex);
        this.removeGroupsFromRow(restartIndex);
        const restartWorkItemIndex = workItems.findIndex((item) => item.rowIndex >= restartIndex);
        workItemIndex = restartWorkItemIndex === -1 ? workItems.length : restartWorkItemIndex - 1;
        continue;
      }

      const ids = Array.from(collectedIds);
      this.events.onRowMatched?.(i, ids);

      const finalSegmentIds = leafValidatedIds.flatMap((entry) => entry ?? []);
      const dedupedFinalIds = Array.from(new Set(finalSegmentIds));
      const validatedRowGroups = leafGroups.filter(
        (group): group is ClosureRowGroup => group !== null,
      );

      const startISO = `${row.date}T${row.startTime}`;
      const endISO = `${row.date}T${row.endTime}`;
      logger.info("MatchingPipeline.runLoop: persisting validated row", {
        rowIndex: i,
        finalSegmentCount: dedupedFinalIds.length,
        leafCount: leafSlices.length,
        startISO,
        endISO,
      });
      this.setValidatedGroups(i, validatedRowGroups);
      this.store.validateRow(i, dedupedFinalIds, startISO, endISO);

      if (this.options.burstMode && this.stopIfRequested("after burst row validation", i)) {
        return;
      }
    }

    logger.info("MatchingPipeline.runLoop: completed all rows");
    this.trackLayer.setHighlightedSlice(null);
    // Clear the WME selection so the operator returns to a clean map view and
    // the script panel can present its post-matching controls (download, etc.)
    // without lingering segment highlights from the last leaf.
    try {
      this.wmeSDK.Editing.setSelection({
        selection: { ids: [], objectType: "segment" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`MatchingPipeline: clearing selection on done failed: ${message}`);
    }
    this.running = false;
    this.events.onDone?.();
  }

  private stopIfRequested(location: string, rowIndex: number): boolean {
    if (this.abortRequested) {
      logger.info(`MatchingPipeline: aborted ${location}`, { rowIndex });
      this.trackLayer.setHighlightedSlice(null);
      // Update internal state BEFORE emitting the event so handlers reading
      // isRunning()/isPaused() observe the post-stop state.
      this.running = false;
      this.events.onAborted?.();
      return true;
    }

    if (this.pauseRequested) {
      logger.info(`MatchingPipeline: paused ${location}`, { rowIndex });
      this.trackLayer.setHighlightedSlice(null);
      this.paused = true;
      this.running = false;
      this.events.onPaused?.();
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Private — zoom-fitting leaf slices
  // ---------------------------------------------------------------------------

  /**
   * Split a portion into contiguous leaf slices that each fit at z15 or above.
   *
   * Instead of recursively halving the portion, this trims the tail until the
   * leading chunk fits, records that chunk, then repeats on the remainder. The
   * result is a sequence of sub-slices that preserve the track order and can be
   * exported independently with their own map anchor.
   */
  private async planLeafSlices(rowIndex: number, kmA: number, kmB: number): Promise<ViewSlice[]> {
    const slices: ViewSlice[] = [];
    const tailBuffer: PendingSlice[] = [{ kmA, kmB }];
    this.events.onStep?.({
      key: "planningStart",
      rowIndex,
      values: {
        kmA: Number(kmA.toFixed(2)),
        kmB: Number(kmB.toFixed(2)),
      },
    });

    while (tailBuffer.length > 0) {
      if (this.abortRequested || this.pauseRequested) {
        break;
      }

      if (slices.length >= MAX_VIEW_SLICES_PER_ROW) {
        logger.warn("MatchingPipeline.planLeafSlices: reached slice safety cap", {
          kmA,
          kmB,
          generatedCount: slices.length,
        });
        break;
      }

      const pendingSlice = tailBuffer.pop();
      if (!pendingSlice) {
        break;
      }

      const fittedSlice = await this.fitPendingSlice(rowIndex, pendingSlice, tailBuffer);
      if (fittedSlice === null) {
        this.events.onStep?.({
          key: "sliceDropped",
          rowIndex,
          values: {
            kmA: Number(pendingSlice.kmA.toFixed(2)),
            kmB: Number(pendingSlice.kmB.toFixed(2)),
          },
        });
        continue;
      }

      slices.push(fittedSlice);
    }

    return slices;
  }

  private async fitPendingSlice(
    rowIndex: number,
    pendingSlice: PendingSlice,
    tailBuffer: PendingSlice[],
  ): Promise<ViewSlice | null> {
    let currentKmA = pendingSlice.kmA;
    let currentGeometry = sliceMultiLineByDistance(
      this.track.geometry,
      currentKmA,
      pendingSlice.kmB,
    );

    const enqueueRemainingTail = (acceptedKmB: number): void => {
      if (pendingSlice.kmB - acceptedKmB <= VIEW_SLICE_EPSILON_KM) {
        return;
      }

      tailBuffer.push({
        kmA: acceptedKmB,
        kmB: pendingSlice.kmB,
      });
    };

    while (currentGeometry.coordinates.length > 0) {
      if (this.abortRequested || this.pauseRequested) {
        return null;
      }
      const candidateSlice = await this.evaluateLeafSlice(currentKmA, currentGeometry);
      if (candidateSlice === null) {
        return null;
      }

      const fitsAtTargetZoom = candidateSlice.zoom >= MIN_BBOX_ZOOM;
      const spanKm = candidateSlice.kmB - currentKmA;
      if (fitsAtTargetZoom) {
        enqueueRemainingTail(candidateSlice.kmB);
        this.events.onStep?.({
          key: "sliceAccepted",
          rowIndex,
          values: {
            kmA: Number(candidateSlice.kmA.toFixed(2)),
            kmB: Number(candidateSlice.kmB.toFixed(2)),
            zoom: candidateSlice.zoom,
          },
        });
        return candidateSlice;
      }

      if (spanKm <= VIEW_SLICE_MIN_SPAN_KM) {
        logger.warn(
          "MatchingPipeline.fitPendingSlice: accepting undersized leaf slice below target zoom",
          {
            candidateSlice,
            remainingTailCount: tailBuffer.length,
          },
        );
        enqueueRemainingTail(candidateSlice.kmB);
        this.events.onStep?.({
          key: "sliceAccepted",
          rowIndex,
          values: {
            kmA: Number(candidateSlice.kmA.toFixed(2)),
            kmB: Number(candidateSlice.kmB.toFixed(2)),
            zoom: candidateSlice.zoom,
          },
        });
        return candidateSlice;
      }

      const headKmB = currentKmA + spanKm * VIEW_SLICE_HEAD_RATIO;
      const tailKmA = headKmB;
      const tailKmB = pendingSlice.kmB;

      if (headKmB - currentKmA <= VIEW_SLICE_EPSILON_KM) {
        logger.warn(
          "MatchingPipeline.fitPendingSlice: split would not make progress; accepting current slice",
          {
            candidateSlice,
            remainingTailCount: tailBuffer.length,
          },
        );
        enqueueRemainingTail(candidateSlice.kmB);
        return candidateSlice;
      }

      const headGeometry = sliceMultiLineByDistance(this.track.geometry, currentKmA, headKmB);
      if (headGeometry.coordinates.length === 0) {
        logger.warn(
          "MatchingPipeline.fitPendingSlice: split produced empty head; accepting current slice",
          {
            candidateSlice,
            remainingTailCount: tailBuffer.length,
          },
        );
        enqueueRemainingTail(candidateSlice.kmB);
        return candidateSlice;
      }

      this.events.onStep?.({
        key: "splitTail",
        rowIndex,
        values: {
          zoom: candidateSlice.zoom,
          headA: Number(currentKmA.toFixed(2)),
          headB: Number(headKmB.toFixed(2)),
          tailA: Number(tailKmA.toFixed(2)),
          tailB: Number(tailKmB.toFixed(2)),
        },
      });

      currentGeometry = headGeometry;
    }

    return null;
  }

  private async evaluateLeafSlice(
    kmA: number,
    geometry: import("geojson").MultiLineString,
  ): Promise<ViewSlice | null> {
    if (this.abortRequested || this.pauseRequested) {
      return null;
    }

    const box = bboxOfMultiLineString(geometry);

    if (!box) {
      return null;
    }

    this.wmeSDK.Map.zoomToExtent({ bbox: box });
    await waitForMapIdle(this.wmeSDK);

    const zoom = this.wmeSDK.Map.getZoomLevel();
    const kmB = kmA + multiLineLengthKm(geometry);
    return {
      kmA,
      kmB,
      lon: (box[0] + box[2]) / 2,
      lat: (box[1] + box[3]) / 2,
      zoom,
    };
  }

  // ---------------------------------------------------------------------------
  // Private — validate-gate helper
  // ---------------------------------------------------------------------------

  /**
   * Suspend the loop until validateCurrentRow() is called (returns true) or
   * abort() is called (returns false). Storing both resolve functions lets
   * abort() interrupt the wait cleanly.
   */
  private waitForValidate(): Promise<PendingRowAction> {
    return new Promise<PendingRowAction>((resolve) => {
      this.pendingResolver = (action) => {
        this.pendingResolver = null;
        this.pendingAbortReject = null;
        resolve(action);
      };
      this.pendingAbortReject = () => {
        this.pendingResolver = null;
        this.pendingAbortReject = null;
        resolve("abort");
      };
    });
  }

  private removeGroupsFromRow(rowIndex: number): void {
    for (let index = this.matchedGroups.length - 1; index >= 0; index--) {
      if (this.matchedGroups[index].rowIndex >= rowIndex) {
        this.matchedGroups.splice(index, 1);
      }
    }
  }

  private setValidatedGroups(rowIndex: number, validatedGroups: readonly ClosureRowGroup[]): void {
    this.removeGroupsFromRow(rowIndex);
    for (const group of validatedGroups) {
      if (group.segmentIds.length === 0) continue;
      this.matchedGroups.push({
        rowIndex,
        segmentIds: group.segmentIds.slice(),
        geo: group.geo,
      });
    }
    this.matchedGroups.sort((left, right) => left.rowIndex - right.rowIndex);
  }
}

interface ViewSlice extends RowGeo {
  kmA: number;
  kmB: number;
  zoom: ZoomLevel;
}

interface PendingSlice {
  kmA: number;
  kmB: number;
}
