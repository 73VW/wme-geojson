import type { WmeSDK } from "wme-sdk-typings";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { TrackLayer } from "../layers/TrackLayer";
import type { WalkController } from "../controller/WalkController";
import type { WalkState } from "../controller/walkStates";
import type { SessionStore, SessionPhase, SessionState, CsvRow } from "../state/SessionStore";
import { parseSchedule } from "../csv/parseSchedule";
import { serializeSchedule } from "../csv/serializeSchedule";
import { buildClosuresCsv } from "../csv/buildClosuresCsv";
import type { ClosureRowGroup, FinalFields } from "../csv/buildClosuresCsv";
import { wzButton, wzTextInput, fileInput, type WzButtonProps } from "./components/wz";
import { MatchingPipeline, type PipelineStepEvent } from "../controller/MatchingPipeline";
import { promptFinalFields } from "./promptFinalFields";
import { load as persistenceLoad, clearForCurrent } from "../persistence/sessionStorage";
import { confirmModal } from "./modal";
import { bboxOfMultiLineString, sliceMultiLineByDistance } from "../matching/trackPortions";
import { computeMatchingWorkItems } from "../matching/trackPortions";

/**
 * Sidebar panel for the CSV-driven closures pipeline.
 *
 * Presentation-only: no business logic. All state is owned by SessionStore and
 * reflected here via the store's subscription mechanism. The panel renders
 * phase-appropriate rows and delegates to loadAndAttachTrack / the pipeline
 * controller for any action that changes state.
 *
 * DOM is created with createElement/textContent only — no innerHTML with
 * external data.
 */
export class MatchPanel {
  private static readonly PANEL_POSITION_KEY = "wme-geojson.matchPanel.position";
  private static readonly PANEL_COLLAPSED_KEY = "wme-geojson.matchPanel.collapsed";

  private tabPane: HTMLElement | null = null;

  // Unsubscribe handles — cleaned up in unmount()
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;

  // Controllers wired lazily by loadAndAttachTrack after mount
  private controller: WalkController | null;
  private trackLayer: TrackLayer | null;

  // Injected by main.user.ts to avoid a circular module dependency:
  // loadAndAttachTrack imports MatchPanel, so MatchPanel cannot import it back.
  // main.user.ts imports both and passes the bound function via setLoadFn().
  private loadFn: ((url: string) => Promise<void>) | null = null;

  // ── Row container elements (toggled by renderPhase) ─────────────────────
  private urlRow: HTMLElement | null = null;
  private trackLengthRow: HTMLElement | null = null;
  private trackLengthValueEl: HTMLElement | null = null;
  private rangeSliderRow: HTMLElement | null = null;
  private csvUploadRow: HTMLElement | null = null;
  private csvLoadingEl: HTMLElement | null = null;
  private csvLoadingTextEl: HTMLElement | null = null;
  private startMatchingRow: HTMLElement | null = null;
  private guidedMatchingRow: HTMLElement | null = null;
  private downloadRow: HTMLElement | null = null;
  private resumeBannerRow: HTMLElement | null = null;

  // URL input — updated to show load error inline
  private urlInputEl: HTMLElement | null = null;
  private urlErrorEl: HTMLElement | null = null;

  // State badge driven by WalkController
  private badgeEl: HTMLElement | null = null;

  // Pending slider frame (rAF coalescing — see buildRangeSlider)
  private _onRangeChanged: (() => void) | null = null;

  // The tab label element returned by Sidebar.registerScriptTab().
  private tabLabel: HTMLElement | null = null;

  // Active pipeline instance (created on Start matching, cleared on done/abort)
  private pipeline: MatchingPipeline | null = null;

  // Cached CSV inputs — kept in memory so the "restart from scratch" path can
  // re-load the same rows without asking the user to re-upload the file.
  private lastCsvText: string | null = null;
  private lastCsvRows: CsvRow[] = [];

  // Guided sub-panel text elements updated by pipeline events
  private guidedRowHeaderEl: HTMLElement | null = null;
  private guidedSegmentCountEl: HTMLElement | null = null;
  private guidedInstructionEl: HTMLElement | null = null;
  private guidedLoaderEl: HTMLElement | null = null;
  private guidedLoaderTextEl: HTMLElement | null = null;
  private guidedStatusEl: HTMLElement | null = null;
  private guidedModeEl: HTMLElement | null = null;
  private guidedBodyEl: HTMLElement | null = null;
  private guidedTabMatchEl: HTMLElement | null = null;
  private guidedTabDebugEl: HTMLElement | null = null;
  private guidedMatchPaneEl: HTMLElement | null = null;
  private guidedDebugPaneEl: HTMLElement | null = null;
  private guidedManualActionsEl: HTMLElement | null = null;
  private guidedStepsListEl: HTMLElement | null = null;
  private guidedToggleBtn: HTMLElement | null = null;
  private guidedCloseBtn: HTMLElement | null = null;
  private guidedStartManualBtn: HTMLElement | null = null;
  private guidedStartBurstBtn: HTMLElement | null = null;
  private guidedValidateBtn: HTMLElement | null = null;
  private guidedSkipBtn: HTMLElement | null = null;
  private guidedBackBtn: HTMLElement | null = null;
  private guidedPauseBtn: HTMLElement | null = null;
  private guidedResumeBtn: HTMLElement | null = null;
  private guidedRestartBtn: HTMLElement | null = null;
  private guidedCopyDebugBtn: HTMLElement | null = null;
  private guidedDownloadEnrichedBtn: HTMLElement | null = null;
  private matchingMode: "interactive" | "burst" = "interactive";
  private matchingPanelOpen = false;
  private guidedCollapsed = false;
  private guidedActiveTab: "match" | "debug" = "match";
  private guidedBusy = false;
  private pendingManualRestartOffset: number | null = null;

