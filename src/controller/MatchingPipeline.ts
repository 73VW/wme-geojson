/**
 * MatchingPipeline — orchestrates the CSV-driven guided matching flow.
 *
 * For each CSV row (in order from store.currentIndex onward):
 *  1. Compute bbox view(s) for the portion via recursive bisection.
 *  2. Navigate the map + wait for idle.
 *  3. Run matchInCurrentViewport to populate the WalkController's match set.
 *  4. Select the matched segments in WME, then re-activate the userscript tab.
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
import {
  computeMatchingWorkItems,
  sliceMultiLineByDistance,
  bboxOfMultiLineString,
} from "../matching/trackPortions";
import { waitForMapIdle } from "../utils/waitForMapIdle";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants (canonical values from the previous MatchPanel bbox logic)
// ---------------------------------------------------------------------------

const MIN_BBOX_ZOOM = 15 as const;
const MAX_BISECT_DEPTH = 8 as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RowGeo {
  lon: number;
  lat: number;
  zoom: number;
}

export interface PipelineEvents {
  onRowStarted?: (index: number, totalRows: number) => void;
  onRowMatched?: (index: number, segments: number[]) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  onAborted?: () => void;
}

export interface MatchingPipelineOptions {
  burstMode?: boolean;
}

type PendingRowAction = "validate" | "skip" | "back" | "abort";

// ---------------------------------------------------------------------------
// MatchingPipeline
// ---------------------------------------------------------------------------

export class MatchingPipeline {
  // Captured geo context for each row, indexed parallel to store.csvRows
  private readonly rowGeos: RowGeo[] = [];

  // Abort flag: set by abort(), checked between rows and bbox views
  private abortRequested = false;

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
    // The tab label element returned by Sidebar.registerScriptTab().
    // Clicking it re-activates the userscript tab — the SDK has no
    // programmatic selectTab API, so this is the only available mechanism.
    private readonly tabLabel: HTMLElement,
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

  /** Read-only snapshot of per-row geo contexts captured during the run. */
  getRowGeos(): readonly RowGeo[] {
    return this.rowGeos;
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

      if (this.abortRequested) {
        logger.info("MatchingPipeline: aborted before row", i);
        this.events.onAborted?.();
        this.running = false;
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

      // --- Compute bbox view(s) via bisection and run matching per view -------

      const viewGeos: Array<{ lon: number; lat: number; zoom: ZoomLevel }> = [];
      logger.info("MatchingPipeline.runLoop: starting bbox bisection", {
        rowIndex: i,
        kmA: workItem.kmA,
        kmB: workItem.kmB,
      });
      await this.bisect(workItem.kmA, workItem.kmB, 0, viewGeos);

      logger.info("MatchingPipeline.runLoop: bbox bisection complete", {
        rowIndex: i,
        viewCount: viewGeos.length,
        views: viewGeos,
      });

      if (this.abortRequested) {
        this.events.onAborted?.();
        this.running = false;
        return;
      }

      // The last view is what the user sees after all bisect navigations; use
      // it as the canonical RowGeo anchor for the closures CSV.
      const lastView = viewGeos[viewGeos.length - 1];

      for (const view of viewGeos) {
        if (this.abortRequested) break;

        logger.info("MatchingPipeline.runLoop: navigating to recorded view", {
          rowIndex: i,
          view,
        });

        // Mirror the historical manual per-view flow exactly: once bbox
        // discovery has produced a center+zoom leaf, matching is launched from
        // that recorded view via setMapCenter, not by recomputing zoomToExtent.
        this.wmeSDK.Map.setMapCenter({
          lonLat: { lon: view.lon, lat: view.lat },
          zoomLevel: view.zoom,
        });
        logger.info("MatchingPipeline.runLoop: waiting for map idle after setMapCenter", {
          rowIndex: i,
          view,
        });
        await waitForMapIdle(this.wmeSDK);
        logger.info("MatchingPipeline.runLoop: map idle after setMapCenter", {
          rowIndex: i,
          view,
        });

        if (this.abortRequested) break;

        // Subscribe to matchFound before calling matchInCurrentViewport so we
        // capture all results including the sync ones.
        const unsub = this.controller.onMatchFound((id) => {
          collectedIds.add(id);
        });

        try {
          logger.info("MatchingPipeline.runLoop: calling matchInCurrentViewport", {
            rowIndex: i,
            kmA: workItem.kmA,
            kmB: workItem.kmB,
          });
          await this.controller.matchInCurrentViewport(workItem.kmA, workItem.kmB);
          logger.info("MatchingPipeline.runLoop: matchInCurrentViewport resolved", {
            rowIndex: i,
            collectedCount: collectedIds.size,
          });
        } finally {
          unsub();
        }
      }

      // Capture the geo context from the final view the user sees.
      const rowGeo: RowGeo = lastView
        ? { lon: lastView.lon, lat: lastView.lat, zoom: lastView.zoom }
        : { lon: 0, lat: 0, zoom: MIN_BBOX_ZOOM };

      // Ensure rowGeos array is long enough; fill gaps with a zero placeholder
      // (pipeline always processes in order so gaps shouldn't occur).
      while (this.rowGeos.length < i) {
        this.rowGeos.push({ lon: 0, lat: 0, zoom: MIN_BBOX_ZOOM });
      }
      this.rowGeos[i] = rowGeo;

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
        this.store.validateRow(i, ids, startISO, endISO);
        continue;
      }

      try {
        logger.info("MatchingPipeline.runLoop: setting WME selection", {
          rowIndex: i,
          idsCount: ids.length,
          idsSample: ids.slice(0, 10),
        });
        this.wmeSDK.Editing.setSelection({
          selection: { ids, objectType: "segment" },
        });
        logger.info("MatchingPipeline.runLoop: WME selection set", {
          rowIndex: i,
          idsCount: ids.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`MatchingPipeline: setSelection failed for row ${i}: ${message}`);
        this.events.onError?.(message);
        // Continue — the user may still manually correct the selection before validating.
      }

      // Re-activate the userscript sidebar tab. After Editing.setSelection the
      // WME default behaviour is to open the segment edit panel, which hides
      // the userscript tab. Clicking the tab label element (returned by
      // Sidebar.registerScriptTab) is the only available way to switch back
      // since the SDK has no programmatic selectTab API.
      logger.info("MatchingPipeline.runLoop: clicking userscript tab label", {
        rowIndex: i,
      });
      this.tabLabel.click();
      logger.info("MatchingPipeline.runLoop: userscript tab label clicked", {
        rowIndex: i,
      });

      logger.info("MatchingPipeline.runLoop: waiting for user validation", {
        rowIndex: i,
        idsCount: ids.length,
      });

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

      if (action === "back") {
        const restartIndex = Math.max(0, i - 1);
        logger.info("MatchingPipeline.runLoop: rewinding to previous row", {
          rowIndex: i,
          restartIndex,
        });
        this.store.rewindToRow(restartIndex);
        this.rowGeos.length = restartIndex;
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
              return selection !== null && selection.objectType === "segment"
                ? (selection.ids as number[])
                : ids;
            })();

      const startISO = `${row.date}T${row.startTime}`;
      const endISO = `${row.date}T${row.endTime}`;
      logger.info("MatchingPipeline.runLoop: persisting validated row", {
        rowIndex: i,
        finalSegmentCount: finalSegmentIds.length,
        startISO,
        endISO,
      });
      this.store.validateRow(i, finalSegmentIds, startISO, endISO);
    }

    logger.info("MatchingPipeline.runLoop: completed all rows");
    this.events.onDone?.();
    this.running = false;
  }

  // ---------------------------------------------------------------------------
  // Private — bbox bisection (ported from the pre-Lot-2 MatchPanel.runBboxProcess)
  // ---------------------------------------------------------------------------

  /**
   * Recursively bisect the [kmA, kmB] portion until the map zoom is at least
   * MIN_BBOX_ZOOM (15) or MAX_BISECT_DEPTH (8) recursive levels are reached.
   *
   * Each leaf view navigates the map (zoomToExtent + waitForMapIdle) and
   * appends a { lon, lat, zoom } entry to `collector`.
   *
   * This mirrors the runBboxProcess bisect logic that existed before Lot 2
   * stripped it (see commit 4232030^ src/ui/MatchPanel.ts lines 533–740).
   */
  private async bisect(
    kmA: number,
    kmB: number,
    depth: number,
    collector: Array<{ lon: number; lat: number; zoom: ZoomLevel }>,
  ): Promise<void> {
    if (this.abortRequested) return;

    logger.info("MatchingPipeline.bisect: enter", {
      kmA,
      kmB,
      depth,
    });

    const sliced = sliceMultiLineByDistance(this.track.geometry, kmA, kmB);
    const box = bboxOfMultiLineString(sliced);

    if (!box) {
      logger.warn(`MatchingPipeline.bisect: empty bbox for [${kmA}, ${kmB}] — skipping`);
      return;
    }

    this.wmeSDK.Map.zoomToExtent({ bbox: box });
    logger.info("MatchingPipeline.bisect: zoomToExtent issued", {
      kmA,
      kmB,
      depth,
      box,
    });
    await waitForMapIdle(this.wmeSDK);
    logger.info("MatchingPipeline.bisect: map idle after zoomToExtent", {
      kmA,
      kmB,
      depth,
    });

    if (this.abortRequested) return;

    const zoom = this.wmeSDK.Map.getZoomLevel();
    const zoomSufficient = zoom >= MIN_BBOX_ZOOM;
    const depthCapped = depth >= MAX_BISECT_DEPTH;

    if (zoomSufficient || depthCapped) {
      if (depthCapped && !zoomSufficient) {
        logger.warn(
          `MatchingPipeline.bisect: depth cap at [${kmA}, ${kmB}] z${zoom} — accepting`,
        );
      }
      // Record this view's center from the bbox midpoint (same formula as
      // the original runBboxProcess implementation).
      const centerLon = (box[0] + box[2]) / 2;
      const centerLat = (box[1] + box[3]) / 2;
      collector.push({ lon: centerLon, lat: centerLat, zoom });
      logger.info("MatchingPipeline.bisect: accepted leaf view", {
        kmA,
        kmB,
        depth,
        zoom,
        centerLon,
        centerLat,
      });
      return;
    }

    // Zoom still too low — bisect into left and right halves
    const mid = (kmA + kmB) / 2;
    logger.info("MatchingPipeline.bisect: splitting", {
      kmA,
      kmB,
      depth,
      mid,
      zoom,
    });
    await this.bisect(kmA, mid, depth + 1, collector);
    if (this.abortRequested) return;
    await this.bisect(mid, kmB, depth + 1, collector);
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
}
