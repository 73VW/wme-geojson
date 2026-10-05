import type { WmeSDK, ZoomLevel } from "wme-sdk-typings";
import type { MultiLineString } from "geojson";
import type { NormalizedTrack } from "../../geojson/types";
import { i18next } from "../../../locales/i18n";
import { logger } from "../../utils/logger";
import { TrackLayer } from "../../layers/TrackLayer";
import { WalkController } from "../../controller/WalkController";
import type { LineRegistry } from "../../lines/LineRegistry";
import type { LineEntry } from "../../lines/types";
import type { SessionStore, SessionPhase } from "../../state/SessionStore";
import type { CsvRow } from "../../csv/types";
import { buildClosuresCsv } from "../../csv/buildClosuresCsv";
import type { ClosureRowGroup, FinalFields, RowGeo } from "../../csv/buildClosuresCsv";
import type { ClosureRange } from "../../csv/types";
import type { WzButtonProps } from "../components/wz";
import { parseSchedule } from "../../csv/parseSchedule";
import { promptFinalFields } from "../promptFinalFields";
import { alertDialog, confirmDialog } from "../components/wzDialog";
import { MatchingHeaderView } from "../views/MatchingHeaderView";
import { PlanningCsvView } from "../views/PlanningCsvView";
import { createRangeSlider } from "../views/RangeSliderView";
import { MatchingStepsView, type LinkedMte } from "../views/MatchingStepsView";
import { lineProgress } from "../../domain/lineProgress";
import {
  bboxOfMultiLineString,
  inflatedTrackPolygon,
  sliceMultiLineByDistance,
} from "../../matching/trackPortions";
import { initialPanelPosition, sidebarRightEdge } from "../panelPosition";
import { multiLineLengthKm } from "../../matching/trackPortions";
import { closureWindowDefaults, promptClosureWindow } from "../components/promptClosureWindow";
import { buildGlobalClosureRows } from "../../csv/syntheticSchedule";
import type { Source } from "../../domain/types";
import { SourceStore, attachPersistence } from "../../state/SourceStore";
import { SourcePersistence } from "../../domain/SourcePersistence";
import { buildSlowupSource } from "../../domain/buildSlowupSource";
import { buildGeojsonSource } from "../../domain/buildGeojsonSource";
import {
  LazyMatchingPipeline,
  type MapDriver,
  type MatchDriver,
} from "../../controller/LazyMatchingPipeline";
import { closuresFromSource, type GlobalClosureGroup } from "../../csv/closuresFromSource";
import { groupByWindow, roadbookRowIndex } from "../groupByWindow";
import { waitForMapIdle } from "../../utils/waitForMapIdle";
import { segmentPermalink } from "../../utils/segmentPermalink";
import { pollUntil } from "../../utils/pollUntil";
import { closureDateToMs, planClosureStops, type ClosureItem } from "../../csv/planClosureStops";
import {
  applyClosures,
  type ApplyReport,
  type ClosureDriver,
} from "../../controller/ClosureApplier";
import { openMtePreparePopup, type MtePreparePopupDeps } from "../MtePreparePopup";
import { promptMteInfo } from "../promptMteInfo";
import {
  createMteSdk,
  fillMteForm,
  manualFormData,
  mteStore,
  pickName,
  slowupFormData,
  watchMteSaved,
  type MteKey,
} from "../../mte";
import { fetchSlowupFullDetails } from "../../lines/slowupClient";
import {
  controlsFor,
  reduceMatchingUi,
  statusKeyFor,
  type ButtonView,
  type MatchingUiEvent,
  type MatchingUiState,
} from "../matchingUiState";
import { StepReview, reviewControlsFor } from "../../controller/StepReview";
import { frontierStep, navigableSteps, sameStep, type StepRef } from "../../domain/steps";
import { StepNavView } from "../views/StepNavView";
import { PanelMenuView } from "../views/PanelMenuView";
import { instructionKey, navEnabled, navTarget, stepNavState } from "../matchingPanelText";
import { wzButton } from "../components/wz";

const TARGET_ZOOM = 16;

/**
 * Sidebar panel for the lazy sub-line matching pipeline.
 *
 * The active Source (a loaded GeoJSON file or a selected slowup) is owned by
 * SourceStore and persisted via SourcePersistence. Matching is driven one
 * sub-line at a time by LazyMatchingPipeline. This panel is presentation-only:
 * it reflects SourceStore state and delegates actions to the pipeline.
 *
 * DOM is created with createElement/textContent only — no innerHTML with
 * external data.
 */

/**
 * Pure helper: converts the raw segment-id list from the WME selection into
 * the argument for `LazyMatchingPipeline.validate()`.
 *
 * - Non-empty array → return it as-is (overrides the pipeline's pendingMatched).
 * - Empty array     → return `undefined` (lets the pipeline fall back to
 *   pendingMatched, which is what we want when nothing is selected).
 */
export function resolveValidationIds(selectionIds: number[]): number[] | undefined {
  return selectionIds.length > 0 ? selectionIds : undefined;
}

export class MatchingSubTab {
  private static readonly PANEL_POSITION_KEY = "wme-geojson.matchPanel.position";
  private static readonly PANEL_COLLAPSED_KEY = "wme-geojson.matchPanel.collapsed";

  private tabPane: HTMLElement | null = null;

  // Unsubscribe handles — cleaned up in unmount()
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeMapDataLoaded: (() => void) | null = null;
  private unsubscribeSelection: (() => void) | null = null;
  private unsubscribeSourceStore: (() => void) | null = null;

  // Controllers wired lazily by onSelectedLineChanged
  private controller: WalkController | null;
  private trackLayer: TrackLayer | null;

  // Shell-level content toggling driven by the selected line.
  private contentWrapperEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  private attachedLineId: string | null = null;

  // ── Row container elements (toggled by renderPhase) ─────────────────────
  private rangeSliderRow: HTMLElement | null = null;
  private guidedMatchingRow: HTMLElement | null = null;
  private applyClosuresStatusEl: HTMLElement | null = null;
  private applyingClosures = false;
  private planningCsv: PlanningCsvView | null = null;
  private stepsView: MatchingStepsView | null = null;
  private csvUploadRow: HTMLElement | null = null;

  private headerView: MatchingHeaderView | null = null;

  // ── New lazy-matching engine ────────────────────────────────────────────
  private readonly sourceStore = new SourceStore();
  /** Shared with the Lignes rows so their progress sees unflushed saves. */
  readonly persistence = new SourcePersistence();
  private detachPersistence: (() => void) | null = null;
  private lazyPipeline: LazyMatchingPipeline | null = null;
  private uiState: MatchingUiState = { kind: "idle" };
  private guidedRetryBtn: HTMLElement | null = null;

  // Guided sub-panel text elements
  private guidedRowHeaderEl: HTMLElement | null = null;
  private guidedSegmentCountEl: HTMLElement | null = null;
  private guidedInstructionEl: HTMLElement | null = null;
  private guidedLoaderEl: HTMLElement | null = null;
  private guidedLoaderTextEl: HTMLElement | null = null;
  private guidedStatusEl: HTMLElement | null = null;
  private guidedBodyEl: HTMLElement | null = null;
  private guidedManualActionsEl: HTMLElement | null = null;
  private guidedToggleBtn: HTMLElement | null = null;
  private guidedCloseBtn: HTMLElement | null = null;
  private guidedStartBtn: HTMLElement | null = null;
  private guidedValidateBtn: HTMLElement | null = null;
  private guidedSkipBtn: HTMLElement | null = null;
  private guidedRematchBtn: HTMLElement | null = null;
  private guidedDoneCloseBtn: HTMLElement | null = null;
  private rematchRunning = false;
  /** WME selection on the frontier when the operator stepped back into a review. */
  private frontierSelection: number[] | null = null;
  private review: StepReview | null = null;
  private stepNav: StepNavView | null = null;
  private panelMenu: PanelMenuView | null = null;
  private guidedSelectMatchedBtn: HTMLElement | null = null;
  private guidedReviewRematchBtn: HTMLElement | null = null;
  private guidedSaveBtn: HTMLElement | null = null;
  private guidedCancelBtn: HTMLElement | null = null;
  private unsubscribeSelectionChanged: (() => void) | null = null;
  private matchingPanelOpen = false;
  private guidedCollapsed = false;

  private guidedStartBurstBtn: HTMLElement | null = null;
  private guidedPauseBtn: HTMLElement | null = null;
  private guidedResumeBtn: HTMLElement | null = null;

