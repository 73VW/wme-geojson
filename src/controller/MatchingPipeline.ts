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
import { computePortions, sliceMultiLineByDistance, bboxOfMultiLineString } from "../matching/trackPortions";
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
  private pendingValidator: (() => void) | null = null;

  // Resolve handle for abort while waiting for validate
  private pendingAbortReject: (() => void) | null = null;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly store: SessionStore,
    private readonly controller: WalkController,
    private readonly track: NormalizedTrack,
    private readonly trackLayer: TrackLayer,
    private readonly events: PipelineEvents,
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
    if (!this.pendingValidator) {
      logger.warn("MatchingPipeline.validateCurrentRow: no pending row, ignoring");
      return;
    }
    this.pendingValidator();
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

    if (csvRows.length === 0) {
      this.events.onError?.("No CSV rows loaded");
      this.running = false;
      return;
    }

    const distances = csvRows.map((r) => r.distance);
    const portions = computePortions(distances, totalKm);

    if (portions.length !== csvRows.length) {
      this.events.onError?.(
        `Portion count mismatch: ${portions.length} portions for ${csvRows.length} rows`,
      );
      this.running = false;
      return;
    }

    for (let i = currentIndex; i < csvRows.length; i++) {
      if (this.abortRequested) {
        logger.info("MatchingPipeline: aborted before row", i);
        this.events.onAborted?.();
        this.running = false;
        return;
      }

      this.events.onRowStarted?.(i, csvRows.length);

      const row = csvRows[i];
      const portion = portions[i];
      const collectedIds = new Set<number>();

      // --- Compute bbox view(s) via bisection and run matching per view -------

      const viewGeos: Array<{ lon: number; lat: number; zoom: ZoomLevel }> = [];
      await this.bisect(portion.kmA, portion.kmB, 0, viewGeos);

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

        // Navigate to the view
        this.wmeSDK.Map.zoomToExtent({ bbox: [view.lon, view.lat, view.lon, view.lat] });
        // Use setMapCenter instead since zoomToExtent already happened in bisect;
        // by this point bisect already navigated and we have center+zoom.
        // Actually bisect uses zoomToExtent to navigate — the view's lon/lat
        // here are the BBOX midpoints. Re-use them to re-navigate cleanly.
        this.wmeSDK.Map.setMapCenter({
          lonLat: { lon: view.lon, lat: view.lat },
          zoomLevel: view.zoom,
        });
        await waitForMapIdle(this.wmeSDK);

        if (this.abortRequested) break;

        // Subscribe to matchFound before calling matchInCurrentViewport so we
        // capture all results including the sync ones.
        const unsub = this.controller.onMatchFound((id) => {
          collectedIds.add(id);
        });

        try {
          await this.controller.matchInCurrentViewport(portion.kmA, portion.kmB);
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
      try {
        this.wmeSDK.Editing.setSelection({
          selection: { ids, objectType: "segment" },
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
      this.tabLabel.click();

      this.events.onRowMatched?.(i, ids);

      // --- Wait for user to click Validate -----------------------------------

      const validated = await this.waitForValidate();
      if (!validated) {
        // Abort was requested while waiting for the user
        this.events.onAborted?.();
        this.running = false;
        return;
      }

      // Read the CURRENT WME selection at validate time (not the auto-selected
      // ids from matching): the user may have corrected the selection manually.
      const selection = this.wmeSDK.Editing.getSelection();
      const finalSegmentIds =
        selection !== null && selection.objectType === "segment"
          ? (selection.ids as number[])
          : ids;

      const startISO = `${row.date}T${row.startTime}`;
      const endISO = `${row.date}T${row.endTime}`;
      this.store.validateRow(i, finalSegmentIds, startISO, endISO);
    }

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

    const sliced = sliceMultiLineByDistance(this.track.geometry, kmA, kmB);
    const box = bboxOfMultiLineString(sliced);

    if (!box) {
      logger.warn(`MatchingPipeline.bisect: empty bbox for [${kmA}, ${kmB}] — skipping`);
      return;
    }

    this.wmeSDK.Map.zoomToExtent({ bbox: box });
    await waitForMapIdle(this.wmeSDK);

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
      return;
    }

    // Zoom still too low — bisect into left and right halves
    const mid = (kmA + kmB) / 2;
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
  private waitForValidate(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingValidator = () => {
        this.pendingValidator = null;
        this.pendingAbortReject = null;
        resolve(true);
      };
      this.pendingAbortReject = () => {
        this.pendingValidator = null;
        this.pendingAbortReject = null;
        resolve(false);
      };
    });
  }
}
