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
  trimTrailingCoordinate,
} from "../matching/trackPortions";
import { waitForMapIdle } from "../utils/waitForMapIdle";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants (canonical values from the previous MatchPanel bbox logic)
// ---------------------------------------------------------------------------

const MIN_BBOX_ZOOM = 15 as const;
const VIEW_SLICE_EPSILON_KM = 0.005;
const VIEW_SLICE_MIN_SPAN_KM = 0.01;
const MAX_VIEW_SLICES_PER_ROW = 200;

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
    | "waitingValidation";
  rowIndex: number;
  values?: Record<string, number | string>;
}

export interface MatchingPipelineOptions {
  burstMode?: boolean;
}

type PendingRowAction = "validate" | "skip" | "back" | "abort" | "pause";

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
    });
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
    if (!this.pendingResolver) {
      logger.warn("MatchingPipeline.goBackOneRow: no pending row, ignoring");
      return;
    }
    logger.info("MatchingPipeline.goBackOneRow: resolving pending back gate");
    this.pendingResolver("back");
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
    const { csvRows, currentIndex } = state;
    const totalKm = state.trackLengthKm ?? 0;

    logger.info("MatchingPipeline.runLoop: starting", {
      rowCount: csvRows.length,
      currentIndex,
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
      if (i < currentIndex) {
        continue;
      }

      if (this.stopIfRequested("before row", i)) {
        return;
      }

      this.events.onRowStarted?.(i, workItems.length);

      const row = csvRows[i];
      const collectedIds = new Set<number>();

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

      logger.info("MatchingPipeline.runLoop: planning leaf slices", {
        rowIndex: i,
        kmA: workItem.kmA,
        kmB: workItem.kmB,
      });
      const leafSlices = await this.planLeafSlices(i, workItem.kmA, workItem.kmB);

      logger.info("MatchingPipeline.runLoop: leaf slice planning complete", {
        rowIndex: i,
        leafSliceCount: leafSlices.length,
        leafSlices,
      });
      this.events.onStep?.({
        key: "planningDone",
        rowIndex: i,
        values: { count: leafSlices.length },
      });

      if (this.stopIfRequested("after planning", i)) {
        return;
      }

      const rowGroups: ClosureRowGroup[] = [];

      for (let leafIndex = 0; leafIndex < leafSlices.length; leafIndex++) {
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

        logger.info("MatchingPipeline.runLoop: navigating to recorded view", {
          rowIndex: i,
          leafSlice,
        });

        // Mirror the historical manual per-view flow exactly: once bbox
        // discovery has produced a center+zoom leaf, matching is launched from
        // that recorded view via setMapCenter, not by recomputing zoomToExtent.
        this.wmeSDK.Map.setMapCenter({
          lonLat: { lon: leafSlice.lon, lat: leafSlice.lat },
          zoomLevel: leafSlice.zoom,
        });
        logger.info("MatchingPipeline.runLoop: waiting for map idle after setMapCenter", {
          rowIndex: i,
          leafSlice,
        });
        await waitForMapIdle(this.wmeSDK);
        logger.info("MatchingPipeline.runLoop: map idle after setMapCenter", {
          rowIndex: i,
          leafSlice,
        });

        if (this.abortRequested || this.pauseRequested) break;

        // Subscribe to matchFound before calling matchInCurrentViewport so we
        // capture all results including the sync ones.
        const unsub = this.controller.onMatchFound((id) => {
          leafIds.add(id);
        });

        try {
          logger.info("MatchingPipeline.runLoop: calling matchInCurrentViewport", {
            rowIndex: i,
            kmA: leafSlice.kmA,
            kmB: leafSlice.kmB,
          });
          await this.controller.matchInCurrentViewport(leafSlice.kmA, leafSlice.kmB);
          logger.info("MatchingPipeline.runLoop: matchInCurrentViewport resolved", {
            rowIndex: i,
            leafMatchCount: leafIds.size,
          });
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

        const leafGroupIds = Array.from(leafIds);
        leafGroupIds.forEach((id) => {
          collectedIds.add(id);
        });

        if (leafGroupIds.length > 0) {
          rowGroups.push({
            rowIndex: i,
            segmentIds: leafGroupIds,
            geo: { lon: leafSlice.lon, lat: leafSlice.lat, zoom: leafSlice.zoom },
          });
        }
      }

      if (this.stopIfRequested("after leaf matching", i)) {
        return;
      }

      // --- Select matched segments in WME ------------------------------------

      const ids = Array.from(collectedIds);
      this.events.onRowMatched?.(i, ids);

      if (this.options.burstMode) {
        const startISO = `${row.date}T${row.startTime}`;
        const endISO = `${row.date}T${row.endTime}`;
        logger.info("MatchingPipeline.runLoop: burst mode auto-validating row", {
          rowIndex: i,
          idsCount: ids.length,
          startISO,
          endISO,
        });
        this.setValidatedGroups(i, rowGroups, ids);
        this.store.validateRow(i, ids, startISO, endISO);
        if (this.stopIfRequested("after burst row validation", i)) {
          return;
        }
        continue;
      }

      try {
        const loadedSegmentIds = new Set(
          this.wmeSDK.DataModel.Segments.getAll().map((segment) => segment.id),
        );
        const selectableIds = ids.filter((id) => loadedSegmentIds.has(id));
        const skippedIds = ids.filter((id) => !loadedSegmentIds.has(id));

        if (skippedIds.length > 0) {
          logger.warn(
            "MatchingPipeline.runLoop: some matched IDs are not currently loaded; selecting loaded subset",
            {
              rowIndex: i,
              matchedCount: ids.length,
              selectableCount: selectableIds.length,
              skippedCount: skippedIds.length,
              skippedSample: skippedIds.slice(0, 10),
            },
          );
        }

        if (selectableIds.length === 0) {
          logger.warn(
            "MatchingPipeline.runLoop: no matched IDs currently loaded; skipping WME selection",
            {
              rowIndex: i,
              matchedCount: ids.length,
            },
          );
          this.events.onError?.(
            "Aucun segment de cette ligne n'est chargé dans la vue courante. Déplacez la carte puis validez/corrigez manuellement.",
          );
        } else {
          logger.info("MatchingPipeline.runLoop: setting WME selection", {
            rowIndex: i,
            idsCount: ids.length,
            selectableCount: selectableIds.length,
            idsSample: selectableIds.slice(0, 10),
          });
          this.wmeSDK.Editing.setSelection({
            selection: { ids: selectableIds, objectType: "segment" },
          });
          logger.info("MatchingPipeline.runLoop: WME selection set", {
            rowIndex: i,
            selectableCount: selectableIds.length,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`MatchingPipeline: setSelection failed for row ${i}: ${message}`);
        this.events.onError?.(message);
        // Continue — the user may still manually correct the selection before validating.
      }

      logger.info("MatchingPipeline.runLoop: waiting for user validation", {
        rowIndex: i,
        idsCount: ids.length,
      });
      this.events.onStep?.({ key: "waitingValidation", rowIndex: i });

      // --- Wait for user to click Validate -----------------------------------

      const action = await this.waitForValidate();
      logger.info("MatchingPipeline.runLoop: row action resolved", {
        rowIndex: i,
        action,
      });
      if (action === "abort") {
        // Abort was requested while waiting for the user
        this.events.onAborted?.();
        this.running = false;
        return;
      }

      if (action === "pause") {
        this.events.onPaused?.();
        this.paused = true;
        this.running = false;
        return;
      }

      if (action === "back") {
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

      const finalSegmentIds =
        action === "skip"
          ? []
          : (() => {
              // Read the CURRENT WME selection at validate time (not the auto-selected
              // ids from matching): the user may have corrected the selection manually.
              const selection = this.wmeSDK.Editing.getSelection();
              if (selection === null || selection.objectType !== "segment") {
                return ids;
              }

              const loadedSegmentIds = new Set(
                this.wmeSDK.DataModel.Segments.getAll().map((segment) => segment.id),
              );
              const selectedIds = selection.ids as number[];
              const detectedButUnloadedIds = ids.filter((id) => !loadedSegmentIds.has(id));

              return Array.from(new Set([...selectedIds, ...detectedButUnloadedIds]));
            })();

      const startISO = `${row.date}T${row.startTime}`;
      const endISO = `${row.date}T${row.endTime}`;
      logger.info("MatchingPipeline.runLoop: persisting validated row", {
        rowIndex: i,
        finalSegmentCount: finalSegmentIds.length,
        startISO,
        endISO,
      });
      this.setValidatedGroups(i, rowGroups, finalSegmentIds);
      this.store.validateRow(i, finalSegmentIds, startISO, endISO);
    }

    logger.info("MatchingPipeline.runLoop: completed all rows");
    this.events.onDone?.();
    this.running = false;
  }

  private stopIfRequested(location: string, rowIndex: number): boolean {
    if (this.abortRequested) {
      logger.info(`MatchingPipeline: aborted ${location}`, { rowIndex });
      this.events.onAborted?.();
      this.running = false;
      return true;
    }

    if (this.pauseRequested) {
      logger.info(`MatchingPipeline: paused ${location}`, { rowIndex });
      this.events.onPaused?.();
      this.paused = true;
      this.running = false;
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
      if (this.abortRequested) {
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

      logger.info("MatchingPipeline.planLeafSlices: inspecting pending slice", {
        pendingSlice,
        remainingTailCount: tailBuffer.length,
      });

      const fittedSlice = await this.fitPendingSlice(rowIndex, pendingSlice, tailBuffer);
      if (fittedSlice === null) {
        logger.warn("MatchingPipeline.planLeafSlices: dropping empty or invalid pending slice", {
          pendingSlice,
        });
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
    let currentKmB = pendingSlice.kmB;
    let currentGeometry = sliceMultiLineByDistance(this.track.geometry, currentKmA, currentKmB);

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
      const candidateSlice = await this.evaluateLeafSlice(currentKmA, currentGeometry);
      if (candidateSlice === null) {
        return null;
      }

      logger.info("MatchingPipeline.fitPendingSlice: evaluated candidate", {
        kmA: currentKmA,
        kmB: currentKmB,
        zoom: candidateSlice.zoom,
        remainingTailCount: tailBuffer.length,
      });

      const fitsAtTargetZoom = candidateSlice.zoom >= MIN_BBOX_ZOOM;
      const spanKm = candidateSlice.kmB - currentKmA;
      if (fitsAtTargetZoom) {
        logger.info("MatchingPipeline.fitPendingSlice: accepted fitting leaf slice", {
          candidateSlice,
          remainingTailCount: tailBuffer.length,
        });
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

      const trimmedGeometry = trimTrailingCoordinate(currentGeometry);
      if (trimmedGeometry === null) {
        logger.warn(
          "MatchingPipeline.fitPendingSlice: cannot trim trailing coordinate further; accepting current slice",
          {
            candidateSlice,
            remainingTailCount: tailBuffer.length,
          },
        );
        enqueueRemainingTail(candidateSlice.kmB);
        return candidateSlice;
      }

      const trimmedLengthKm = multiLineLengthKm(trimmedGeometry);
      const headKmB = currentKmA + trimmedLengthKm;
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

      logger.info("MatchingPipeline.fitPendingSlice: moved tail to buffer", {
        keptKmA: currentKmA,
        keptKmB: headKmB,
        bufferedTail: { kmA: tailKmA, kmB: tailKmB },
        removedCoordinateCount: 1,
        remainingTailCount: tailBuffer.length,
      });
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

      currentKmB = headKmB;
      currentGeometry = trimmedGeometry;
    }

    return null;
  }

  private async evaluateLeafSlice(
    kmA: number,
    geometry: import("geojson").MultiLineString,
  ): Promise<ViewSlice | null> {
    if (this.abortRequested) {
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

  private setValidatedGroups(
    rowIndex: number,
    detectedGroups: readonly ClosureRowGroup[],
    finalSegmentIds: readonly number[],
  ): void {
    const selectedIds = new Set(finalSegmentIds);
    const validatedGroups = detectedGroups
      .map((group) => ({
        rowIndex,
        segmentIds: group.segmentIds.filter((id) => selectedIds.has(id)),
        geo: group.geo,
      }))
      .filter((group) => group.segmentIds.length > 0);

    const assignedIds = new Set(validatedGroups.flatMap((group) => group.segmentIds));
    const extraIds = finalSegmentIds.filter((id) => !assignedIds.has(id));

    if (extraIds.length > 0) {
      const fallbackGeo = detectedGroups[detectedGroups.length - 1]?.geo ?? {
        lon: 0,
        lat: 0,
        zoom: MIN_BBOX_ZOOM,
      };
      validatedGroups.push({
        rowIndex,
        segmentIds: extraIds,
        geo: fallbackGeo,
      });
    }

    this.removeGroupsFromRow(rowIndex);
    this.matchedGroups.push(...validatedGroups);
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