  // Debug pane elements.
  private guidedMatchPaneEl: HTMLElement | null = null;
  private guidedDebugPaneEl: HTMLElement | null = null;
  private guidedDebugBodyEl: HTMLElement | null = null;
  private guidedDebugFeedbackEl: HTMLElement | null = null;
  private guidedActiveTab: "match" | "debug" = "match";

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly store: SessionStore,
    private readonly registry: LineRegistry,
    private readonly onBackToLines: () => void = () => {},
  ) {
    this.controller = null;
    this.trackLayer = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  buildRoot(): HTMLElement {
    if (this.tabPane) return this.tabPane;

    const root = document.createElement("div");
    this.tabPane = root;
    root.classList.add("wmegj-panel-root");
    this.buildDOM(root);
    this.contentWrapperEl = root.lastElementChild as HTMLElement | null;

    this.review = new StepReview({
      store: this.sourceStore,
      map: {
        setMapCenter: (lon, lat, zoom) => this.buildMapDriver().setMapCenter(lon, lat, zoom),
        waitIdle: () => waitForMapIdle(this.wmeSDK, { settleDelayMs: 650 }),
        setSelection: (ids) => this.buildMapDriver().setSelection(ids),
        getSelection: () => this.readSelectionSegmentIds(),
      },
      match: { runMatchFor: (step) => this.runMatchFor(step) },
      // renderSourceState() also refreshes the controls.
      onChange: () => this.renderSourceState(),
    });
    try {
      this.unsubscribeSelectionChanged = this.wmeSDK.Events.on({
        eventName: "wme-selection-changed",
        eventHandler: () => this.review?.selectionChanged(this.readSelectionSegmentIds()),
      });
    } catch (err) {
      logger.warn("MatchingSubTab.buildRoot: failed to subscribe to wme-selection-changed", err);
    }

    this.emptyStateEl = document.createElement("p");
    this.emptyStateEl.className = "wmegj-section";
    this.emptyStateEl.textContent = i18next.t("panel.matching.noSelection");
    root.appendChild(this.emptyStateEl);

    if (this.guidedMatchingRow && this.guidedMatchingRow.parentElement !== document.body) {
      document.body.appendChild(this.guidedMatchingRow);
    }

    const eventsApi = (
      this.wmeSDK as unknown as {
        Events?: {
          on?: (args: { eventName: string; eventHandler: () => void }) => () => void;
        };
      }
    ).Events;
    try {
      this.unsubscribeMapDataLoaded =
        eventsApi?.on?.({
          eventName: "wme-map-data-loaded",
          eventHandler: () => {},
        }) ?? null;
    } catch (err) {
      logger.warn("MatchingSubTab.buildRoot: failed to subscribe to wme-map-data-loaded", err);
    }

    // Re-render visibility whenever store phase changes
    this.unsubscribeStore = this.store.subscribe((state) => {
      this.renderPhase(state.phase);
      this.renderHeaderSummary();
    });

    // Header / overlay / segment-count updates are driven by the SourceStore.
    this.unsubscribeSourceStore = this.sourceStore.onChange(() => {
      this.renderHeaderSummary();
      this.renderSourceState();
      this.updateClosureButtons();
    });

    this.renderPhase(this.store.getState().phase);

    this.unsubscribeSelection = this.registry.onSelectedLineChanged((entry) => {
      this.onSelectedLineChanged(entry);
    });
    this.onSelectedLineChanged(this.registry.getSelected());

    logger.info("MatchingSubTab built");
    return root;
  }

  private onSelectedLineChanged(entry: LineEntry | null): void {
    void this.onSelectedLineChangedAsync(entry);
  }

  private async onSelectedLineChangedAsync(entry: LineEntry | null): Promise<void> {
    const hasLine = entry !== null;
    if (this.contentWrapperEl) this.contentWrapperEl.style.display = hasLine ? "" : "none";
    if (this.emptyStateEl) this.emptyStateEl.style.display = hasLine ? "none" : "";
    this.renderSteps();
    this.updateClosureButtons();
    if (!entry) {
      this.attachedLineId = null;
      return;
    }

    // updateEntry() on the selected line re-fires onSelectedLineChanged for the
    // same line. Skip the full re-attach then.
    if (entry.id === this.attachedLineId) return;

    // Flush any pending persistence for the outgoing source.
    this.persistence.flush();

    this.attachedLineId = entry.id;
    this.review?.close();
    this.headerView?.setTitle(entry.displayName);
    this.matchingPanelOpen = false;

    try {
      this.controller?.stop();
    } catch (err) {
      logger.warn("MatchingSubTab.onSelectedLineChanged: controller.stop threw", err);
    }

    try {
      this.wmeSDK.Map.removeLayer({ layerName: TrackLayer.LAYER_NAME });
    } catch {
      // No previous layer is the common case.
    }

    // Build (or resume) the Source first so the preview and matcher use the
    // per-line geometry (slowup endpoint-merged chains / CSV slices) rather
    // than the raw, un-merged track.
    const existing = this.persistence.load(entry.id);
    const source = existing ?? this.buildSourceForEntry(entry);

    // Display geometry = the union of the source's line geometries. For a
    // slowup this collapses the ~10 raw fragments into the ~2 endpoint-merged
    // chains; for CSV it is the per-row slices; for a plain geojson line it is
    // the whole track.
    const displayGeometry: MultiLineString = {
      type: "MultiLineString",
      coordinates: source.lines.flatMap((line) => line.geometry.coordinates),
    };
    const displayTrack: NormalizedTrack = { ...entry.track, geometry: displayGeometry };

    const layer = new TrackLayer(this.wmeSDK);
    layer.draw(displayTrack, {
      colorMode:
        entry.slowupNumber !== undefined && displayGeometry.coordinates.length > 1
          ? "per-subline"
          : "single",
    });
    if (entry.csvRows?.length) {
      // Display geometry starts at the first roadbook distance (leading slice
      // dropped when it is > 0), so anchor label placement on that origin.
      layer.setVisibleDistances(
        entry.csvRows.map((r) => r.distance),
        entry.csvRows[0].distance,
      );
    }

    const controller = new WalkController(this.wmeSDK, displayGeometry);
    this.setController(controller);
    this.setTrackLayer(layer);

    this.lazyPipeline = null;
    this.sourceStore.hydrate(source);
    this.dispatch({ type: "SOURCE_CHANGED" });
    this.detachPersistence?.();
    this.detachPersistence = attachPersistence(this.sourceStore, this.persistence);

    // Drive simple phase/length display off the legacy session store.
    this.store.setTrack(entry.id, multiLineLengthKm(entry.track.geometry));
    this.store.setPhase("csv-loaded");

    // CSV upload + Remove-CSV only for non-slowup geojson lines.
    const isGeojson = entry.slowupNumber === undefined;
    this.setRowVisible(this.csvUploadRow, isGeojson);
    this.setRemoveCsvVisible(isGeojson && (entry.csvRows?.length ?? 0) > 0);
    this.clearCsvError();

    this.resetGuidedSessionState({ closePanel: true });
    this.renderSourceState();
  }

  /** Build a fresh Source for the selected entry. */
  private buildSourceForEntry(entry: LineEntry): Source {
    if (entry.slowupNumber !== undefined) {
      return buildSlowupSource({ sourceId: entry.id, track: entry.track });
    }
    return buildGeojsonSource({
      sourceId: entry.id,
      track: entry.track,
      csvRows: entry.csvRows,
      onWarning: (message) => this.reportCsvWarning(message),
    });
  }

  /** Surface a non-fatal CSV warning (e.g. a skipped degenerate row). */
  private reportCsvWarning(message: string): void {
    logger.warn("MatchingSubTab: CSV warning", message);
    const existing = this.planningCsv?.errorText();
    this.showCsvError(existing ? `${existing}\n${message}` : message);
  }

  setController(c: WalkController): void {
    this.controller?.dispose();
    this.controller = c;
  }

  setTrackLayer(layer: TrackLayer): void {
    this.trackLayer = layer;
    if (this.rangeSliderRow) {
      while (this.rangeSliderRow.firstChild) {
        this.rangeSliderRow.removeChild(this.rangeSliderRow.firstChild);
      }
      this.rangeSliderRow.appendChild(this.buildRangeSlider());
    }
  }

  unmount(): void {
    this.uiState = { kind: "idle" };
    this.lazyPipeline = null;
    this.controller?.dispose();
    this.controller = null;
    this.persistence.flush();
    this.detachPersistence?.();
    this.detachPersistence = null;
    this.unsubscribeStore?.();
    this.unsubscribeMapDataLoaded?.();
    this.unsubscribeSelection?.();
    this.unsubscribeSourceStore?.();
    this.unsubscribeSelectionChanged?.();
    this.unsubscribeSelectionChanged = null;
    this.unsubscribeStore = null;
    this.unsubscribeMapDataLoaded = null;
    this.unsubscribeSelection = null;
    this.unsubscribeSourceStore = null;

    if (this.tabPane) {
      while (this.tabPane.firstChild) {
        this.tabPane.removeChild(this.tabPane.firstChild);
      }
      this.tabPane = null;
    }

    this.rangeSliderRow = null;
    this.attachedLineId = null;
    this.applyClosuresStatusEl = null;
    this.csvUploadRow = null;
    this.planningCsv = null;
    this.stepsView = null;
    this.headerView = null;
    const guidedMatchingRow = this.guidedMatchingRow;
    if (guidedMatchingRow?.parentElement) {
      guidedMatchingRow.parentElement.removeChild(guidedMatchingRow);
    }
    this.guidedRowHeaderEl = null;
    this.guidedSegmentCountEl = null;
    this.guidedInstructionEl = null;
    this.guidedLoaderEl = null;
    this.guidedLoaderTextEl = null;
    this.guidedStatusEl = null;
    this.guidedBodyEl = null;
    this.guidedManualActionsEl = null;
    this.guidedToggleBtn = null;
    this.guidedCloseBtn = null;
    this.guidedStartBtn = null;
    this.guidedValidateBtn = null;
    this.guidedSkipBtn = null;
    this.guidedRematchBtn = null;
    this.guidedDoneCloseBtn = null;
    this.review = null;
    this.stepNav = null;
    this.panelMenu?.close();
    this.panelMenu = null;
    this.guidedSelectMatchedBtn = null;
    this.guidedReviewRematchBtn = null;
    this.guidedSaveBtn = null;
    this.guidedCancelBtn = null;
    this.guidedStartBurstBtn = null;
    this.guidedPauseBtn = null;
    this.guidedResumeBtn = null;
    this.guidedRetryBtn = null;
    this.guidedMatchPaneEl = null;
    this.guidedDebugPaneEl = null;
    this.guidedDebugBodyEl = null;
    this.guidedDebugFeedbackEl = null;
    this.guidedMatchingRow = null;

    logger.info("MatchPanel unmounted");
  }

  // ---------------------------------------------------------------------------
  // Private — DOM construction
  // ---------------------------------------------------------------------------

  private buildDOM(container: HTMLElement): void {
    const wrapper = document.createElement("div");
    const body = document.createElement("div");
    body.className = "wmegj-matching-body";
    wrapper.appendChild(body);
    container.appendChild(wrapper);

    this.headerView = new MatchingHeaderView({ onBack: () => this.onBackToLines() });
    body.appendChild(this.headerView.root);

    this.csvUploadRow = this.buildCsvUploadRow();
    body.appendChild(this.csvUploadRow);

    this.rangeSliderRow = document.createElement("section");
    this.rangeSliderRow.appendChild(this.buildRangeSlider());
    body.appendChild(this.rangeSliderRow);

    this.guidedMatchingRow = this.buildGuidedMatchingRow();

    this.stepsView = new MatchingStepsView({
      onOpenMatching: () => this.openMatchingPanel(),
      onPrepareMte: () => void this.openMtePopup(),
      onApply: () => void this.onApplyClosuresClick(),
      onDownloadCsv: () => this.onDownloadClosuresClick(),
    });
    this.applyClosuresStatusEl = this.stepsView.applyStatusEl;
    body.appendChild(this.stepsView.root);
  }

  // ---------------------------------------------------------------------------
  // Private — CSV upload (geojson lines only; never for slowups)
  // ---------------------------------------------------------------------------

  private buildCsvUploadRow(): HTMLElement {
    this.planningCsv = new PlanningCsvView({
      onFile: (file) => this.onCsvFileSelected(file),
      onRemove: () => this.removeCsv(),
    });
    return this.planningCsv.root;
  }

  private setRemoveCsvVisible(visible: boolean): void {
    this.planningCsv?.setLoaded(visible);
  }

  private showCsvError(message: string): void {
    this.planningCsv?.showError(message);
  }

  private clearCsvError(): void {
    this.planningCsv?.clearError();
  }

  private showCsvLoading(): void {
    this.planningCsv?.setLoading(true);
  }

  private hideCsvLoading(): void {
    this.planningCsv?.setLoading(false);
  }

  private onCsvFileSelected(file: File): void {
    this.clearCsvError();
    this.showCsvLoading();
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== "string") {
        this.hideCsvLoading();
        return;
      }
      // Yield one frame so the browser paints the loading indicator before
      // the synchronous heavy computation in processCsvText begins.
      setTimeout(() => {
        this.processCsvText(text);
        this.hideCsvLoading();
      }, 0);
    };
    reader.onerror = () => {
      this.hideCsvLoading();
      const message =
        reader.error instanceof DOMException
          ? reader.error.message
          : i18next.t("panel.csvInput.error");
      this.showCsvError(message);
    };
    reader.readAsText(file);
  }

  /**
   * Parse the uploaded CSV and rebuild the Source with the CSV-derived
   * time windows. Slowup lines are excluded at the call site (the row is
   * hidden for them), so this always rebuilds via buildGeojsonSource.
   */
  private processCsvText(text: string): void {
    const entry = this.registry.getSelected();
    if (!entry || entry.slowupNumber !== undefined) return;
    let rows: CsvRow[];
    try {
      rows = parseSchedule(text);
    } catch (err) {
      logger.error("MatchingSubTab.processCsvText: parseSchedule failed", err);
      this.showCsvError(i18next.t("panel.csvInput.error"));
      return;
    }

    this.registry.updateEntry(entry.id, {
      mode: "csv",
      csvRows: rows,
      csvText: text,
    });

    this.rebuildSourceWithCsv(entry.id, entry.track, rows);
    this.setRemoveCsvVisible(true);
  }

  /** Drop the imported CSV and rebuild the Source without time windows. */
  private removeCsv(): void {
    const entry = this.registry.getSelected();
    if (!entry || entry.slowupNumber !== undefined) return;
    this.clearCsvError();
    this.registry.updateEntry(entry.id, {
      mode: "synthetic",
      csvRows: undefined,
      csvText: undefined,
    });
    this.rebuildSourceWithCsv(entry.id, entry.track, undefined);
    this.setRemoveCsvVisible(false);
  }

  /** Rebuild + hydrate + persist a geojson Source, resetting matching state. */
  private rebuildSourceWithCsv(
    sourceId: string,
    track: LineEntry["track"],
    csvRows: CsvRow[] | undefined,
  ): void {
    this.persistence.clear(sourceId);
    this.lazyPipeline = null;
    this.review?.close();
    const source = buildGeojsonSource({
      sourceId,
      track,
      csvRows,
      onWarning: (message) => this.reportCsvWarning(message),
    });
    this.sourceStore.hydrate(source);

    // Recompute display geometry from the new source (union of CSV-sliced lines)
    // and redraw the track layer + range slider so they reflect the new geometry.
    const displayGeometry: MultiLineString = {
      type: "MultiLineString",
      coordinates: source.lines.flatMap((line) => line.geometry.coordinates),
    };
    const entry = this.registry.getSelected();
    if (entry && this.trackLayer) {
      try {
        this.wmeSDK.Map.removeLayer({ layerName: TrackLayer.LAYER_NAME });
      } catch {
        // layer may not exist yet
      }
      this.trackLayer.draw(
        { ...entry.track, geometry: displayGeometry },
        {
          colorMode:
            entry.slowupNumber !== undefined && displayGeometry.coordinates.length > 1
              ? "per-subline"
              : "single",
        },
      );
      if (csvRows?.length) {
        this.trackLayer.setVisibleDistances(
          csvRows.map((r) => r.distance),
          csvRows[0].distance,
        );
      }
      this.setTrackLayer(this.trackLayer);
    }

    this.dispatch({ type: "SOURCE_CHANGED" });
    this.store.setPhase("csv-loaded");
    this.resetGuidedSessionState({ closePanel: true });
    this.renderSourceState();
  }

  // ---------------------------------------------------------------------------
  // Private — resume banner
  // ---------------------------------------------------------------------------

  /**
   * Guided matching sub-panel — a floating overlay appended to document.body.
   */
  private buildGuidedMatchingRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section wmegj-guided-panel wmegj-guided-overlay";
    this.restoreGuidedPanelLayout();

    const chromeHeader = document.createElement("div");
    chromeHeader.className = "wmegj-guided-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "wmegj-guided-title-wrap";

    const titleEl = document.createElement("div");
    titleEl.className = "wmegj-guided-title";
    titleEl.textContent = i18next.t("panel.matching.panelTitle");
    titleWrap.appendChild(titleEl);

    const statusEl = document.createElement("div");
    statusEl.className = "wmegj-guided-status";
    statusEl.textContent = i18next.t("panel.matching.panelStatus.ready");
    titleWrap.appendChild(statusEl);
    this.guidedStatusEl = statusEl;

    chromeHeader.appendChild(titleWrap);

    const headerActions = document.createElement("div");
    headerActions.className = "wmegj-guided-header-actions";

    this.panelMenu = new PanelMenuView({ label: i18next.t("panel.matching.menu.more") });
    headerActions.appendChild(this.panelMenu.root);

    const toggleBtn = this.createGuidedIconButton({
      iconClass: this.guidedCollapsed ? "w-icon-collapse-up" : "w-icon-collapse",
      label: i18next.t("panel.matching.collapse"),
      onClick: () => {
        this.setGuidedCollapsed(!this.guidedCollapsed);
      },
    });
    headerActions.appendChild(toggleBtn);
    this.guidedToggleBtn = toggleBtn;

    const closeBtn = this.createGuidedIconButton({
      iconClass: "w-icon-x",
      label: i18next.t("panel.matching.close"),
      onClick: () => void this.closeMatchingPanel(),
    });
    headerActions.appendChild(closeBtn);
    this.guidedCloseBtn = closeBtn;

    chromeHeader.appendChild(headerActions);
    section.appendChild(chromeHeader);
    this.enableGuidedPanelDrag(section, chromeHeader);

    const bodyEl = document.createElement("div");
    bodyEl.className = "wmegj-guided-body";
    section.appendChild(bodyEl);
    this.guidedBodyEl = bodyEl;

    const matchPane = document.createElement("div");
    matchPane.className = "wmegj-guided-tabpane";
    bodyEl.appendChild(matchPane);
    this.guidedMatchPaneEl = matchPane;

    this.stepNav = new StepNavView({
      onPrev: () => void this.navigate(-1),
      onNext: () => void this.navigate(1),
      prevLabel: i18next.t("panel.matching.nav.prev"),
      nextLabel: i18next.t("panel.matching.nav.next"),
    });
    matchPane.appendChild(this.stepNav.root);

    const headerEl = document.createElement("p");
    headerEl.className = "wmegj-guided-row";
    headerEl.textContent = "—";
    matchPane.appendChild(headerEl);
    this.guidedRowHeaderEl = headerEl;

    const countEl = document.createElement("p");
    countEl.className = "wmegj-guided-count";
    countEl.textContent = i18next.t("panel.matching.segmentsMatched", { count: 0 });
    matchPane.appendChild(countEl);
    this.guidedSegmentCountEl = countEl;

    const instructionEl = document.createElement("p");
    instructionEl.className = "wmegj-guided-instruction";
    matchPane.appendChild(instructionEl);
    this.guidedInstructionEl = instructionEl;

    const loaderEl = document.createElement("div");
    loaderEl.className = "wmegj-guided-loader";
    loaderEl.style.display = "none";
    loaderEl.setAttribute("aria-live", "polite");

    const spinnerEl = document.createElement("span");
    spinnerEl.className = "wmegj-guided-spinner";
    spinnerEl.setAttribute("aria-hidden", "true");
    loaderEl.appendChild(spinnerEl);

    const loaderTextEl = document.createElement("span");
    loaderTextEl.textContent = i18next.t("panel.matching.matchingInProgress");
    loaderEl.appendChild(loaderTextEl);

    matchPane.appendChild(loaderEl);
    this.guidedLoaderEl = loaderEl;
    this.guidedLoaderTextEl = loaderTextEl;

    const matchActions = document.createElement("div");
    matchActions.className = "wmegj-guided-actions";
    this.guidedManualActionsEl = matchActions;
    matchPane.appendChild(matchActions);

    this.guidedStartBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.startManual"),
      variant: "primary",
      onClick: () => {
        void this.onStartMatchingClick();
      },
    });
    this.guidedStartBtn.classList.add("wmegj-guided-button--start");
    this.guidedStartBurstBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.startAutomatic"),
      variant: "secondary",
      onClick: () => {
        void this.onStartBurstClick();
      },
    });
    this.guidedStartBurstBtn.classList.add("wmegj-guided-button--start");
    this.guidedValidateBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.validate"),
      variant: "primary",
      onClick: () => {
        void this.onValidateClick();
      },
    });
    this.guidedValidateBtn.classList.add("wmegj-guided-button--validate");
    this.guidedSkipBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.skip"),
      variant: "secondary",
      onClick: () => {
        void this.onSkipMatchingClick();
      },
    });
    this.guidedSkipBtn.classList.add("wmegj-guided-button--skip");
    this.guidedPauseBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.pause"),
      variant: "secondary",
      onClick: () => {
        this.dispatch({ type: "PAUSE_REQUESTED" });
      },
    });
    this.guidedPauseBtn.classList.add("wmegj-guided-button--pause");
    this.guidedResumeBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.resume"),
      variant: "secondary",
      onClick: () => {
        void this.onResumeBurstClick();
      },
    });
    this.guidedResumeBtn.classList.add("wmegj-guided-button--resume");
    this.guidedRetryBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.retry"),
      variant: "primary",
      onClick: () => {
        void this.onRetryClick();
      },
    });
    this.guidedRetryBtn.classList.add("wmegj-guided-button--retry");
    this.guidedDoneCloseBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.closePanel"),
      variant: "primary",
      onClick: () => void this.closeMatchingPanel(),
    });
    this.guidedDoneCloseBtn.classList.add("wmegj-guided-button--done-close");
    this.guidedRematchBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.rematch"),
      variant: "secondary",
      onClick: () => {
        void this.onRematchClick();
      },
    });
    this.guidedRematchBtn.classList.add("wmegj-guided-button--rematch");

    this.guidedSelectMatchedBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.review.selectMatched"),
      variant: "primary",
      onClick: () => this.review?.selectMatched(),
    });
    this.guidedReviewRematchBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.rematch"),
      variant: "secondary",
      onClick: () => void this.review?.rematch(),
    });
    this.guidedSaveBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.review.save"),
      variant: "primary",
      onClick: () => this.review?.save(),
    });
    this.guidedCancelBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.review.cancel"),
      variant: "secondary",
      onClick: () => this.review?.cancel(),
    });

    // ── Debug pane ─────────────────────────────────────────────────────────
    const debugPane = document.createElement("div");
    debugPane.className = "wmegj-guided-tabpane";
    debugPane.style.display = "none";
    bodyEl.appendChild(debugPane);
    this.guidedDebugPaneEl = debugPane;
    debugPane.appendChild(
      wzButton({
        text: "← " + i18next.t("panel.matching.menu.backToMatching"),
        variant: "text",
        onClick: () => this.setGuidedActiveTab("match"),
      }),
    );

    const debugTitle = document.createElement("p");
    debugTitle.className = "wmegj-guided-debug-title";
    debugTitle.textContent = i18next.t("panel.matching.debugTitle");
    debugPane.appendChild(debugTitle);

    const debugBody = document.createElement("div");
    debugBody.className = "wmegj-guided-debug-body";
    debugPane.appendChild(debugBody);
    this.guidedDebugBodyEl = debugBody;

    const debugActions = document.createElement("div");
    debugActions.className = "wmegj-guided-actions";
    debugPane.appendChild(debugActions);
    this.appendGuidedButton(debugActions, {
      text: i18next.t("panel.matching.copyDebugJson"),
      variant: "secondary",
      onClick: () => {
        void this.onCopyDebugJsonClick();
      },
    });

    const debugFeedback = document.createElement("p");
    debugFeedback.className = "wmegj-guided-feedback";
    debugPane.appendChild(debugFeedback);
    this.guidedDebugFeedbackEl = debugFeedback;

    this.setGuidedCollapsed(this.guidedCollapsed);
    this.setGuidedActiveTab(this.guidedActiveTab);
    this.renderDebugPane();
    this.updateGuidedControls();

    return section;
  }

  private setGuidedActiveTab(tab: "match" | "debug"): void {
    this.guidedActiveTab = tab;
    if (this.guidedMatchPaneEl) {
      this.guidedMatchPaneEl.style.display = tab === "match" ? "" : "none";
    }
    if (this.guidedDebugPaneEl) {
      this.guidedDebugPaneEl.style.display = tab === "debug" ? "" : "none";
    }
    if (tab === "debug") this.renderDebugPane();
  }

  private appendGuidedButton(container: HTMLElement, props: WzButtonProps): HTMLElement {
    const button = this.createGuidedTextButton(props);
    container.appendChild(button);
    return button;
  }

  private createGuidedTextButton(props: WzButtonProps): HTMLButtonElement {
    const button = document.createElement("button");
    const variant = props.variant ?? "secondary";
    button.type = "button";
    button.className = `wmegj-button wmegj-button--${variant} wmegj-guided-button`;
    button.textContent = props.text;
    button.disabled = props.disabled ?? false;
    if (props.onClick) {
      button.addEventListener("click", props.onClick);
    }
    return button;
  }

  private createGuidedIconButton(props: {
    iconClass: string;
    label: string;
    onClick: () => void;
  }): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wmegj-guided-icon-button";
    button.setAttribute("aria-label", props.label);
    button.title = props.label;

    const icon = document.createElement("i");
    icon.className = `w-icon ${props.iconClass} w-icon-sm`;
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);

    button.addEventListener("click", props.onClick);
    return button;
  }

  private openMatchingPanel(): void {
    this.matchingPanelOpen = true;
    this.setGuidedCollapsed(false);
    this.setGuidedActiveTab("match");
    this.positionGuidedPanel();
    this.renderPhase(this.store.getState().phase);
  }

  private positionGuidedPanel(): void {
    const panel = this.guidedMatchingRow;
    if (!panel) return;
    let stored: { left: number; top: number } | null = null;
    try {
      const raw = localStorage.getItem(MatchingSubTab.PANEL_POSITION_KEY);
      const parsed = raw ? (JSON.parse(raw) as { left?: unknown; top?: unknown }) : null;
      if (parsed && typeof parsed.left === "number" && typeof parsed.top === "number") {
        stored = { left: parsed.left, top: parsed.top };
      }
    } catch {
      // Ignore malformed or unavailable persisted layout.
    }
    const position = initialPanelPosition({
      stored,
      sidebarRight: sidebarRightEdge(document, this.tabPane),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: { width: panel.offsetWidth || 360, height: panel.offsetHeight || 400 },
    });
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  private setGuidedCollapsed(collapsed: boolean): void {
    this.guidedCollapsed = collapsed;
    try {
      localStorage.setItem(MatchingSubTab.PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Local storage can be blocked in some userscript contexts.
    }
    if (this.guidedBodyEl) {
      this.guidedBodyEl.style.display = collapsed ? "none" : "";
    }
    const toggleLabel = i18next.t(collapsed ? "panel.matching.expand" : "panel.matching.collapse");
    if (this.guidedToggleBtn) {
      this.guidedToggleBtn.setAttribute("aria-label", toggleLabel);
      this.guidedToggleBtn.title = toggleLabel;
      this.guidedToggleBtn.replaceChildren();
      const icon = document.createElement("i");
      icon.className = `w-icon ${collapsed ? "w-icon-collapse-up" : "w-icon-collapse"} w-icon-sm`;
      icon.setAttribute("aria-hidden", "true");
      this.guidedToggleBtn.appendChild(icon);
    }
  }

  private restoreGuidedPanelLayout(): void {
    try {
      this.guidedCollapsed = localStorage.getItem(MatchingSubTab.PANEL_COLLAPSED_KEY) === "1";
    } catch {
      // Ignore malformed or unavailable persisted layout.
    }
  }

  private enableGuidedPanelDrag(panel: HTMLElement, handle: HTMLElement): void {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - offsetX));
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, event.clientY - offsetY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };

    const onUp = (): void => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture?.(Number(handle.dataset.wmegjPointerId ?? 0));
      try {
        localStorage.setItem(
          MatchingSubTab.PANEL_POSITION_KEY,
          JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }),
        );
      } catch {
        // Ignore storage failures.
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    handle.addEventListener("pointerdown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button,wz-button")) return;
      dragging = true;
      handle.dataset.wmegjPointerId = String(event.pointerId);
      handle.setPointerCapture?.(event.pointerId);
      const rect = panel.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  private setGuidedLoading(isLoading: boolean, message?: string): void {
    if (!this.guidedLoaderEl) return;
    if (message && this.guidedLoaderTextEl) {
      this.guidedLoaderTextEl.textContent = message;
    }
    this.guidedLoaderEl.style.display = isLoading ? "flex" : "none";
  }

  private async closeMatchingPanel(): Promise<void> {
    if (this.review?.state?.busy || this.rematchRunning) return;
    if (!(await this.confirmDiscardReview())) return;
    this.leaveReview();
    const wasDone = this.uiState.kind === "done";
    this.dispatch({ type: "CLOSE_DONE" });
    this.matchingPanelOpen = false;
    if (wasDone) {
      this.store.setPhase("csv-loaded");
    }
    this.renderPhase(this.store.getState().phase);
  }

  private resetGuidedSessionState(options: { closePanel?: boolean } = {}): void {
    // Direct write (not dispatch) because this resets all derived UI too via the callers.
    this.uiState = { kind: "idle" };
    this.frontierSelection = null;
    if (options.closePanel) {
      this.matchingPanelOpen = false;
    }
    this.trackLayer?.setHighlightedSlice(null);
    this.setGuidedLoading(false);

    if (this.guidedRowHeaderEl) {
      this.guidedRowHeaderEl.textContent = "—";
    }
    if (this.guidedSegmentCountEl) {
      this.guidedSegmentCountEl.textContent = i18next.t("panel.matching.segmentsMatched", {
        count: 0,
      });
    }
    if (this.guidedManualActionsEl) {
      this.guidedManualActionsEl.style.display = "flex";
    }
    this.updateGuidedControls();
  }

  // ---------------------------------------------------------------------------
  // Private — guided control wiring (lazy pipeline)
  // ---------------------------------------------------------------------------

  private buildMapDriver(): MapDriver {
    return {
      zoomToExtent: (bbox) => {
        this.wmeSDK.Map.zoomToExtent({ bbox });
      },
      setMapCenter: (lon, lat, zoom) => {
        this.wmeSDK.Map.setMapCenter({ lonLat: { lon, lat }, zoomLevel: zoom as ZoomLevel });
      },
      getZoomLevel: () => this.wmeSDK.Map.getZoomLevel(),
      setSelection: (segmentIds) => {
        try {
          this.wmeSDK.Editing.setSelection({
            selection: { ids: segmentIds, objectType: "segment" },
          });
        } catch (err) {
          logger.warn("MatchingSubTab.MapDriver.setSelection failed", err);
        }
      },
      waitIdle: () => waitForMapIdle(this.wmeSDK, { settleDelayMs: 650 }),
    };
  }

  private buildMatchDriver(): MatchDriver {
    return {
      runMatch: async () => {
        const cursor = this.sourceStore.getSource()?.cursor;
        return cursor ? this.runMatchFor(cursor) : [];
      },
    };
  }

  /**
   * Match one sub-line in the current viewport. Does not center the map: the
   * pipeline centers before runMatch, and StepReview.open() before a re-match.
   */
  private async runMatchFor(step: StepRef): Promise<number[]> {
    const controller = this.controller;
    const src = this.sourceStore.getSource();
    if (!controller || !src) return [];
    const line = src.lines[step.lineIndex];
    const sub = line?.subLines[step.subLineIndex];
    if (!line || !sub) return [];

    // sub.kmA/kmB are relative to THIS line's (merged) geometry, so rescope
    // the controller to it before matching — otherwise the km-range would
    // be applied to the whole raw track and slice the wrong portion.
    controller.setTrack(line.geometry);

    const set = new Set<number>();
    const unsubscribe = controller.onMatchFound((id) => set.add(id));
    try {
      await controller.matchInCurrentViewport(sub.kmA, sub.kmB);
    } finally {
      unsubscribe();
    }
    return [...set];
  }

  private ensurePipeline(): LazyMatchingPipeline | null {
    if (this.lazyPipeline) return this.lazyPipeline;
    this.lazyPipeline = new LazyMatchingPipeline({
      store: this.sourceStore,
      map: this.buildMapDriver(),
      match: this.buildMatchDriver(),
      targetZoom: TARGET_ZOOM,
    });
    return this.lazyPipeline;
  }

  private async onStartMatchingClick(): Promise<void> {
    if (this.uiState.kind !== "idle" || this.rematchRunning) return;
    const pipeline = this.ensurePipeline();
    if (!pipeline) return;
    this.review?.close();
    this.openMatchingPanel();
    this.store.setPhase("matching");
    this.dispatch({ type: "START_INTERACTIVE" });
    await this.runStep(() => pipeline.stepUntilValidation());
  }

  /** Burst: auto-step + auto-validate until complete or paused. */
  private async onStartBurstClick(): Promise<void> {
    if (this.uiState.kind !== "idle" || this.rematchRunning) return;
    const pipeline = this.ensurePipeline();
    if (!pipeline) return;
    this.review?.close();
    this.openMatchingPanel();
    this.store.setPhase("matching");
    this.dispatch({ type: "START_BURST" });
    await this.runBurstLoop(pipeline);
  }

  /** Resume a paused burst run from the current cursor. */
  private async onResumeBurstClick(): Promise<void> {
    if (this.uiState.kind !== "paused" || this.rematchRunning) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    this.review?.close();
    this.store.setPhase("matching");
    this.dispatch({ type: "RESUME_BURST" });
    await this.runBurstLoop(pipeline);
  }

  /**
   * Step + auto-validate while the machine stays in `bursting`. Pause, error,
   * completion and source switches all leave that state, which exits the loop —
   * no boolean loop flags.
   */
  private async runBurstLoop(pipeline: LazyMatchingPipeline): Promise<void> {
    // Capture in a local on each iteration to avoid TypeScript's control-flow
    // narrowing locking the type to `{ kind: "bursting" }` inside the loop.
    while ((this.uiState as MatchingUiState).kind === "bursting") {
      await this.runStep(() => pipeline.stepUntilValidation());
      const afterStep = (this.uiState as MatchingUiState).kind;
      if (afterStep !== "bursting" && afterStep !== "pausePending") return;
      const src = this.sourceStore.getSource();
      const cursor = src?.cursor;
      const sub =
        cursor && src ? src.lines[cursor.lineIndex]?.subLines[cursor.subLineIndex] : undefined;
      if (!sub || sub.validated) {
        this.dispatch({ type: "STEP_FAILED", message: i18next.t("panel.matching.burstStalled") });
        return;
      }
      try {
        pipeline.validate();
      } catch (err) {
        logger.error("MatchingSubTab.runBurstLoop: validate failed", err);
        this.dispatch({
          type: "STEP_FAILED",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if ((this.uiState as MatchingUiState).kind === "pausePending") {
        this.dispatch({ type: "PAUSE_REACHED" });
        return;
      }
    }
  }

  private async onValidateClick(): Promise<void> {
    if (this.uiState.kind !== "waiting" || this.rematchRunning) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    this.review?.close();
    pipeline.validate(resolveValidationIds(this.readSelectionSegmentIds()));
    this.dispatch({ type: "STEP_STARTED" });
    await this.runStep(() => pipeline.stepUntilValidation());
  }

  private async onSkipMatchingClick(): Promise<void> {
    if (this.uiState.kind !== "waiting" || this.rematchRunning) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    this.review?.close();
    pipeline.validate([]);
    this.dispatch({ type: "STEP_STARTED" });
    await this.runStep(() => pipeline.stepUntilValidation());
  }

  private async onRematchClick(): Promise<void> {
    if (this.uiState.kind !== "waiting" || this.rematchRunning) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    this.review?.close();
    this.frontierSelection = null;
    this.rematchRunning = true;
    this.updateGuidedControls();
    this.setGuidedLoading(true, i18next.t("panel.matching.matchingInProgress"));
    try {
      await pipeline.rematchCurrent();
      this.renderSourceState();
    } catch (err) {
      logger.error("MatchingSubTab.onRematchClick: re-match failed", err);
      this.dispatch({
        type: "STEP_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.rematchRunning = false;
      this.setGuidedLoading(false);
      this.updateGuidedControls();
    }
  }

  /** The sub-line shown in the panel: the reviewed one, else the one being validated. */
  private currentStep(): StepRef | null {
    const reviewed = this.review?.state?.step;
    if (reviewed) return reviewed;
    return this.uiState.kind === "waiting" ? frontierStep(this.sourceStore.getSource()) : null;
  }

  private navSteps(): StepRef[] {
    return navigableSteps(this.sourceStore.getSource(), this.uiState.kind === "waiting");
  }

  private async navigate(direction: -1 | 1): Promise<void> {
    const reviewState = this.review?.state ?? null;
    if (!navEnabled(this.uiState.kind, reviewState, this.rematchRunning)) return;
    const target = navTarget(this.navSteps(), this.currentStep(), direction, this.exitAtEnd());
    if (!target || !(await this.confirmDiscardReview())) return;
    const frontier =
      this.uiState.kind === "waiting" ? frontierStep(this.sourceStore.getSource()) : null;
    if (target === "exit" || sameStep(target, frontier)) {
      this.leaveReview();
      return;
    }
    // Leaving the frontier for a review: keep its (possibly corrected) selection.
    if (frontier && !reviewState) this.frontierSelection = this.readSelectionSegmentIds();
    await this.review?.open(target);
  }

  /**
   * Close the review. While a sub-line waits for validation, go back to it and
   * restore the selection it had when the operator left it (their corrections),
   * else its pending match — never leave the reviewed step's segments selected.
   */
  private leaveReview(): void {
    const reviewing = this.review?.state != null;
    this.review?.close();
    const frontier =
      this.uiState.kind === "waiting" ? frontierStep(this.sourceStore.getSource()) : null;
    if (!reviewing || !frontier) return;
    const sub =
      this.sourceStore.getSource()?.lines[frontier.lineIndex]?.subLines[frontier.subLineIndex];
    const map = this.buildMapDriver();
    if (sub) map.setMapCenter(sub.view.lon, sub.view.lat, sub.view.zoom);
    map.setSelection(this.frontierSelection ?? this.lazyPipeline?.getPendingMatched() ?? []);
    this.frontierSelection = null;
  }

  /** › past the last step closes a review when no frontier follows it. */
  private exitAtEnd(): boolean {
    return this.review?.state != null && this.uiState.kind !== "waiting";
  }

  /** true when there is nothing unsaved, or the operator chose to discard it. */
  private async confirmDiscardReview(): Promise<boolean> {
    if (!this.review?.state?.dirty) return true;
    const discard = await confirmDialog({
      title: i18next.t("panel.matching.review.discardTitle"),
      message: i18next.t("panel.matching.review.discardMessage"),
      confirmLabel: i18next.t("panel.matching.review.discard"),
      cancelLabel: i18next.t("panel.matching.review.stay"),
    });
    if (discard) this.review.cancel();
    return discard;
  }

  /** Run a pipeline step; outcome transitions (ready/failed/completed) go through dispatch. */
  private async runStep(step: () => Promise<void>): Promise<void> {
    this.frontierSelection = null;
    this.setGuidedLoading(true, i18next.t("panel.matching.matchingInProgress"));
    try {
      await step();
    } catch (err) {
      logger.error("MatchingSubTab.runStep: pipeline step failed", err);
      this.dispatch({
        type: "STEP_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    } finally {
      this.setGuidedLoading(false);
    }
    if (this.isSourceComplete()) {
      this.dispatch({
        type: "COMPLETED",
        rowsValidated: this.countValidatedSubLines(),
        totalSegments: this.countMatchedSegments(),
      });
      return;
    }
    this.renderSourceState();
    this.dispatch({ type: "STEP_READY" }); // no-op while bursting (no gate in burst mode)
  }

  /** Read the live WME segment selection. */
  private readSelectionSegmentIds(): number[] {
    try {
      const selection = this.wmeSDK.Editing.getSelection();
      if (selection && selection.objectType === "segment") {
        return selection.ids as number[];
      }
    } catch (err) {
      logger.warn("MatchingSubTab.readSelectionSegmentIds: getSelection failed", err);
    }
    return [];
  }

  /** Every line's every sub-line validated and no pendingTail left. */
  private isSourceComplete(): boolean {
    const src = this.sourceStore.getSource();
    if (!src || src.lines.length === 0) return false;
    return src.lines.every(
      (line) =>
        line.pendingTail.length === 0 &&
        line.subLines.length > 0 &&
        line.subLines.every((sub) => sub.validated),
    );
  }

  private countValidatedSubLines(): number {
    const src = this.sourceStore.getSource();
    if (!src) return 0;
    return src.lines.reduce(
      (sum, line) => sum + line.subLines.filter((s) => s.validated).length,
      0,
    );
  }

  private countMatchedSegments(): number {
    const src = this.sourceStore.getSource();
    if (!src) return 0;
    const ids = new Set<number>();
    for (const line of src.lines) {
      for (const sub of line.subLines) {
        if (sub.validated) sub.segmentIds.forEach((id) => ids.add(id));
      }
    }
    return ids.size;
  }

  private onRestartFromScratchClick(): void {
    confirmDialog({
      title: i18next.t("panel.dialogs.restartTitle"),
      message: i18next.t("panel.matching.restartConfirm"),
      confirmLabel: i18next.t("panel.matching.restartFromScratch"),
      cancelLabel: i18next.t("panel.finalFields.cancel"),
    })
      .then((confirmed) => {
        if (!confirmed) return;
        // Belt-and-braces: button is disabled in these states but guard anyway.
        if (
          this.uiState.kind === "stepping" ||
          this.uiState.kind === "bursting" ||
          this.uiState.kind === "pausePending"
        )
          return;
        const entry = this.registry.getSelected();
        if (!entry) return;
        // Clear any stale errors before rebuild so they don't duplicate on restart.
        this.clearCsvError();
        this.showCsvLoading();
        // Defer heavy synchronous work so the loading indicator can render first.
        setTimeout(() => {
          try {
            this.persistence.clear(entry.id);
            this.lazyPipeline = null;
            this.review?.close();
            this.dispatch({ type: "RESTART" });
            const fresh = this.buildSourceForEntry(entry);
            this.sourceStore.hydrate(fresh);
            this.dispatch({ type: "SOURCE_CHANGED" });
            this.store.setPhase("csv-loaded");
            this.resetGuidedSessionState();
            this.renderSourceState();
          } finally {
            this.hideCsvLoading();
          }
        }, 0);
      })
      .catch((err: unknown) => {
        logger.error("MatchPanel: restart confirm modal rejected", err);
      });
  }

  private dispatch(event: MatchingUiEvent): void {
    const prev = this.uiState;
    const next = reduceMatchingUi(prev, event);
    if (next === prev) return;
    this.uiState = next;
    this.applyTransitionEffects(prev, next);
    this.updateGuidedControls();
  }

  /** Side effects owned by transitions — the single place set-state-then-act is ordered. */
  private applyTransitionEffects(prev: MatchingUiState, next: MatchingUiState): void {
    if (next.kind === "done" && prev.kind !== "done") {
      this.store.setPhase("done");
      if (this.guidedSegmentCountEl) {
        this.guidedSegmentCountEl.textContent = i18next.t("panel.matching.steps.completedSummary", {
          rowsValidated: next.rowsValidated,
          totalSegments: next.totalSegments,
        });
      }
      this.trackLayer?.setHighlightedSlice(null);
      // Review finding #6: return the operator to a clean map view.
      try {
        this.wmeSDK.Editing.setSelection({ selection: { ids: [], objectType: "segment" } });
      } catch (err) {
        logger.warn("MatchingSubTab: clearing selection on done failed", err);
      }
    }
  }

  private async onRetryClick(): Promise<void> {
    if (this.uiState.kind !== "error" || this.rematchRunning) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    this.review?.close();
    const mode = this.uiState.resumeMode;
    this.dispatch({ type: "RETRY" });
    if (mode === "burst") {
      await this.runBurstLoop(pipeline);
    } else {
      await this.runStep(() => pipeline.stepUntilValidation());
    }
  }

  private updateGuidedControls(): void {
    const src = this.sourceStore.getSource();
    const reviewState = this.review?.state ?? null;
    // A frontier re-match runs while uiState stays `waiting`: show it as stepping.
    const run = controlsFor(
      this.rematchRunning ? { kind: "stepping" } : this.uiState,
      src !== null,
    );
    const hidden: ButtonView = { visible: false, enabled: false };
    // While a validated sub-line is reviewed, its own controls replace the run controls.
    const c = reviewState
      ? {
          ...run,
          start: hidden,
          startBurst: hidden,
          validate: hidden,
          skip: hidden,
          rematch: hidden,
          resume: hidden,
          retry: hidden,
          doneClose: hidden,
        }
      : run;
    this.applyButtonView(this.guidedStartBtn, c.start);
    this.applyButtonView(this.guidedStartBurstBtn, c.startBurst);
    this.applyButtonView(this.guidedValidateBtn, c.validate);
    this.applyButtonView(this.guidedSkipBtn, c.skip);
    this.applyButtonView(this.guidedRematchBtn, c.rematch);
    this.applyButtonView(this.guidedPauseBtn, c.pause);
    this.applyButtonView(this.guidedResumeBtn, c.resume);
    this.applyButtonView(this.guidedRetryBtn, c.retry);
    this.applyButtonView(this.guidedDoneCloseBtn, c.doneClose);

    const r = reviewControlsFor(reviewState);
    this.applyButtonView(this.guidedSelectMatchedBtn, r.selectMatched);
    this.applyButtonView(this.guidedReviewRematchBtn, r.rematch);
    this.applyButtonView(this.guidedSaveBtn, r.save);
    this.applyButtonView(this.guidedCancelBtn, r.cancel);

    const steps = this.navSteps();
    if (this.stepNav && src) {
      this.stepNav.root.hidden = steps.length === 0;
      this.stepNav.setState(
        stepNavState(
          src,
          this.currentStep(),
          steps,
          navEnabled(this.uiState.kind, reviewState, this.rematchRunning),
          this.exitAtEnd(),
        ),
      );
    }

    if (this.guidedInstructionEl) {
      this.guidedInstructionEl.textContent =
        this.uiState.kind === "error" && !reviewState
          ? i18next.t("panel.matching.stepError", { message: this.uiState.message })
          : i18next.t(
              instructionKey({
                run: this.uiState.kind,
                review: reviewState,
                hasValidated: navigableSteps(src, false).length > 0,
              }),
            );
    }

    this.panelMenu?.setItems([
      {
        label: i18next.t("panel.matching.menu.debug"),
        onSelect: () => this.setGuidedActiveTab("debug"),
      },
      {
        label: i18next.t("panel.matching.copyDebugJson"),
        onSelect: () => void this.onCopyDebugJsonClick(),
      },
      {
        label: i18next.t("panel.matching.restartFromScratch"),
        onSelect: () => this.onRestartFromScratchClick(),
        danger: true,
        disabled: !(c.restart.visible && c.restart.enabled) || !!this.review?.state?.busy,
      },
    ]);

    if (this.guidedStatusEl) {
      this.guidedStatusEl.textContent = i18next.t(
        `panel.matching.panelStatus.${statusKeyFor(this.uiState)}`,
      );
    }
  }

  private applyButtonView(button: HTMLElement | null, view: ButtonView): void {
    this.setButtonVisible(button, view.visible);
    this.setButtonDisabled(button, !view.enabled);
  }

  private setButtonDisabled(button: HTMLElement | null, disabled: boolean): void {
    if (!button) return;
    if (disabled) {
      button.setAttribute("disabled", "");
    } else {
      button.removeAttribute("disabled");
    }
    (button as unknown as { disabled?: boolean }).disabled = disabled;
  }

  private setButtonVisible(button: HTMLElement | null, visible: boolean): void {
    if (!button) return;
    button.style.display = visible ? "" : "none";
  }

  // ---------------------------------------------------------------------------
  // Private — SourceStore-driven view updates (header / overlay / counts)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Private — debug tab
  // ---------------------------------------------------------------------------

  /** Render the current Source into the debug pane as plain text. */
  private renderDebugPane(): void {
    const body = this.guidedDebugBodyEl;
    if (!body) return;
    body.replaceChildren();

    const src = this.sourceStore.getSource();
    if (!src) {
      const p = document.createElement("p");
      p.className = "wmegj-guided-meta";
      p.textContent = "—";
      body.appendChild(p);
      return;
    }

    const cursorEl = document.createElement("p");
    cursorEl.className = "wmegj-guided-meta";
    cursorEl.textContent = src.cursor
      ? i18next.t("panel.matching.debugCursor", {
          line: src.cursor.lineIndex + 1,
          subLine: src.cursor.subLineIndex + 1,
        })
      : i18next.t("panel.matching.debugCursorNone");
    body.appendChild(cursorEl);

    src.lines.forEach((line, li) => {
      const lineEl = document.createElement("p");
      lineEl.className = "wmegj-guided-row";
      let lineText = i18next.t("panel.matching.debugLineItem", {
        index: li + 1,
        total: src.lines.length,
        kmA: "0.0",
        kmB: line.lengthKm.toFixed(1),
      });
      if (line.startISO && line.endISO) {
        lineText +=
          " — " +
          i18next.t("panel.matching.debugLineWindow", {
            startTime: line.startISO.slice(11, 16),
            endTime: line.endISO.slice(11, 16),
          });
      }
      lineEl.textContent = lineText;
      body.appendChild(lineEl);

      const list = document.createElement("ul");
      list.className = "wmegj-guided-steps";
      line.subLines.forEach((sub) => {
        const item = document.createElement("li");
        item.textContent = i18next.t("panel.matching.debugSubLineItem", {
          index: sub.index,
          kmA: sub.kmA.toFixed(2),
          kmB: sub.kmB.toFixed(2),
          zoom: sub.view.zoom,
          validated: i18next.t(
            sub.validated ? "panel.matching.debugValidated" : "panel.matching.debugUnvalidated",
          ),
          count: sub.segmentIds.length,
        });
        list.appendChild(item);
      });
      body.appendChild(list);
    });
  }

  /** Copy the current Source JSON to the clipboard. */
  private async onCopyDebugJsonClick(): Promise<void> {
    const src = this.sourceStore.getSource();
    if (!src) {
      this.setDebugFeedback(i18next.t("panel.matching.copyDebugJsonUnavailable"));
      return;
    }
    const json = JSON.stringify(src, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.setDebugFeedback(i18next.t("panel.matching.copyDebugJsonSourceOk"));
    } catch (err) {
      logger.error("MatchingSubTab.onCopyDebugJsonClick: clipboard write failed", err);
      this.setDebugFeedback(i18next.t("panel.matching.copyDebugJsonError"));
    }
  }

  private setDebugFeedback(message: string): void {
    if (this.guidedDebugFeedbackEl) {
      this.guidedDebugFeedbackEl.textContent = message;
    }
  }

  private renderSourceState(): void {
    // Controls first: the nav bar and instruction follow every source change.
    this.updateGuidedControls();
    if (this.guidedActiveTab === "debug") this.renderDebugPane();
    const src = this.sourceStore.getSource();
    if (!src) {
      this.trackLayer?.setHighlightedSlice(null);
      return;
    }
    const cursor = this.currentStep() ?? src.cursor;
    if (!cursor) {
      this.trackLayer?.setHighlightedSlice(null);
      if (this.guidedRowHeaderEl) this.guidedRowHeaderEl.textContent = "—";
      return;
    }

    const line = src.lines[cursor.lineIndex];
    if (!line) return;
    const sub = line.subLines[cursor.subLineIndex];

    // Header text — no chaîne suffix.
    if (this.guidedRowHeaderEl) {
      this.guidedRowHeaderEl.textContent = this.formatHeader(
        src,
        cursor.lineIndex,
        cursor.subLineIndex,
      );
    }

    // Segment count for the current sub-line. Before validation the matched
    // ids live on the pipeline (pendingMatched) — sub.segmentIds is only filled
    // on validate — so prefer the pending count while the gate is open.
    if (this.guidedSegmentCountEl && sub) {
      const count = sub.validated
        ? sub.segmentIds.length
        : (this.lazyPipeline?.getPendingMatched().length ?? sub.segmentIds.length);
      this.guidedSegmentCountEl.textContent = i18next.t("panel.matching.segmentsMatched", {
        count,
      });
    }

    // Sub-line overlay highlights only the current sub-line geometry.
    if (sub) {
      this.trackLayer?.setHighlightedSlice(
        sliceMultiLineByDistance(line.geometry, sub.kmA, sub.kmB),
      );
    } else {
      this.trackLayer?.setHighlightedSlice(null);
    }
  }

  private formatHeader(src: Source, lineIndex: number, subLineIndex: number): string {
    const line = src.lines[lineIndex];
    const hasTime = Boolean(line.startISO && line.endISO);
    // A line with exactly one sub-line covering the whole line omits the suffix.
    const singleWholeSubLine =
      line.subLines.length === 1 &&
      line.pendingTail.length === 0 &&
      line.subLines[0].kmA <= 1e-9 &&
      Math.abs(line.subLines[0].kmB - line.lengthKm) < 1e-6;

    const base = {
      index: lineIndex + 1,
      total: src.lines.length,
      km: line.lengthKm.toFixed(1),
      startTime: line.startISO ? line.startISO.slice(11, 16) : "",
      endTime: line.endISO ? line.endISO.slice(11, 16) : "",
    };

    if (singleWholeSubLine) {
      return hasTime
        ? i18next.t("panel.matching.rowHeader", base)
        : i18next.t("panel.matching.rowHeaderNoTime", base);
    }

    const withSub = {
      ...base,
      subIndex: subLineIndex + 1,
      subTotal: line.subLines.length,
    };
    return hasTime
      ? i18next.t("panel.matching.rowHeaderWithSubLine", withSub)
      : i18next.t("panel.matching.rowHeaderWithSubLineNoTime", withSub);
  }

  private async openMtePopup(): Promise<void> {
    const entry = this.registry.getSelected();
    if (!entry) return;

    const slowupBbox = this.computeSlowupBbox(entry.track);
    if (!slowupBbox) return;

    const refid = entry.slowupDetails?.refid;
    const slowupPolygon = inflatedTrackPolygon(entry.track.geometry, 500);
    const mteKey = mteKeyOf(entry);

    const stored = mteStore.get(mteKey);
    if (
      stored &&
      !(await confirmDialog({
        title: i18next.t("panel.dialogs.mteLinkedTitle"),
        message: i18next.t("panel.matching.mteAlreadyLinked", { id: stored }),
        confirmLabel: i18next.t("panel.matching.mteCreateAnyway"),
        cancelLabel: i18next.t("panel.finalFields.cancel"),
      }))
    ) {
      return;
    }

    const info = await promptMteInfo({
      title: entry.displayName,
      userRank: this.wmeSDK.State.getUserInfo()?.rank ?? 0,
      askDetails: !refid,
    });
    if (!info) return;

    let source: MtePreparePopupDeps["source"];
    if (refid) source = { refid };
    else if (info.manual) source = { manual: info.manual };
    else return;

    // Remplit le formulaire WME ; l'ID est stocké quand l'utilisateur enregistre.
    try {
      const geometry = slowupPolygon?.geometry ?? null;
      const data =
        "refid" in source
          ? slowupFormData(await fetchSlowupFullDetails(source.refid), geometry, info.options)
          : manualFormData(source.manual, geometry, info.options);
      const draftId = await fillMteForm(this.wmeSDK, data);
      watchMteSaved(this.wmeSDK, draftId, (id) => {
        logger.info(`MTE enregistré : ${draftId} → ${id}`);
        mteStore.set(mteKey, id);
        this.renderSteps();
      });
      return;
    } catch (err) {
      // Transition : on garde le popup copier-coller en secours.
      logger.warn("Remplissage du formulaire MTE impossible, popup de secours", err);
    }

    await openMtePreparePopup({
      mteKey,
      source,
      slowupBbox,
      slowupPolygon,
      mteSdk: createMteSdk(this.wmeSDK),
    });
    this.renderSteps();
  }

  private computeSlowupBbox(track: NormalizedTrack): [number, number, number, number] | null {
    const bbox = bboxOfMultiLineString(track.geometry);
    if (!bbox) return null;
    const [minLon, minLat, maxLon, maxLat] = bbox;
    return [minLon, minLat, maxLon, maxLat];
  }

  // ---------------------------------------------------------------------------
  // Private — range slider
  // ---------------------------------------------------------------------------

  private buildRangeSlider(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";

    if (!this.trackLayer) {
      return section;
    }

    const totalKm = this.trackLayer.getTotalKm();
    if (totalKm <= 0) {
      return section;
    }

    // Slider values stay in display-geometry km (what setVisibleRange expects);
    // only the numbers shown to the operator add the roadbook origin, matching
    // the km labels on the map.
    const originKm = this.registry.getSelected()?.csvRows?.[0]?.distance ?? 0;

    let pendingFrame = 0;
    let pendingLo = 0;
    let pendingHi = totalKm;
    const layer = this.trackLayer;
    return createRangeSlider({
      totalKm,
      originKm,
      onChange: (lo, hi) => {
        pendingLo = lo;
        pendingHi = hi;
        // Redraw at most once per frame while dragging.
        if (pendingFrame !== 0) return;
        pendingFrame = requestAnimationFrame(() => {
          pendingFrame = 0;
          layer.setVisibleRange(pendingLo, pendingHi);
        });
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Private — phase-driven visibility
  // ---------------------------------------------------------------------------

  private renderPhase(phase: SessionPhase): void {
    const atLeastTrackLoaded = this.phaseGte(phase, "track-loaded");
    const atLeastCsvLoaded = this.phaseGte(phase, "csv-loaded");

    const entry = this.registry.getSelected();
    const isGeojson = entry !== null && entry.slowupNumber === undefined;

    this.setRowVisible(this.csvUploadRow, atLeastTrackLoaded && isGeojson);
    this.setRowVisible(this.rangeSliderRow, atLeastTrackLoaded);
    this.setRowVisible(this.stepsView?.root ?? null, atLeastCsvLoaded);
    this.setRowVisible(this.guidedMatchingRow, this.matchingPanelOpen && atLeastCsvLoaded);
    this.updateGuidedControls();
  }

  private readonly PHASE_ORDER: SessionPhase[] = [
    "no-track",
    "track-loaded",
    "csv-loaded",
    "matching",
    "done",
  ];

  private phaseGte(current: SessionPhase, threshold: SessionPhase): boolean {
    return this.PHASE_ORDER.indexOf(current) >= this.PHASE_ORDER.indexOf(threshold);
  }

  private setRowVisible(el: HTMLElement | null, visible: boolean): void {
    if (!el) return;
    el.style.display = visible ? "" : "none";
  }

  // ---------------------------------------------------------------------------
  // Private — export
  // ---------------------------------------------------------------------------

  private onDownloadClosuresClick(): void {
    const src = this.sourceStore.getSource();
    if (!src) {
      const message = i18next.t("panel.matching.noPipelineRun");
      logger.warn("MatchPanel: " + message);
      void alertDialog(message);
      return;
    }

    const closures = closuresFromSource(src);
    const hasAny =
      closures.mode === "global-times"
        ? closures.groups.some((group) => group.segmentIds.length > 0)
        : closures.bySegment.length > 0;
    if (!hasAny) {
      const message = i18next.t("panel.matching.mustValidateFirst");
      logger.warn("MatchPanel: " + message);
      void alertDialog(message);
      return;
    }

    if (closures.mode === "global-times") {
      void this.downloadClosuresGlobalTimes(closures.groups);
      return;
    }
    void this.downloadClosuresPerLine(closures.bySegment);
  }

  /** No CSV — collect one or more global windows, each applied to all segments. */
  private async downloadClosuresGlobalTimes(groupsBySubLine: GlobalClosureGroup[]): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const slowupDate = this.registry.getSelected()?.slowupDetails?.date;
    const windows = await promptClosureWindow({
      date: slowupDate ?? today,
      startTime: "09:00",
      endTime: "17:30",
    });
    if (!windows) return;

    const fields = await promptFinalFields({
      mteKey: mteKeyOf(this.registry.getSelected()),
    });
    if (!fields) return;

    const { rows, groups, closuresBySegment } = buildGlobalClosureRows(windows, groupsBySubLine);
    this.emitClosuresCsv(rows, groups, closuresBySegment, fields);
  }

  /** CSV-derived per-line windows — no global window popup. */
  private async downloadClosuresPerLine(
    bySegment: ReadonlyArray<{
      segmentId: number;
      windows: { startISO: string; endISO: string; geo: RowGeo }[];
    }>,
  ): Promise<void> {
    const fields = await promptFinalFields({
      mteKey: mteKeyOf(this.registry.getSelected()),
    });
    if (!fields) return;

    // Reference the real roadbook rows so the exported comments carry the
    // true line number / distance, and so the export sorts in roadbook order.
    const roadbookRows = this.registry.getSelected()?.csvRows ?? [];
    const groups: ClosureRowGroup[] = [];
    const closuresBySegment: Record<number, ClosureRange[]> = {};

    const windowGroups = groupByWindow(bySegment);
    windowGroups.forEach(({ startISO, endISO, geo, segmentIds }) => {
      const rowIndex = roadbookRowIndex(startISO, roadbookRows);
      groups.push({ rowIndex, segmentIds, geo });
      for (const id of segmentIds) {
        const existing = closuresBySegment[id] ?? [];
        existing.push({ startISO, endISO, rowIndex });
        closuresBySegment[id] = existing;
      }
    });

    this.emitClosuresCsv(roadbookRows, groups, closuresBySegment, fields);
  }

  private emitClosuresCsv(
    rows: CsvRow[],
    groups: ClosureRowGroup[],
    closuresBySegment: Record<number, ClosureRange[]>,
    fields: FinalFields,
  ): void {
    try {
      const csv = buildClosuresCsv(rows, groups, closuresBySegment, fields);
      const slug = slugifyFilename(this.registry.getSelected()?.displayName);
      const filename = `${slug || "closures"}.csv`;
      this.triggerDownload(csv, filename, "text/csv");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("MatchingSubTab: buildClosuresCsv failed", err);
      void alertDialog(message);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — apply closures directly in WME
  // ---------------------------------------------------------------------------

  /** Linked MTE for the steps view: name when WME has it loaded, never the raw id. */
  private linkedMteOf(entry: LineEntry | null): LinkedMte {
    const mteId = entry ? mteStore.get(mteKeyOf(entry)) : undefined;
    if (!mteId) return null;
    const mte = this.wmeSDK.DataModel.MajorTrafficEvents.getById({ majorTrafficEventId: mteId });
    const name = mte ? pickName(mte.names) : "";
    return { name: name || null };
  }

  private renderSteps(): void {
    const entry = this.registry.getSelected();
    const source = this.sourceStore.getSource();
    const matching = lineProgress(source);
    const cursor = source?.cursor ?? null;
    const resumeAt =
      matching.kind === "inProgress" && cursor !== null
        ? { line: cursor.lineIndex + 1, subLine: cursor.subLineIndex + 1 }
        : null;
    this.stepsView?.setState({
      matching,
      resumeAt,
      linkedMte: this.linkedMteOf(entry),
      canPrepareMte: entry !== null,
      applying: this.applyingClosures,
    });
  }

  private updateClosureButtons(): void {
    this.renderSteps();
  }

  /** Closure items for the current source, or null if the user cancelled. */
  private async collectClosureItems(): Promise<ClosureItem[] | null> {
    const src = this.sourceStore.getSource();
    if (!src) return null;
    const closures = closuresFromSource(src);

    if (closures.mode === "per-line-times") {
      return groupByWindow(closures.bySegment);
    }

    const entry = this.registry.getSelected();
    const today = new Date().toISOString().slice(0, 10);
    const mteId = entry ? mteStore.get(mteKeyOf(entry)) : undefined;
    const mte = mteId
      ? this.wmeSDK.DataModel.MajorTrafficEvents.getById({ majorTrafficEventId: mteId })
      : null;
    const windows = await promptClosureWindow(
      closureWindowDefaults(mte, {
        date: entry?.slowupDetails?.date ?? today,
        startTime: "09:00",
        endTime: "17:30",
      }),
      "apply",
    );
    if (!windows) return null;
    return windows.flatMap((window) =>
      closures.groups.map((group) => ({
        startISO: window.startISO,
        endISO: window.endISO,
        geo: group.geo,
        segmentIds: group.segmentIds,
      })),
    );
  }

  private async onApplyClosuresClick(): Promise<void> {
    if (this.applyingClosures) return;
    if (!this.wmeSDK.Editing.isEditingAllowed()) {
      void alertDialog(i18next.t("panel.applyClosuresNoEditing"));
      return;
    }
    const items = await this.collectClosureItems();
    if (!items) return;
    const fields = await promptFinalFields({
      mteKey: mteKeyOf(this.registry.getSelected()),
      mode: "apply",
    });
    if (!fields) return;
    this.renderSteps();
    if (fields.mteId && !(await this.ensureMteLoaded(fields.mteId))) return;

    this.applyingClosures = true;
    this.updateClosureButtons();
    try {
      const stops = planClosureStops(items);
      const report = await applyClosures(
        stops,
        {
          description: fields.reason,
          isPermanent: fields.ignoreTraffic,
          trafficEventId: fields.mteId || null,
        },
        this.buildClosureDriver(),
        (index, count) =>
          this.setApplyStatus(i18next.t("panel.applyClosuresProgress", { index, count })),
      );
      this.renderApplyReport(report);
    } catch (err) {
      logger.error("MatchingSubTab.onApplyClosuresClick failed", err);
      this.setApplyStatus(err instanceof Error ? err.message : String(err));
    } finally {
      this.applyingClosures = false;
      this.updateClosureButtons();
    }
  }

  /**
   * WME only loads MTEs into the data model once its Events tab has been
   * opened (SDK bug: https://issuetracker.google.com/issues/533467151);
   * addClosure then fails for every segment. Check up front (3 tries,
   * 1 s apart) and let the user open the tab and retry.
   */
  private async ensureMteLoaded(mteId: string): Promise<boolean> {
    const mtes = this.wmeSDK.DataModel.MajorTrafficEvents;
    const isLoaded = () => mtes.getById({ majorTrafficEventId: mteId }) !== null;
    for (;;) {
      if (await pollUntil(isLoaded, MTE_LOAD_ATTEMPTS, MTE_LOAD_DELAY_MS)) return true;
      const retry = await confirmDialog({
        title: i18next.t("panel.dialogs.mteNotLoadedTitle"),
        message: i18next.t("panel.applyClosuresMteNotLoaded", { id: mteId }),
        confirmLabel: i18next.t("panel.applyClosuresMteRetry"),
        cancelLabel: i18next.t("panel.finalFields.cancel"),
      });
      if (!retry) return false;
    }
  }

  private buildClosureDriver(): ClosureDriver {
    const dm = this.wmeSDK.DataModel;
    return {
      setMapCenter: (lon, lat, zoom) =>
        this.wmeSDK.Map.setMapCenter({ lonLat: { lon, lat }, zoomLevel: zoom as ZoomLevel }),
      // Same settle delay as the matching walk: segments must be in the model.
      waitIdle: () => waitForMapIdle(this.wmeSDK, { settleDelayMs: 650 }),
      getSegment: (segmentId) => dm.Segments.getById({ segmentId }),
      getTrafficEventName: (id) => {
        const mte = dm.MajorTrafficEvents.getById({ majorTrafficEventId: id });
        return mte ? pickName(mte.names) : null;
      },
      hasClosure: ({ segmentId, isForward, startMs, endMs }) =>
        dm.RoadClosures.getAll().some(
          (closure) =>
            closure.segmentId === segmentId &&
            closure.isForward === isForward &&
            closureDateToMs(closure.startDate) === startMs &&
            closureDateToMs(closure.endDate) === endMs,
        ),
      addClosure: (closure) => {
        dm.RoadClosures.addClosure({
          segmentId: closure.segmentId,
          isForward: closure.isForward,
          startDate: closure.startMs,
          endDate: closure.endMs,
          description: closure.description,
          isPermanent: closure.isPermanent,
          trafficEventId: closure.trafficEventId,
          fromNodeClosed: false,
        });
      },
    };
  }

  private setApplyStatus(text: string): void {
    if (this.applyClosuresStatusEl) this.applyClosuresStatusEl.textContent = text;
  }

  /** Summary plus one permalink per failed segment (new tab: keeps this tab's unsaved closures). */
  private renderApplyReport(report: ApplyReport): void {
    const el = this.applyClosuresStatusEl;
    if (!el) return;
    el.textContent = i18next.t("panel.applyClosuresDone", {
      added: report.added,
      skipped: report.skipped,
    });
    if (report.failures.length === 0) return;
    logger.warn("MatchingSubTab: closure failures", report.failures);

    const bySegment = new Map(report.failures.map((failure) => [failure.segmentId, failure]));
    el.append("\n" + i18next.t("panel.applyClosuresFailures", { count: bySegment.size }));
    const list = document.createElement("ul");
    list.style.margin = "4px 0 0 0";
    list.style.paddingLeft = "16px";
    for (const { segmentId, reason, geo } of bySegment.values()) {
      const link = document.createElement("a");
      link.href = segmentPermalink(window.location.href, geo, segmentId);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = String(segmentId);
      const item = document.createElement("li");
      item.append(link, ` — ${reason}`);
      list.appendChild(item);
    }
    el.appendChild(list);
  }

  private triggerDownload(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Private — WalkController badge
  // ---------------------------------------------------------------------------

  /** Header line "30.85 km · 40 % validé", from the same Source as the Lignes rows. */
  private renderHeaderSummary(): void {
    this.headerView?.setSummary(
      this.store.getState().trackLengthKm,
      lineProgress(this.sourceStore.getSource()),
    );
  }
}

const MTE_LOAD_ATTEMPTS = 3;
const MTE_LOAD_DELAY_MS = 1000;

/** Slugify a track display name into a filesystem-safe filename stem.
 * Lowercases, strips diacritics, replaces non-alphanum runs with "-",
 * trims leading/trailing hyphens. Returns "" for empty/whitespace input. */
function slugifyFilename(name: string | undefined | null): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Clé mteStore : refid pour un slowup, id de la ligne pour une autre fermeture. */
function mteKeyOf(entry: LineEntry): MteKey;
function mteKeyOf(entry: LineEntry | null): MteKey | undefined;
function mteKeyOf(entry: LineEntry | null): MteKey | undefined {
  if (!entry) return undefined;
  return entry.slowupDetails?.refid ?? entry.id;
}