  // Captured per-row debug context — populated on onRowStarted/onRowMatched
  // and consumed by the "Copy debug JSON" button.
  private currentRowIndex: number | null = null;
  private currentRowKmA: number | null = null;
  private currentRowKmB: number | null = null;
  private currentMatchedIds: number[] = [];
  private guidedDebugFeedbackEl: HTMLElement | null = null;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly store: SessionStore,
    initialController: WalkController | null,
    initialTrackLayer: TrackLayer | null,
  ) {
    this.controller = initialController;
    this.trackLayer = initialTrackLayer;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Register a sidebar tab, build the DOM, and subscribe to the store.
   * Safe to call only once; a second call is a no-op.
   */
  async mount(): Promise<void> {
    if (this.tabPane) return;

    let tabLabel: HTMLElement;
    let tabPane: HTMLElement;

    try {
      ({ tabLabel, tabPane } = await this.wmeSDK.Sidebar.registerScriptTab());
    } catch (err) {
      logger.error("MatchPanel.mount: failed to register sidebar tab", err);
      return;
    }

    tabLabel.textContent = "GeoJ";
    this.tabLabel = tabLabel;
    this.tabPane = tabPane;
    tabPane.classList.add("wmegj-panel-root");
    this.injectStyles(tabPane);
    this.buildDOM(tabPane);
    if (this.guidedMatchingRow && this.guidedMatchingRow.parentElement !== document.body) {
      document.body.appendChild(this.guidedMatchingRow);
    }

    // Re-render visibility whenever store phase changes
    this.unsubscribeStore = this.store.subscribe((state) => {
      this.renderPhase(state.phase);
      if (state.trackLengthKm !== null && this.trackLengthValueEl) {
        this.trackLengthValueEl.textContent = i18next.t("panel.trackLength", {
          km: state.trackLengthKm.toFixed(2),
        });
      }
    });

    this.renderPhase(this.store.getState().phase);

    logger.info("MatchPanel mounted");
  }

  /**
   * Attach the WalkController that was built by loadAndAttachTrack.
   * Wires the state badge subscription lazily so the badge works even when
   * no track was loaded at mount time.
   */
  setController(c: WalkController): void {
    this.controller = c;

    // Detach any previous subscription (e.g. a second loadAndAttachTrack call)
    this.unsubscribeState?.();

    this.unsubscribeState = c.onStateChange((s) => {
      this.updateBadge(s);
    });
    this.updateBadge(c.state);
  }

  /**
   * Attach the TrackLayer built by loadAndAttachTrack.
   * The range slider needs it to call setVisibleRange; we rebuild the slider
   * after attachment so it reads the correct totalKm.
   */
  setTrackLayer(layer: TrackLayer): void {
    this.trackLayer = layer;

    // Rebuild the range slider now that we have a layer with a known totalKm.
    if (this.rangeSliderRow) {
      while (this.rangeSliderRow.firstChild) {
        this.rangeSliderRow.removeChild(this.rangeSliderRow.firstChild);
      }
      this.rangeSliderRow.appendChild(this.buildRangeSlider());
    }
  }

  /**
   * Inject the loadAndAttachTrack function. Must be called from main.user.ts
   * before the user can click "Load" — the setter breaks the circular import
   * that would arise if MatchPanel imported loadAndAttachTrack directly
   * (loadAndAttachTrack imports MatchPanel for the panel parameter type).
   */
  setLoadFn(fn: (url: string) => Promise<void>): void {
    this.loadFn = fn;
  }

  /** Return the tab label element registered with WME's sidebar. */
  getTabLabel(): HTMLElement | null {
    return this.tabLabel;
  }

  /**
   * Surface a load error in the URL row (red message below the input).
   * Called by loadAndAttachTrack when loadTrack throws.
   */
  showLoadError(message: string): void {
    if (!this.urlErrorEl) return;
    this.urlErrorEl.textContent = message;
    this.urlErrorEl.style.display = "";
  }

  /**
   * Remove all DOM content and unsubscribe everything.
   */
  unmount(): void {
    this.unsubscribeStore?.();
    this.unsubscribeState?.();
    this.unsubscribeStore = null;
    this.unsubscribeState = null;

    if (this.tabPane) {
      while (this.tabPane.firstChild) {
        this.tabPane.removeChild(this.tabPane.firstChild);
      }
      this.tabPane = null;
    }

    this.urlRow = null;
    this.trackLengthRow = null;
    this.rangeSliderRow = null;
    this.csvUploadRow = null;
    this.csvLoadingEl = null;
    this.csvLoadingTextEl = null;
    this.startMatchingRow = null;
    this.downloadRow = null;
    this.resumeBannerRow = null;
    this.urlInputEl = null;
    this.urlErrorEl = null;
    this.badgeEl = null;
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
    this.guidedModeEl = null;
    this.guidedBodyEl = null;
    this.guidedTabMatchEl = null;
    this.guidedTabDebugEl = null;
    this.guidedMatchPaneEl = null;
    this.guidedDebugPaneEl = null;
    this.guidedManualActionsEl = null;
    this.guidedStepsListEl = null;
    this.guidedToggleBtn = null;
    this.guidedCloseBtn = null;
    this.guidedStartManualBtn = null;
    this.guidedStartBurstBtn = null;
    this.guidedValidateBtn = null;
    this.guidedSkipBtn = null;
    this.guidedBackBtn = null;
    this.guidedPauseBtn = null;
    this.guidedResumeBtn = null;
    this.guidedRestartBtn = null;
    this.guidedCopyDebugBtn = null;
    this.guidedDownloadEnrichedBtn = null;
    this.guidedMatchingRow = null;

    logger.info("MatchPanel unmounted");
  }

  // ---------------------------------------------------------------------------
  // Private — DOM construction
  // ---------------------------------------------------------------------------

  private buildDOM(container: HTMLElement): void {
    const wrapper = document.createElement("div");
    const subwrapper = document.createElement("div");
    subwrapper.classList.add("sidebar-tab-pane-body");
    wrapper.appendChild(subwrapper);
    container.appendChild(wrapper);
    container = subwrapper;
    const title = document.createElement("h3");
    title.className = "wmegj-panel-title";
    title.textContent = i18next.t("panel.title");
    container.appendChild(title);

    // State badge (driven by WalkController state changes)
    const badgeWrapper = document.createElement("p");
    const badge = document.createElement("strong");
    badge.textContent = "—";
    badgeWrapper.appendChild(badge);
    container.appendChild(badgeWrapper);
    this.badgeEl = badge;

    // Row 1 — GeoJSON URL input + Load button
    this.urlRow = this.buildUrlRow();
    container.appendChild(this.urlRow);

    // Row 2 — Track length (hidden until track-loaded)
    this.trackLengthRow = this.buildTrackLengthRow();
    container.appendChild(this.trackLengthRow);

    // Row 3 — Range slider (hidden until track-loaded)
    this.rangeSliderRow = document.createElement("section");
    this.rangeSliderRow.appendChild(this.buildRangeSlider());
    container.appendChild(this.rangeSliderRow);

    // Row 4 — CSV upload (hidden until track-loaded)
    this.csvUploadRow = this.buildCsvUploadRow();
    container.appendChild(this.csvUploadRow);

    // Row 5 — Start matching button (hidden during matching, shown on csv-loaded / done)
    this.startMatchingRow = this.buildStartMatchingRow();
    container.appendChild(this.startMatchingRow);

    // Row 5b — Guided matching controls live in a floating overlay appended
    // to document.body so they remain usable even when WME switches the
    // sidebar away from the userscripts tab after selection changes.
    this.guidedMatchingRow = this.buildGuidedMatchingRow();

    // Row 6 — Download buttons (hidden until csv-loaded)
    this.downloadRow = this.buildDownloadRow();
    container.appendChild(this.downloadRow);

    // Row 7 — Resume banner placeholder (populated by Lot 5)
    this.resumeBannerRow = this.buildResumeBannerRow();
    container.appendChild(this.resumeBannerRow);
  }

  private buildUrlRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";
    section.style.marginBottom = "8px";

    const currentUrl = new URLSearchParams(window.location.search).get("geojson") ?? "";

    const inputEl = wzTextInput({
      label: i18next.t("panel.urlInput.label"),
      value: currentUrl,
      placeholder: i18next.t("panel.urlInput.placeholder"),
      type: "url",
    });
    section.appendChild(inputEl);
    this.urlInputEl = inputEl;

    // Error message element — hidden until showLoadError() is called
    const errorEl = document.createElement("p");
    errorEl.style.color = "#c0392b";
    errorEl.style.fontSize = "11px";
    errorEl.style.margin = "2px 0 0 0";
    errorEl.style.display = "none";
    section.appendChild(errorEl);
    this.urlErrorEl = errorEl;

    const buttonRow = document.createElement("div");
    buttonRow.className = "wmegj-button-stack";
    buttonRow.style.marginTop = "4px";

    // Load button — reads the value from the wz-text-input or native input
    const loadBtn = wzButton({
      text: i18next.t("panel.urlInput.load"),
      variant: "primary",
      onClick: () => {
        this.onLoadUrlClick();
      },
    });
    buttonRow.appendChild(loadBtn);

    const centerBtn = wzButton({
      text: i18next.t("panel.urlInput.center"),
      variant: "secondary",
      onClick: () => {
        void this.onCenterUrlClick();
      },
    });
    buttonRow.appendChild(centerBtn);

    section.appendChild(buttonRow);

    return section;
  }

  private buildTrackLengthRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";
    section.style.marginBottom = "4px";
    const p = document.createElement("p");
    p.style.margin = "0";
    // Placeholder — updated via store subscription in mount()
    p.textContent = i18next.t("panel.trackLength", { km: "—" });
    section.appendChild(p);
    this.trackLengthValueEl = p;
    return section;
  }

  private buildCsvUploadRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";
    section.style.marginTop = "8px";

    const label = document.createElement("p");
    label.style.margin = "0 0 4px 0";
    label.style.fontSize = "12px";
    label.style.fontWeight = "600";
    label.textContent = i18next.t("panel.csvInput.label");
    section.appendChild(label);

    const input = fileInput({
      accept: ".csv",
      buttonLabel: i18next.t("panel.csvInput.label"),
      onFile: (file) => {
        this.onCsvFileSelected(file);
      },
    });
    section.appendChild(input);

    const loadingEl = document.createElement("div");
    loadingEl.className = "wmegj-csv-loader";
    loadingEl.style.display = "none";
    loadingEl.setAttribute("aria-live", "polite");

    const spinnerEl = document.createElement("span");
    spinnerEl.className = "wmegj-guided-spinner";
    spinnerEl.setAttribute("aria-hidden", "true");
    loadingEl.appendChild(spinnerEl);

    const loadingTextEl = document.createElement("span");
    loadingTextEl.textContent = i18next.t("panel.csvInput.loading");
    loadingEl.appendChild(loadingTextEl);

    section.appendChild(loadingEl);
    this.csvLoadingEl = loadingEl;
    this.csvLoadingTextEl = loadingTextEl;

    return section;
  }

  private buildStartMatchingRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";
    section.style.marginTop = "8px";

    const btnRow = document.createElement("div");
    btnRow.className = "wmegj-button-stack";

    const btn = wzButton({
      text: i18next.t("panel.openMatchingPanel"),
      variant: "primary",
      onClick: () => {
        this.openMatchingPanel();
      },
    });
    btnRow.appendChild(btn);

    section.appendChild(btnRow);

    return section;
  }

  /**
   * Guided matching sub-panel — shown while phase === "matching".
   *
   * Contains a header line (row N / M — km, time range), an instruction line,
   * a segment count line, and Validate / Skip / Back / Pause buttons. Text
   * elements are
   * kept as private fields so pipeline events can update them live.
   */
  private buildGuidedMatchingRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section wmegj-guided-panel wmegj-guided-overlay";
    this.restoreGuidedPanelLayout(section);

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
      onClick: () => {
        this.matchingPanelOpen = false;
        this.renderPhase(this.store.getState().phase);
      },
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

    const tabRow = document.createElement("div");
    tabRow.className = "wmegj-guided-tabs";
    bodyEl.appendChild(tabRow);

    const matchTab = this.buildGuidedTab("match", i18next.t("panel.matching.tabs.match"));
    const debugTab = this.buildGuidedTab("debug", i18next.t("panel.matching.tabs.debug"));
    tabRow.appendChild(matchTab);
    tabRow.appendChild(debugTab);
    this.guidedTabMatchEl = matchTab;
    this.guidedTabDebugEl = debugTab;

    const matchPane = document.createElement("div");
    matchPane.className = "wmegj-guided-tabpane";
    bodyEl.appendChild(matchPane);
    this.guidedMatchPaneEl = matchPane;

    const debugPane = document.createElement("div");
    debugPane.className = "wmegj-guided-tabpane";
    bodyEl.appendChild(debugPane);
    this.guidedDebugPaneEl = debugPane;

    const modeEl = document.createElement("p");
    modeEl.className = "wmegj-guided-meta";
    modeEl.textContent = i18next.t("panel.matching.mode.idle");
    matchPane.appendChild(modeEl);
    this.guidedModeEl = modeEl;

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
    instructionEl.textContent = i18next.t("panel.matching.validateOrCorrect");
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
    loaderTextEl.textContent = i18next.t("panel.matching.steps.unknown");
    loaderEl.appendChild(loaderTextEl);

    matchPane.appendChild(loaderEl);
    this.guidedLoaderEl = loaderEl;
    this.guidedLoaderTextEl = loaderTextEl;

    const matchActions = document.createElement("div");
    matchActions.className = "wmegj-guided-actions";
    this.guidedManualActionsEl = matchActions;
    matchPane.appendChild(matchActions);

    this.guidedStartManualBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.startManual"),
      variant: "primary",
      onClick: () => {
        this.onStartMatchingClick("interactive");
      },
    });
    this.guidedStartManualBtn.classList.add("wmegj-guided-button--start");
    this.guidedStartBurstBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.startAutomatic"),
      variant: "primary",
      onClick: () => {
        this.onStartMatchingClick("burst");
      },
    });
    this.guidedStartBurstBtn.classList.add("wmegj-guided-button--start");
    this.guidedValidateBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.validate"),
      variant: "primary",
      onClick: () => {
        this.pipeline?.validateCurrentRow();
      },
    });
    this.guidedValidateBtn.classList.add("wmegj-guided-button--validate");
    this.guidedSkipBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.skip"),
      variant: "secondary",
      onClick: () => {
        this.onSkipMatchingClick();
      },
    });
    this.guidedSkipBtn.classList.add("wmegj-guided-button--skip");
    this.guidedBackBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.back"),
      variant: "secondary",
      onClick: () => {
        this.onBackMatchingClick();
      },
    });
    this.guidedBackBtn.classList.add("wmegj-guided-button--back");
    this.guidedPauseBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.pause"),
      variant: "secondary",
      onClick: () => {
        this.pipeline?.pause();
      },
    });
    this.guidedPauseBtn.classList.add("wmegj-guided-button--pause");
    this.guidedResumeBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.resume"),
      variant: "secondary",
      onClick: () => {
        this.store.setPhase("matching");
        this.pipeline?.resume();
        this.updateGuidedControls();
      },
    });
    this.guidedResumeBtn.classList.add("wmegj-guided-button--resume");
    this.guidedRestartBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.restartFromScratch"),
      variant: "danger",
      onClick: () => {
        this.onRestartFromScratchClick();
      },
    });
    this.guidedRestartBtn.classList.add("wmegj-guided-button--restart");

    const stepsTitleEl = document.createElement("p");
    stepsTitleEl.className = "wmegj-guided-debug-title";
    stepsTitleEl.textContent = i18next.t("panel.matching.stepsTitle");
    debugPane.appendChild(stepsTitleEl);

    const stepsListEl = document.createElement("ul");
    stepsListEl.className = "wmegj-guided-steps";
    debugPane.appendChild(stepsListEl);
    this.guidedStepsListEl = stepsListEl;

    const debugActions = document.createElement("div");
    debugActions.className = "wmegj-guided-actions";
    debugPane.appendChild(debugActions);

    this.guidedCopyDebugBtn = this.appendGuidedButton(debugActions, {
      text: i18next.t("panel.matching.copyDebugJson"),
      variant: "secondary",
      onClick: () => {
        void this.onCopyDebugJsonClick();
      },
    });
    this.guidedDownloadEnrichedBtn = this.appendGuidedButton(debugActions, {
      text: i18next.t("panel.downloadEnriched"),
      variant: "secondary",
      onClick: () => {
        this.onDownloadEnrichedClick();
      },
    });

    const feedbackEl = document.createElement("p");
    feedbackEl.className = "wmegj-guided-feedback";
    debugPane.appendChild(feedbackEl);
    this.guidedDebugFeedbackEl = feedbackEl;

    this.setGuidedCollapsed(this.guidedCollapsed);
    this.setGuidedActiveTab(this.guidedActiveTab);
    this.updateGuidedControls();

    return section;
  }

  private buildGuidedTab(tab: "match" | "debug", label: string): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wmegj-guided-tab";
    button.textContent = label;
    button.addEventListener("click", () => {
      this.setGuidedActiveTab(tab);
    });
    return button;
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
    this.renderPhase(this.store.getState().phase);
  }

  private setGuidedActiveTab(tab: "match" | "debug"): void {
    this.guidedActiveTab = tab;
    this.guidedTabMatchEl?.classList.toggle("is-active", tab === "match");
    this.guidedTabDebugEl?.classList.toggle("is-active", tab === "debug");
    if (this.guidedMatchPaneEl) {
      this.guidedMatchPaneEl.style.display = tab === "match" ? "" : "none";
    }
    if (this.guidedDebugPaneEl) {
      this.guidedDebugPaneEl.style.display = tab === "debug" ? "" : "none";
    }
  }

  private setGuidedCollapsed(collapsed: boolean): void {
    this.guidedCollapsed = collapsed;
    try {
      localStorage.setItem(MatchPanel.PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
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

  private restoreGuidedPanelLayout(panel: HTMLElement): void {
    try {
      this.guidedCollapsed = localStorage.getItem(MatchPanel.PANEL_COLLAPSED_KEY) === "1";
      const raw = localStorage.getItem(MatchPanel.PANEL_POSITION_KEY);
      if (!raw) return;
      const position = JSON.parse(raw) as { left?: number; top?: number };
      if (typeof position.left !== "number" || typeof position.top !== "number") return;

      panel.style.left = `${Math.max(8, position.left)}px`;
      panel.style.top = `${Math.max(8, position.top)}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
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
          MatchPanel.PANEL_POSITION_KEY,
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

  private async onCopyDebugJsonClick(): Promise<void> {
    const trackGeometry = this.trackLayer?.getTrackGeometry() ?? null;
    if (
      trackGeometry === null ||
      this.currentRowIndex === null ||
      this.currentRowKmA === null ||
      this.currentRowKmB === null
    ) {
      this.setDebugFeedback(i18next.t("panel.matching.copyDebugJsonUnavailable"));
      return;
    }

    const trackSlice = sliceMultiLineByDistance(
      trackGeometry,
      this.currentRowKmA,
      this.currentRowKmB,
    );

    const segmentsById = new Map(
      this.wmeSDK.DataModel.Segments.getAll().map((segment) => [segment.id, segment]),
    );

    const matchedSegments = this.currentMatchedIds.map((id) => {
      const segment = segmentsById.get(id);
      return {
        id,
        loaded: segment !== undefined,
        geometry: segment?.geometry ?? null,
      };
    });

    let selectionIds: number[] = [];
    try {
      const selection = this.wmeSDK.Editing.getSelection();
      if (selection && selection.objectType === "segment") {
        selectionIds = selection.ids as number[];
      }
    } catch (err) {
      logger.warn("MatchPanel.onCopyDebugJsonClick: getSelection failed", err);
    }

    // Include geometries for every selected segment, even those NOT in
    // matchedSegments — this lets the user report false-negatives by
    // manually selecting the missed segment before copying.
    const selectionSegments = selectionIds.map((id) => {
      const segment = segmentsById.get(id);
      return {
        id,
        loaded: segment !== undefined,
        geometry: segment?.geometry ?? null,
      };
    });

    const row = this.store.getState().csvRows[this.currentRowIndex];

    const payload = {
      rowIndex: this.currentRowIndex,
      kmA: this.currentRowKmA,
      kmB: this.currentRowKmB,
      row: row
        ? {
            distance: row.distance,
            startTime: row.startTime,
            endTime: row.endTime,
            date: row.date,
          }
        : null,
      trackSlice: {
        type: "Feature" as const,
        geometry: trackSlice,
        properties: { kmA: this.currentRowKmA, kmB: this.currentRowKmB },
      },
      matchedSegments,
      currentSelectionIds: selectionIds,
      currentSelectionSegments: selectionSegments,
    };

    const json = JSON.stringify(payload, null, 2);

    try {
      await navigator.clipboard.writeText(json);
      this.setDebugFeedback(
        i18next.t("panel.matching.copyDebugJsonOk", {
          count: matchedSegments.length,
        }),
      );
      logger.info("MatchPanel.onCopyDebugJsonClick: copied debug JSON", {
        rowIndex: this.currentRowIndex,
        kmA: this.currentRowKmA,
        kmB: this.currentRowKmB,
        matchedCount: matchedSegments.length,
        bytes: json.length,
      });
    } catch (err) {
      logger.error("MatchPanel.onCopyDebugJsonClick: clipboard write failed", err);
      this.setDebugFeedback(i18next.t("panel.matching.copyDebugJsonError"));
    }
  }

  private setDebugFeedback(message: string): void {
    if (this.guidedDebugFeedbackEl) {
      this.guidedDebugFeedbackEl.textContent = message;
    }
  }

  private setGuidedLoading(isLoading: boolean, message?: string): void {
    this.guidedBusy = isLoading;
    if (!this.guidedLoaderEl) return;
    if (message && this.guidedLoaderTextEl) {
      this.guidedLoaderTextEl.textContent = message;
    }
    this.guidedLoaderEl.style.display = isLoading ? "flex" : "none";
    this.updateGuidedControls();
  }

  private setCsvLoading(isLoading: boolean, message?: string): void {
    if (message && this.csvLoadingTextEl) {
      this.csvLoadingTextEl.textContent = message;
    }
    if (this.csvLoadingEl) {
      this.csvLoadingEl.style.display = isLoading ? "flex" : "none";
    }
  }

  private onSkipMatchingClick(): void {
    if (this.matchingMode === "burst" && this.pipeline?.isRunning()) {
      this.pipeline.pause();
      return;
    }
    this.pipeline?.skipCurrentRow();
  }

  private onBackMatchingClick(): void {
    if (this.matchingMode === "burst" && this.pipeline?.isRunning()) {
      this.pendingManualRestartOffset = -1;
      this.pipeline.pause();
      return;
    }
    this.pipeline?.goBackOneRow();
  }

  private updateGuidedControls(): void {
    const phase = this.store.getState().phase;
    const hasCsv = this.phaseGte(phase, "csv-loaded");
    const isRunning = this.pipeline?.isRunning() ?? false;
    const isPaused = this.pipeline?.isPaused() ?? false;
    const isInteractive = this.matchingMode === "interactive";
    const isWaitingForUser = isRunning && isInteractive && !this.guidedBusy;
    const canStart = hasCsv && !isRunning && !isPaused;
    const disableForBusy = this.guidedBusy && isRunning;

    this.setButtonDisabled(this.guidedStartManualBtn, !canStart);
    this.setButtonDisabled(this.guidedStartBurstBtn, !canStart);
    this.setButtonDisabled(this.guidedValidateBtn, !isWaitingForUser || disableForBusy);
    this.setButtonDisabled(this.guidedSkipBtn, !isWaitingForUser || disableForBusy);
    this.setButtonDisabled(
      this.guidedBackBtn,
      !(isWaitingForUser || (isRunning && !isInteractive)),
    );
    this.setButtonDisabled(this.guidedPauseBtn, !isRunning);
    this.setButtonDisabled(this.guidedResumeBtn, !isPaused);
    this.setButtonDisabled(this.guidedRestartBtn, isRunning && this.guidedBusy);
    this.setButtonDisabled(this.guidedCopyDebugBtn, disableForBusy);
    this.setButtonDisabled(this.guidedDownloadEnrichedBtn, isRunning);

    this.setButtonVisible(this.guidedStartManualBtn, canStart);
    this.setButtonVisible(this.guidedStartBurstBtn, canStart);
    this.setButtonVisible(this.guidedValidateBtn, isRunning && isInteractive);
    this.setButtonVisible(this.guidedSkipBtn, isRunning && isInteractive);
    this.setButtonVisible(this.guidedBackBtn, isWaitingForUser || (isRunning && !isInteractive));
    this.setButtonVisible(this.guidedPauseBtn, isRunning && !isInteractive);
    this.setButtonVisible(this.guidedResumeBtn, isPaused);
    this.setButtonVisible(this.guidedRestartBtn, !isRunning || isPaused);

    if (this.guidedStatusEl) {
      const key = isRunning
        ? this.guidedBusy
          ? "running"
          : "waiting"
        : isPaused
          ? "paused"
          : phase === "done"
            ? "done"
            : "ready";
      this.guidedStatusEl.textContent = i18next.t(`panel.matching.panelStatus.${key}`);
    }

    if (this.guidedModeEl) {
      this.guidedModeEl.textContent = i18next.t(
        `panel.matching.mode.${isRunning || isPaused ? this.matchingMode : "idle"}`,
      );
    }
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

  private onRestartFromScratchClick(): void {
    confirmModal({
      message: i18next.t("panel.matching.restartConfirm"),
      confirmLabel: i18next.t("panel.matching.restartFromScratch"),
      cancelLabel: i18next.t("panel.finalFields.cancel"),
    })
      .then((confirmed) => {
        if (!confirmed) return;
        this.pipeline?.abort();
        const url = this.store.getState().geojsonUrl;
        if (url && this.lastCsvText) {
          clearForCurrent(url, this.lastCsvText);
        }
        // Re-load the same CSV (cached) to land back at csv-loaded with a
        // fresh state — saves the user from re-uploading the file.
        if (this.lastCsvText && this.lastCsvRows.length > 0) {
          this.store.setCsvRows(this.lastCsvRows, this.lastCsvText);
          this.store.setPhase("csv-loaded");
        } else {
          this.store.reset();
        }
      })
      .catch((err: unknown) => {
        logger.error("MatchPanel: restart confirm modal rejected", err);
      });
  }

  private buildDownloadRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";
    section.style.marginTop = "8px";
    section.style.display = "flex";
    section.style.flexDirection = "column";
    section.style.gap = "4px";

    const closuresBtn = wzButton({
      text: i18next.t("panel.downloadClosures"),
      variant: "primary",
      onClick: () => {
        this.onDownloadClosuresClick();
      },
    });
    section.appendChild(closuresBtn);

    return section;
  }

  private buildResumeBannerRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section wmegj-resume-panel";
    section.style.marginTop = "8px";
    section.style.display = "none";
    section.style.padding = "8px";
    section.style.border = "1px solid #f0c040";
    section.style.background = "#fff8e1";
    section.style.borderRadius = "4px";
    return section;
  }

  /**
   * Populate the resume banner with two buttons. Called from
   * onCsvFileSelected when a non-empty saved state was found for the current
   * (geojsonUrl, csvText) pair. Both buttons hide the banner before mutating
   * the store so the panel transitions cleanly to csv-loaded or matching.
   */
  private renderResumeBanner(saved: SessionState, rows: CsvRow[], csvText: string): void {
    const banner = this.resumeBannerRow;
    if (!banner) return;

    // Clear any previous content (the same banner element is reused across
    // CSV uploads).
    while (banner.firstChild) banner.removeChild(banner.firstChild);

    const headerEl = document.createElement("p");
    headerEl.style.margin = "0 0 4px 0";
    headerEl.style.fontWeight = "600";

    const totalKm = saved.trackLengthKm ?? this.store.getState().trackLengthKm ?? 0;
    const totalWorkItems = computeMatchingWorkItems(rows, totalKm).length;
    const isCompletedSession =
      saved.phase === "done" || (totalWorkItems > 0 && saved.currentIndex >= totalWorkItems);

    headerEl.textContent = i18next.t(
      isCompletedSession ? "panel.resumeCompleted" : "panel.resumeDetected",
    );
    banner.appendChild(headerEl);

    const indexEl = document.createElement("p");
    indexEl.style.margin = "0 0 8px 0";
    indexEl.style.fontSize = "12px";
    if (isCompletedSession) {
      indexEl.textContent = i18next.t("panel.resumeCompletedDetails", {
        total: totalWorkItems,
      });
    } else {
      const nextIndex = Math.min(saved.currentIndex + 1, Math.max(totalWorkItems, 1));
      indexEl.textContent = i18next.t("panel.resumeIndex", {
        index: nextIndex,
        total: totalWorkItems,
      });
    }
    banner.appendChild(indexEl);

    const btnRow = document.createElement("div");
    btnRow.className = "wmegj-button-stack";
    btnRow.style.display = "flex";
    btnRow.style.gap = "6px";

    const resumeBtn = wzButton({
      text: i18next.t("panel.resume"),
      variant: "primary",
      onClick: () => {
        banner.style.display = "none";
        this.store.rehydrate(saved, csvText);
      },
    });
    btnRow.appendChild(resumeBtn);

    const freshBtn = wzButton({
      text: i18next.t("panel.startFresh"),
      variant: "secondary",
      onClick: () => {
        const url = this.store.getState().geojsonUrl;
        if (url) clearForCurrent(url, csvText);
        banner.style.display = "none";
        this.store.setCsvRows(rows, csvText);
        this.store.setPhase("csv-loaded");
      },
    });
    btnRow.appendChild(freshBtn);

    banner.appendChild(btnRow);
    banner.style.display = "block";
  }

  // ---------------------------------------------------------------------------
  // Private — range slider (kept from the pre-refactor panel)
  // ---------------------------------------------------------------------------

  /**
   * Two-handle range slider that controls which kilometre window of the track
   * is rendered on the map. Implemented as two stacked native range inputs
   * since HTML lacks a built-in dual slider; the handlers enforce that the
   * lower handle stays ≤ the upper one.
   */
  private buildRangeSlider(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";
    section.style.marginTop = "8px";

    if (!this.trackLayer) {
      // Layer not yet attached (pre-track-loaded phase) — render an empty
      // placeholder; setTrackLayer() will rebuild this section with real bounds.
      return section;
    }

    const totalKm = this.trackLayer.getTotalKm();
    if (totalKm <= 0) {
      // Degenerate track (single point or zero-length) — slider is meaningless.
      return section;
    }

    const heading = document.createElement("p");
    heading.style.margin = "0 0 4px 0";
    heading.style.fontSize = "12px";
    heading.style.fontWeight = "600";
    heading.textContent = i18next.t("panel.range.title");
    section.appendChild(heading);

    const valueLabel = document.createElement("p");
    valueLabel.style.margin = "0 0 6px 0";
    valueLabel.style.fontSize = "12px";
    valueLabel.textContent = i18next.t("panel.range.window", {
      min: "0.00",
      max: totalKm.toFixed(2),
    });
    section.appendChild(valueLabel);

    const step = "0.01";

    const minInput = document.createElement("input");
    minInput.type = "range";
    minInput.min = "0";
    minInput.max = String(totalKm);
    minInput.step = step;
    minInput.value = "0";
    minInput.style.width = "100%";

    const maxInput = document.createElement("input");
    maxInput.type = "range";
    maxInput.min = "0";
    maxInput.max = String(totalKm);
    maxInput.step = step;
    maxInput.value = String(totalKm);
    maxInput.style.width = "100%";

    // requestAnimationFrame coalesces rapid input events: dragging the slider
    // fires `input` ~60×/s, but each redraw can take 50–200 ms on a long
    // track, so without coalescing the queue grows unbounded and the UI freezes.
    let pendingFrame = 0;
    let pendingLo = 0;
    let pendingHi = totalKm;

    const layer = this.trackLayer;

    const apply = () => {
      let lo = Number(minInput.value);
      let hi = Number(maxInput.value);
      // Keep handles ordered: the one the user just dragged wins.
      if (lo > hi) {
        if (document.activeElement === minInput) {
          hi = lo;
          maxInput.value = String(hi);
        } else {
          lo = hi;
          minInput.value = String(lo);
        }
      }
      pendingLo = lo;
      pendingHi = hi;
      valueLabel.textContent = i18next.t("panel.range.window", {
        min: lo.toFixed(2),
        max: hi.toFixed(2),
      });
      if (pendingFrame === 0) {
        pendingFrame = requestAnimationFrame(() => {
          pendingFrame = 0;
          layer.setVisibleRange(pendingLo, pendingHi);
          this._onRangeChanged?.();
        });
      }
    };

    minInput.addEventListener("input", apply);
    maxInput.addEventListener("input", apply);

    section.appendChild(minInput);
    section.appendChild(maxInput);

    return section;
  }

  // ---------------------------------------------------------------------------
  // Private — phase-driven visibility
  // ---------------------------------------------------------------------------

  /**
   * Toggle row visibility based on current session phase.
   * Called on every store state change so it is the single source of truth
   * for what is shown at each stage.
   */
  private renderPhase(phase: SessionPhase): void {
    const atLeastTrackLoaded = this.phaseGte(phase, "track-loaded");
    const atLeastCsvLoaded = this.phaseGte(phase, "csv-loaded");
    const isMatching = phase === "matching";

    this.setRowVisible(this.trackLengthRow, atLeastTrackLoaded);
    this.setRowVisible(this.rangeSliderRow, atLeastTrackLoaded);
    this.setRowVisible(this.csvUploadRow, atLeastTrackLoaded);
    this.setRowVisible(this.startMatchingRow, atLeastCsvLoaded);
    this.setRowVisible(this.guidedMatchingRow, this.matchingPanelOpen && atLeastCsvLoaded);
    this.setRowVisible(this.downloadRow, atLeastCsvLoaded);
    if (!isMatching) {
      this.setGuidedLoading(false);
    }
    this.updateGuidedControls();
    // Resume banner visibility is managed by maybeShowResumeBanner() (Lot 5)
  }

  /**
   * Ordered phase list — later phases are "greater than" earlier ones.
   * Changing order here changes what is shown/hidden; keep in sync with
   * SessionPhase type definition in SessionStore.
   */
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
  // Private — event handlers
  // ---------------------------------------------------------------------------

  private onLoadUrlClick(): void {
    // Extract the current value from whatever element wzTextInput produced.
    // In WME context: (el as wz-text-input).value; in fallback: inner <input>.
    const url = this.getUrlInputValue();
    if (!url) return;

    // Hide any previous error before re-attempting
    if (this.urlErrorEl) {
      this.urlErrorEl.style.display = "none";
      this.urlErrorEl.textContent = "";
    }

    // loadFn is injected by main.user.ts via setLoadFn() to avoid a circular
    // module dependency (loadAndAttachTrack imports MatchPanel for its type).
    if (!this.loadFn) {
      logger.warn("MatchPanel: loadFn not injected yet — call setLoadFn() before mounting");
      return;
    }

    this.loadFn(url).catch((err: unknown) => {
      logger.error("MatchPanel: loadFn rejected", err);
    });
  }

  private async onCenterUrlClick(): Promise<void> {
    const url = this.getUrlInputValue();
    if (!url) return;

    if (this.urlErrorEl) {
      this.urlErrorEl.style.display = "none";
      this.urlErrorEl.textContent = "";
    }

    const currentUrl = this.store.getState().geojsonUrl;
    const needsLoad = currentUrl !== url || this.trackLayer?.getTrackGeometry() === null;

    if (needsLoad) {
      if (!this.loadFn) {
        logger.warn("MatchPanel: loadFn not injected yet — call setLoadFn() before mounting");
        return;
      }
      await this.loadFn(url);
    }

    const geometry = this.trackLayer?.getTrackGeometry() ?? null;
    const bbox = geometry ? bboxOfMultiLineString(geometry) : null;
    if (!bbox) {
      logger.warn("MatchPanel.onCenterUrlClick: no track geometry available to center");
      return;
    }

    this.wmeSDK.Map.zoomToExtent({ bbox });
    logger.info("MatchPanel.onCenterUrlClick: centered map on track bbox", { url, bbox });
  }

  private getUrlInputValue(): string {
    if (!this.urlInputEl) return "";

    // wz-text-input exposes .value on the host element; the fallback div wraps
    // a native <input> as its first child.
    const asWz = this.urlInputEl as unknown as { value?: string };
    if (typeof asWz.value === "string") {
      return asWz.value.trim();
    }

    // Fallback: the wrapper div contains a native <input>
    const nativeInput = this.urlInputEl.querySelector("input");
    return nativeInput ? nativeInput.value.trim() : "";
  }

  private onCsvFileSelected(file: File): void {
    this.setCsvLoading(true, i18next.t("panel.csvInput.reading"));
    this.clearCsvError();

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== "string") {
        this.setCsvLoading(false);
        return;
      }
      void this.processCsvText(text);
    };
    reader.onerror = () => {
      const message =
        reader.error instanceof DOMException ? reader.error.message : i18next.t("panel.csvInput.error");
      this.setCsvLoading(false);
      this.showCsvError(message);
    };
    reader.readAsText(file);
  }

  private async processCsvText(text: string): Promise<void> {
    try {
      this.setCsvLoading(true, i18next.t("panel.csvInput.processing"));
      await waitForNextPaint();

      const rows = parseSchedule(text);
      // Cache so the restart-from-scratch button can re-load without asking
      // the user to re-upload the file.
      this.lastCsvText = text;
      this.lastCsvRows = rows;

      // Show only the labels whose distances appear in the CSV so the track
      // decorations match the pipeline waypoints from the start.
      if (this.trackLayer) {
        this.setCsvLoading(true, i18next.t("panel.csvInput.labels"));
        await waitForNextPaint();
        const distanceKeys = rows.map((r) => r.distance);
        this.trackLayer.setVisibleDistances(distanceKeys);
      }

      const url = this.store.getState().geojsonUrl;
      const saved = url ? persistenceLoad(url, text) : null;
      if (saved && saved.currentIndex > 0) {
        // Defer the actual store mutation until the user picks Resume or
        // Start fresh — see renderResumeBanner().
        this.renderResumeBanner(saved, rows, text);
      } else {
        this.store.setCsvRows(rows, text);
        this.store.setPhase("csv-loaded");
      }

      logger.info(`MatchPanel: loaded ${rows.length} CSV rows`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("MatchPanel: CSV parse failed", err);
      this.showCsvError(message);
    } finally {
      this.setCsvLoading(false);
    }
  }

  private clearCsvError(): void {
    const errEl = this.csvUploadRow?.querySelector<HTMLElement>(".wmegj-csv-error");
    if (errEl) {
      errEl.textContent = "";
      errEl.style.display = "none";
    }
  }

  private showCsvError(message: string): void {
    if (!this.csvUploadRow) return;

    let errEl = this.csvUploadRow.querySelector<HTMLElement>(".wmegj-csv-error");
    if (!errEl) {
      errEl = document.createElement("p");
      errEl.className = "wmegj-csv-error";
      this.csvUploadRow.appendChild(errEl);
    }
    errEl.textContent = message;
    errEl.style.display = "";
  }

  private onDownloadEnrichedClick(): void {
    const rows = this.store.getState().csvRows;
    const csv = serializeSchedule(rows);
    this.triggerDownload(csv, "schedule-enriched.csv", "text/csv");
  }

  private onDownloadClosuresClick(): void {
    const { csvRows, closuresBySegment } = this.store.getState();

    if (!this.hasValidatedProgress(csvRows)) {
      const message = i18next.t("panel.matching.mustValidateFirst");
      logger.warn("MatchPanel: " + message);
      alert(message);
      return;
    }

    const closureGroups = this.getExportClosureGroups(csvRows);
    if (!closureGroups) {
      return;
    }

    promptFinalFields()
      .then((fields: FinalFields | null) => {
        if (!fields) return;

        try {
          const csv = buildClosuresCsv(csvRows, closureGroups, closuresBySegment, fields);
          this.triggerDownload(csv, "closures.csv", "text/csv");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("MatchPanel: buildClosuresCsv failed", err);
          // Surface error inline without a full modal — a console error is
          // visible in DevTools; a future lot can add a proper toast.
          alert(message);
        }
      })
      .catch((err: unknown) => {
        logger.error("MatchPanel: promptFinalFields rejected", err);
      });
  }

  private hasValidatedProgress(rows: readonly CsvRow[]): boolean {
    return rows.some((row) => row.segments !== null);
  }

  private getExportClosureGroups(rows: readonly CsvRow[]): ClosureRowGroup[] | null {
    const closureGroups = (this.pipeline?.getMatchedGroups() ?? []) as ClosureRowGroup[];
    const missingGeoIndex = rows.findIndex(
      (row, index) =>
        row.segments !== null &&
        row.segments.some(
          (segmentId) =>
            !closureGroups.some(
              (group) => group.rowIndex === index && group.segmentIds.includes(segmentId),
            ),
        ),
    );

    if (missingGeoIndex === -1) {
      return closureGroups;
    }

    const message = i18next.t("panel.matching.missingRowGeo", {
      index: missingGeoIndex + 1,
    });
    logger.warn("MatchPanel: " + message);
    alert(message);
    return null;
  }

  private onStartMatchingClick(mode: "interactive" | "burst"): void {
    const { csvRows, geojsonUrl, phase } = this.store.getState();
    if (this.pipeline?.isRunning()) {
      logger.warn("MatchPanel.onStartMatchingClick: pipeline already running");
      return;
    }

    this.matchingMode = mode;
    this.matchingPanelOpen = true;
    this.guidedActiveTab = "match";
    this.setGuidedActiveTab("match");

    logger.info("MatchPanel.onStartMatchingClick: clicked", {
      rowCount: csvRows.length,
      geojsonUrl,
      mode,
      hasController: this.controller !== null,
      hasTrackLayer: this.trackLayer !== null,
    });

    if (csvRows.length === 0) {
      logger.warn("MatchPanel.onStartMatchingClick: no CSV rows, cannot start");
      return;
    }

    if (!this.controller) {
      logger.warn("MatchPanel.onStartMatchingClick: no controller, track not loaded");
      return;
    }

    if (!this.trackLayer) {
      logger.warn("MatchPanel.onStartMatchingClick: no trackLayer, track not loaded");
      return;
    }

    if (!geojsonUrl) {
      logger.warn("MatchPanel.onStartMatchingClick: no geojsonUrl in store");
      return;
    }

    // Build NormalizedTrack from the layer's geometry. The TrackLayer already
    // holds the loaded track; expose it via getTrack() or reconstruct the
    // NormalizedTrack inline from what the controller holds.
    // WalkController.track is private, so we read from TrackLayer instead.
    const trackGeometry = this.trackLayer.getTrackGeometry();
    if (!trackGeometry) {
      logger.warn("MatchPanel.onStartMatchingClick: trackLayer has no geometry yet");
      return;
    }

    const track = { trackId: null, geometry: trackGeometry };

    if (phase === "done") {
      logger.info("MatchPanel.onStartMatchingClick: restarting completed run from row 0");
      this.store.rewindToRow(0);
    }

    logger.info("MatchPanel.onStartMatchingClick: switching store phase to matching");
    this.store.setPhase("matching");
    this.setGuidedLoading(true, i18next.t("panel.matching.steps.unknown"));
    this.updateGuidedControls();
    if (this.guidedInstructionEl) {
      this.guidedInstructionEl.textContent = i18next.t(
        mode === "burst" ? "panel.matching.burstRunning" : "panel.matching.validateOrCorrect",
      );
    }
    if (this.guidedManualActionsEl) {
      this.guidedManualActionsEl.style.display = mode === "burst" ? "none" : "flex";
    }

    logger.info("MatchPanel.onStartMatchingClick: creating MatchingPipeline", {
      rowCount: csvRows.length,
      currentIndex: this.store.getState().currentIndex,
      mode,
    });
    this.pipeline = new MatchingPipeline(
      this.wmeSDK,
      this.store,
      this.controller,
      track,
      this.trackLayer,
      {
        onRowStarted: (index, total) => {
          this.setGuidedLoading(true, i18next.t("panel.matching.steps.unknown"));
          const rows = this.store.getState().csvRows;
          const row = rows[index];
          if (row && this.guidedRowHeaderEl) {
            this.guidedRowHeaderEl.textContent = i18next.t("panel.matching.rowHeader", {
              index: index + 1,
              total,
              km: row.distance.toFixed(1),
              startTime: row.startTime,
              endTime: row.endTime,
            });
          }
          if (this.guidedSegmentCountEl) {
            this.guidedSegmentCountEl.textContent = i18next.t("panel.matching.segmentsMatched", {
              count: 0,
            });
          }
          const totalKm = this.store.getState().trackLengthKm ?? 0;
          const workItem = computeMatchingWorkItems(rows, totalKm).find(
            (item) => item.rowIndex === index,
          );
          this.currentRowIndex = index;
          this.currentRowKmA = workItem?.kmA ?? null;
          this.currentRowKmB = workItem?.kmB ?? null;
          this.currentMatchedIds = [];
          this.setDebugFeedback("");
          this.resetGuidedSteps();
        },
        onRowMatched: (_index, segments) => {
          this.setGuidedLoading(this.matchingMode === "burst");
          if (this.guidedSegmentCountEl) {
            this.guidedSegmentCountEl.textContent = i18next.t("panel.matching.segmentsMatched", {
              count: segments.length,
            });
          }
          this.currentMatchedIds = segments.slice();
          this.updateGuidedControls();
        },
        onStep: (event) => {
          const message = this.formatPipelineStep(event);
          this.setGuidedLoading(event.key !== "waitingValidation", message);
          this.appendGuidedStep(message);
          this.updateGuidedControls();
        },
        onError: (message) => {
          this.setGuidedLoading(false);
          logger.error("MatchingPipeline error:", message);
        },
        onDone: () => {
          logger.info("MatchPanel.onStartMatchingClick: pipeline reported done");
          this.setGuidedLoading(false);
          this.store.setPhase("done");
          this.updateGuidedControls();
        },
        onAborted: () => {
          logger.info("MatchPanel.onStartMatchingClick: pipeline reported aborted");
          this.setGuidedLoading(false);
          // Return to csv-loaded phase so the user can restart
          this.store.setPhase("csv-loaded");
          this.updateGuidedControls();
        },
        onPaused: () => {
          logger.info("MatchPanel.onStartMatchingClick: pipeline reported paused");
          this.setGuidedLoading(false);
          this.store.setPhase("csv-loaded");
          this.updateGuidedControls();

          if (this.pendingManualRestartOffset !== null) {
            const restartIndex = Math.max(
              0,
              this.store.getState().currentIndex + this.pendingManualRestartOffset,
            );
            this.pendingManualRestartOffset = null;
            this.store.rewindToRow(restartIndex);
            this.onStartMatchingClick("interactive");
          }
        },
      },
      { burstMode: mode === "burst" },
    );

    logger.info("MatchPanel.onStartMatchingClick: starting pipeline");
    this.pipeline.start();
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

  private resetGuidedSteps(): void {
    const list = this.guidedStepsListEl;
    if (!list) return;
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
  }

  private appendGuidedStep(message: string): void {
    const list = this.guidedStepsListEl;
    if (!list) return;
    const item = document.createElement("li");
    item.textContent = message;
    list.appendChild(item);

    const MAX_STEPS = 12;
    while (list.childElementCount > MAX_STEPS) {
      list.removeChild(list.firstElementChild as ChildNode);
    }

    list.scrollTop = list.scrollHeight;
  }

  private formatPipelineStep(event: PipelineStepEvent): string {
    const values = event.values ?? {};
    switch (event.key) {
      case "planningStart":
        return i18next.t("panel.matching.steps.planningStart", values);
      case "splitTail":
        return i18next.t("panel.matching.steps.splitTail", values);
      case "sliceAccepted":
        return i18next.t("panel.matching.steps.sliceAccepted", values);
      case "sliceDropped":
        return i18next.t("panel.matching.steps.sliceDropped", values);
      case "planningDone":
        return i18next.t("panel.matching.steps.planningDone", values);
      case "processingLeaf":
        return i18next.t("panel.matching.steps.processingLeaf", values);
      case "leafMatched":
        return i18next.t("panel.matching.steps.leafMatched", values);
      case "waitingValidation":
        return i18next.t("panel.matching.steps.waitingValidation", values);
      default:
        return i18next.t("panel.matching.steps.unknown");
    }
  }

  // ---------------------------------------------------------------------------
  // Private — WalkController badge
  // ---------------------------------------------------------------------------

  private updateBadge(state: WalkState): void {
    if (this.badgeEl) {
      this.badgeEl.textContent = i18next.t(`panel.status.${state}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — CSS injection
  // ---------------------------------------------------------------------------

  private injectStyles(container: HTMLElement): void {
    const style = document.createElement("style");
    style.textContent = `
      .wmegj-panel-root {
        font-size: 13px;
        line-height: 1.4;
        color: #1f2937;
      }

      .wmegj-panel-title {
        margin: 0 0 10px 0;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 0;
      }

      .wmegj-section {
        margin-bottom: 14px;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: #ffffff;
        box-shadow: none;
      }

      .wmegj-section p {
        margin-top: 0;
      }

      .wmegj-input-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .wmegj-input-label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: #344054;
      }

      .wmegj-text-input {
        display: block;
        width: 100%;
        box-sizing: border-box;
        min-height: 36px;
        padding: 8px 10px;
        border: 1px solid #c7d0d9;
        border-radius: 8px;
        background: #ffffff;
        color: #101828;
      }

      .wmegj-text-input:focus {
        outline: 2px solid rgba(10, 132, 255, 0.2);
        outline-offset: 1px;
        border-color: #0a84ff;
      }

      .wmegj-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 34px;
        padding: 0 12px;
        width: 100%;
        border: 1px solid transparent;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.25;
        text-align: center;
        white-space: normal;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
      }

      .wmegj-button:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .wmegj-button--primary {
        background: #33c266;
        color: #ffffff;
      }

      .wmegj-button--secondary {
        background: #ffffff;
        border-color: #c7d0d9;
        color: #344054;
      }

      .wmegj-button--danger {
        background: #fff1f3;
        border-color: #f4c7cf;
        color: #b42318;
      }

      .wmegj-file-input {
        display: block;
        margin-top: 4px;
        font-size: 12px;
        cursor: pointer;
      }

      .wmegj-csv-loader {
        align-items: center;
        gap: 8px;
        margin: 6px 0 0 0;
        padding: 6px 8px;
        border: 1px solid #d6dbe3;
        border-radius: 4px;
        background: #f6f8fb;
        color: #344054;
        font-size: 11px;
        line-height: 1.3;
      }

      .wmegj-csv-error {
        margin: 4px 0 0 0;
        color: #c0392b;
        font-size: 11px;
        line-height: 1.3;
      }

      .wmegj-button-stack {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .wmegj-guided-panel {
        background: #ffffff;
      }

      .wmegj-guided-overlay {
        position: fixed;
        right: 16px;
        bottom: 16px;
        display: flex;
        flex-direction: column;
        width: min(390px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        margin: 0;
        padding: 0;
        border: 1px solid #d6dbe3;
        border-radius: 8px;
        z-index: 2200;
        overflow: hidden;
        box-shadow: 0 12px 28px rgba(16, 24, 40, 0.18);
      }

      .wmegj-guided-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #e4e8ee;
        cursor: move;
        user-select: none;
      }

      .wmegj-guided-title {
        font-size: 13px;
        font-weight: 800;
        color: #1f2937;
        text-transform: uppercase;
      }

      .wmegj-guided-status {
        margin-top: 2px;
        font-size: 11px;
        color: #667085;
      }

      .wmegj-guided-header-actions {
        display: flex;
        gap: 6px;
        flex: 0 0 auto;
      }

      .wmegj-guided-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 1px solid #d0d7e2;
        border-radius: 999px;
        background: #ffffff;
        color: #4b5565;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
      }

      .wmegj-guided-icon-button:hover {
        background: #f5f8fc;
        border-color: #b9c4d2;
        color: #1f2937;
      }

      .wmegj-guided-icon-button i {
        font-size: 16px;
        line-height: 1;
      }

      .wmegj-guided-body {
        flex: 1 1 auto;
        min-height: 0;
        padding: 0 12px 12px;
        overflow-y: auto;
      }

      .wmegj-guided-tabs {
        display: flex;
        margin: 0 -12px 10px;
        border-bottom: 1px solid #e4e8ee;
      }

      .wmegj-guided-tab {
        flex: 1 1 0;
        min-height: 40px;
        border: 0;
        border-bottom: 3px solid transparent;
        background: #ffffff;
        color: #667085;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .wmegj-guided-tab.is-active {
        border-bottom-color: #3478f6;
        color: #2563eb;
      }

      .wmegj-guided-meta,
      .wmegj-guided-row,
      .wmegj-guided-count,
      .wmegj-guided-instruction,
      .wmegj-guided-feedback {
        margin: 0 0 8px 0;
        font-size: 12px;
      }

      .wmegj-guided-meta {
        color: #667085;
        font-weight: 600;
      }

      .wmegj-guided-row {
        color: #1f2937;
        font-weight: 700;
      }

      .wmegj-guided-count {
        color: #344054;
      }

      .wmegj-guided-instruction,
      .wmegj-guided-feedback {
        color: #667085;
      }

      .wmegj-guided-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        align-items: stretch;
      }

      .wmegj-guided-button {
        min-width: 0;
        min-height: 42px;
        padding: 9px 14px;
      }

      .wmegj-guided-button--validate {
        background: #3478f6;
        border-color: #3478f6;
        color: #ffffff;
      }

      .wmegj-guided-button--start {
        background: #3478f6;
        border-color: #3478f6;
        color: #ffffff;
      }

      .wmegj-guided-button--start:hover {
        background: #2563eb;
        border-color: #2563eb;
      }

      .wmegj-guided-button--validate:hover {
        background: #2563eb;
        border-color: #2563eb;
      }

      .wmegj-guided-button--skip {
        background: #edf2fb;
        border-color: transparent;
        color: #3478f6;
      }

      .wmegj-guided-button--skip:hover {
        background: #e2ebfb;
        color: #2563eb;
      }

      .wmegj-guided-button--back {
        grid-column: 1 / -1;
        justify-self: start;
        width: auto;
        min-width: 120px;
        background: #ffffff;
        border-color: #c7d0d9;
        color: #344054;
      }

      .wmegj-guided-button--pause,
      .wmegj-guided-button--resume {
        background: #ffffff;
        border-color: #c7d0d9;
        color: #344054;
      }

      .wmegj-guided-button--restart {
        grid-column: 1 / -1;
      }

      .wmegj-guided-button:hover:not(:disabled) {
        filter: brightness(0.98);
      }

      .wmegj-guided-debug-title {
        margin: 0 0 6px 0;
        font-size: 12px;
        font-weight: 700;
        color: #344054;
      }

      .wmegj-guided-steps {
        margin: 0 0 10px 18px;
        padding: 0;
        max-height: 150px;
        overflow-y: auto;
        color: #475467;
        font-size: 11px;
      }

      .wmegj-guided-loader {
        align-items: center;
        gap: 8px;
        margin: 4px 0 8px 0;
        padding: 6px 8px;
        border: 1px solid #d6dbe3;
        border-radius: 4px;
        background: #f6f8fb;
        color: #344054;
        font-size: 11px;
        line-height: 1.3;
      }

      .wmegj-guided-spinner {
        width: 14px;
        height: 14px;
        flex: 0 0 14px;
        border: 2px solid #c8d2df;
        border-top-color: #3478f6;
        border-radius: 999px;
        animation: wmegj-spin 0.8s linear infinite;
      }

      @keyframes wmegj-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 640px) {
        .wmegj-guided-overlay {
          right: 12px;
          left: 12px;
          bottom: 12px;
          width: auto;
        }

        .wmegj-guided-button--back {
          width: 100%;
          justify-self: stretch;
        }
      }

      .wmegj-resume-panel {
        border-color: #f0c040;
        background: #fff8e1;
      }

      .wmegj-file-input {
        padding: 6px 8px;
      }
    `;
    container.appendChild(style);
  }
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
