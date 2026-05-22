import type { WmeSDK, ZoomLevel } from "wme-sdk-typings";
import { i18next } from "../../../locales/i18n";
import { logger } from "../../utils/logger";
import { TrackLayer } from "../../layers/TrackLayer";
import { WalkController } from "../../controller/WalkController";
import type { LineRegistry } from "../../lines/LineRegistry";
import type { LineEntry } from "../../lines/types";
import type { WalkState } from "../../controller/walkStates";
import type { SessionStore, SessionPhase } from "../../state/SessionStore";
import type { CsvRow } from "../../csv/types";
import { buildClosuresCsv } from "../../csv/buildClosuresCsv";
import type { ClosureRowGroup, FinalFields, RowGeo } from "../../csv/buildClosuresCsv";
import type { ClosureRange } from "../../csv/types";
import { wzButton, wzTextInput, type WzButtonProps } from "../components/wz";
import { promptFinalFields } from "../promptFinalFields";
import { confirmModal } from "../modal";
import { MatchingHeaderView } from "../views/MatchingHeaderView";
import { bboxOfMultiLineString, sliceMultiLineByDistance } from "../../matching/trackPortions";
import { multiLineLengthKm } from "../../matching/trackPortions";
import { promptClosureWindow } from "../components/promptClosureWindow";
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
import { closuresFromSource } from "../../csv/closuresFromSource";
import { waitForMapIdle } from "../../utils/waitForMapIdle";

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
export class MatchingSubTab {
  private static readonly PANEL_POSITION_KEY = "wme-geojson.matchPanel.position";
  private static readonly PANEL_COLLAPSED_KEY = "wme-geojson.matchPanel.collapsed";

  private tabPane: HTMLElement | null = null;

  // Unsubscribe handles — cleaned up in unmount()
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
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

  private loadFn: ((url: string) => Promise<void>) | null = null;

  // ── Row container elements (toggled by renderPhase) ─────────────────────
  private urlRow: HTMLElement | null = null;
  private trackLengthRow: HTMLElement | null = null;
  private trackLengthValueEl: HTMLElement | null = null;
  private rangeSliderRow: HTMLElement | null = null;
  private startMatchingRow: HTMLElement | null = null;
  private guidedMatchingRow: HTMLElement | null = null;
  private downloadRow: HTMLElement | null = null;

  private urlInputEl: HTMLElement | null = null;
  private urlErrorEl: HTMLElement | null = null;

  private headerView: MatchingHeaderView | null = null;

  private _onRangeChanged: (() => void) | null = null;

  private tabLabel: HTMLElement | null = null;

  // ── New lazy-matching engine ────────────────────────────────────────────
  private readonly sourceStore = new SourceStore();
  private readonly persistence = new SourcePersistence();
  private detachPersistence: (() => void) | null = null;
  private lazyPipeline: LazyMatchingPipeline | null = null;
  // True while the pipeline is mid-step (centering / matching) — disables the
  // guided controls so the operator cannot fire overlapping steps.
  private guidedBusy = false;
  // True once a Source has been started (matching kicked off at least once).
  private matchingActive = false;

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
  private guidedBackBtn: HTMLElement | null = null;
  private guidedReselectBtn: HTMLElement | null = null;
  private guidedRerunBtn: HTMLElement | null = null;
  private guidedDoneCloseBtn: HTMLElement | null = null;
  private guidedRestartBtn: HTMLElement | null = null;
  private matchingPanelOpen = false;
  private guidedCollapsed = false;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly store: SessionStore,
    private readonly registry: LineRegistry,
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
    this.injectStyles(root);
    this.buildDOM(root);
    this.contentWrapperEl = root.lastElementChild as HTMLElement | null;

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
      if (state.trackLengthKm !== null && this.trackLengthValueEl) {
        this.trackLengthValueEl.textContent = i18next.t("panel.trackLength", {
          km: state.trackLengthKm.toFixed(2),
        });
      }
    });

    // Header / overlay / segment-count updates are driven by the SourceStore.
    this.unsubscribeSourceStore = this.sourceStore.onChange(() => {
      this.renderSourceState();
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
    this.headerView?.setTitle(entry.displayName);
    this.matchingActive = false;
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

    const selectedTrack = entry.track;

    const layer = new TrackLayer(this.wmeSDK);
    layer.draw(selectedTrack, {
      colorMode:
        entry.slowupNumber !== undefined && selectedTrack.geometry.coordinates.length > 1
          ? "per-subline"
          : "single",
    });

    const controller = new WalkController(this.wmeSDK, selectedTrack.geometry);
    this.setController(controller);
    this.setTrackLayer(layer);

    // Build (or resume) the Source for this entry and hydrate the store.
    const existing = this.persistence.load(entry.id);
    const source = existing ?? this.buildSourceForEntry(entry);
    this.lazyPipeline = null;
    this.sourceStore.hydrate(source);
    this.detachPersistence?.();
    this.detachPersistence = attachPersistence(this.sourceStore, this.persistence);

    // Drive simple phase/length display off the legacy session store.
    this.store.setTrack(entry.id, multiLineLengthKm(selectedTrack.geometry));
    this.store.setPhase("csv-loaded");

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
    });
  }

  setController(c: WalkController): void {
    this.controller?.dispose();
    this.controller = c;
    this.unsubscribeState?.();
    this.unsubscribeState = c.onStateChange((s) => {
      this.updateBadge(s);
    });
    this.updateBadge(c.state);
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

  setLoadFn(fn: (url: string) => Promise<void>): void {
    this.loadFn = fn;
  }

  getTabLabel(): HTMLElement | null {
    return this.tabLabel;
  }

  showLoadError(message: string): void {
    if (!this.urlErrorEl) return;
    this.urlErrorEl.textContent = message;
    this.urlErrorEl.style.display = "";
  }

  unmount(): void {
    this.controller?.dispose();
    this.controller = null;
    this.persistence.flush();
    this.detachPersistence?.();
    this.detachPersistence = null;
    this.unsubscribeStore?.();
    this.unsubscribeState?.();
    this.unsubscribeMapDataLoaded?.();
    this.unsubscribeSelection?.();
    this.unsubscribeSourceStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeState = null;
    this.unsubscribeMapDataLoaded = null;
    this.unsubscribeSelection = null;
    this.unsubscribeSourceStore = null;

    if (this.tabPane) {
      while (this.tabPane.firstChild) {
        this.tabPane.removeChild(this.tabPane.firstChild);
      }
      this.tabPane = null;
    }

    this.urlRow = null;
    this.trackLengthRow = null;
    this.rangeSliderRow = null;
    this.startMatchingRow = null;
    this.attachedLineId = null;
    this.downloadRow = null;
    this.urlInputEl = null;
    this.urlErrorEl = null;
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
    this.guidedBackBtn = null;
    this.guidedReselectBtn = null;
    this.guidedRerunBtn = null;
    this.guidedDoneCloseBtn = null;
    this.guidedRestartBtn = null;
    this.guidedMatchingRow = null;

    logger.info("MatchPanel unmounted");
  }

  // ---------------------------------------------------------------------------
  // Private — DOM construction
  // ---------------------------------------------------------------------------

  private buildDOM(container: HTMLElement): void {
    const wrapper = document.createElement("div");
    const subwrapper = document.createElement("div");
    wrapper.appendChild(subwrapper);
    container.appendChild(wrapper);
    container = subwrapper;
    this.headerView = new MatchingHeaderView();
    container.appendChild(this.headerView.root);

    this.urlRow = this.buildUrlRow();

    this.trackLengthRow = this.buildTrackLengthRow();
    container.appendChild(this.trackLengthRow);

    this.rangeSliderRow = document.createElement("section");
    this.rangeSliderRow.appendChild(this.buildRangeSlider());
    container.appendChild(this.rangeSliderRow);

    this.startMatchingRow = this.buildStartMatchingRow();
    container.appendChild(this.startMatchingRow);

    this.guidedMatchingRow = this.buildGuidedMatchingRow();

    this.downloadRow = this.buildDownloadRow();
    container.appendChild(this.downloadRow);
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
    p.textContent = i18next.t("panel.trackLength", { km: "—" });
    section.appendChild(p);
    this.trackLengthValueEl = p;
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
   * Guided matching sub-panel — a floating overlay appended to document.body.
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

    const matchPane = document.createElement("div");
    matchPane.className = "wmegj-guided-tabpane";
    bodyEl.appendChild(matchPane);

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

    this.guidedStartBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.startManual"),
      variant: "primary",
      onClick: () => {
        void this.onStartMatchingClick();
      },
    });
    this.guidedStartBtn.classList.add("wmegj-guided-button--start");
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
    this.guidedBackBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.back"),
      variant: "secondary",
      onClick: () => {
        void this.onBackMatchingClick();
      },
    });
    this.guidedBackBtn.classList.add("wmegj-guided-button--back");
    this.guidedDoneCloseBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.closePanel"),
      variant: "primary",
      onClick: () => {
        this.matchingPanelOpen = false;
        this.renderPhase(this.store.getState().phase);
      },
    });
    this.guidedDoneCloseBtn.classList.add("wmegj-guided-button--done-close");

    const manualToolsActions = document.createElement("div");
    manualToolsActions.className = "wmegj-guided-secondary-actions";
    matchPane.appendChild(manualToolsActions);

    this.guidedReselectBtn = this.appendGuidedButton(manualToolsActions, {
      text: i18next.t("panel.matching.reselectMatched"),
      variant: "secondary",
      onClick: () => {
        this.onReselectMatchedClick();
      },
    });
    this.guidedReselectBtn.classList.add("wmegj-guided-button--reselect");

    this.guidedRerunBtn = this.appendGuidedButton(manualToolsActions, {
      text: i18next.t("panel.matching.rerunCurrentRow"),
      variant: "secondary",
      onClick: () => {
        void this.onRerunCurrentRowClick();
      },
    });
    this.guidedRerunBtn.classList.add("wmegj-guided-button--rerun");

    const restartActions = document.createElement("div");
    restartActions.className = "wmegj-guided-reset-actions";
    matchPane.appendChild(restartActions);

    this.guidedRestartBtn = this.appendGuidedButton(restartActions, {
      text: i18next.t("panel.matching.restartFromScratch"),
      variant: "danger",
      onClick: () => {
        this.onRestartFromScratchClick();
      },
    });
    this.guidedRestartBtn.classList.add("wmegj-guided-button--restart");

    this.setGuidedCollapsed(this.guidedCollapsed);
    this.updateGuidedControls();

    return section;
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
    this.renderPhase(this.store.getState().phase);
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

  private restoreGuidedPanelLayout(panel: HTMLElement): void {
    try {
      this.guidedCollapsed = localStorage.getItem(MatchingSubTab.PANEL_COLLAPSED_KEY) === "1";
      const raw = localStorage.getItem(MatchingSubTab.PANEL_POSITION_KEY);
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
    this.guidedBusy = isLoading;
    if (!this.guidedLoaderEl) return;
    if (message && this.guidedLoaderTextEl) {
      this.guidedLoaderTextEl.textContent = message;
    }
    this.guidedLoaderEl.style.display = isLoading ? "flex" : "none";
    this.updateGuidedControls();
  }

  private resetGuidedSessionState(options: { closePanel?: boolean } = {}): void {
    if (options.closePanel) {
      this.matchingPanelOpen = false;
    }
    this.guidedBusy = false;
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
    if (this.guidedInstructionEl) {
      this.guidedInstructionEl.textContent = i18next.t("panel.matching.validateOrCorrect");
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
        const controller = this.controller;
        const src = this.sourceStore.getSource();
        if (!controller || !src || !src.cursor) return [];
        const { lineIndex, subLineIndex } = src.cursor;
        const sub = src.lines[lineIndex]?.subLines[subLineIndex];
        if (!sub) return [];

        const set = new Set<number>();
        const unsubscribe = controller.onMatchFound((id) => set.add(id));
        try {
          await controller.matchInCurrentViewport(sub.kmA, sub.kmB);
        } finally {
          unsubscribe();
        }
        return [...set];
      },
    };
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
    if (this.guidedBusy) return;
    const pipeline = this.ensurePipeline();
    if (!pipeline) return;
    this.matchingActive = true;
    this.matchingPanelOpen = true;
    this.store.setPhase("matching");
    if (this.guidedInstructionEl) {
      this.guidedInstructionEl.textContent = i18next.t("panel.matching.validateOrCorrect");
    }
    await this.runStep(() => pipeline.stepUntilValidation());
  }

  private async onValidateClick(): Promise<void> {
    if (this.guidedBusy) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    const ids = this.readSelectionSegmentIds();
    pipeline.validate(ids);
    await this.runStep(() => pipeline.stepUntilValidation());
  }

  private async onSkipMatchingClick(): Promise<void> {
    if (this.guidedBusy) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    pipeline.validate([]);
    await this.runStep(() => pipeline.stepUntilValidation());
  }

  private async onBackMatchingClick(): Promise<void> {
    if (this.guidedBusy) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    pipeline.back();
    await this.runStep(() => pipeline.stepUntilValidation());
  }

  private async onRerunCurrentRowClick(): Promise<void> {
    if (this.guidedBusy) return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    pipeline.rerunCurrent();
    await this.runStep(() => pipeline.stepUntilValidation());
  }

  /** Run a pipeline step, surfacing the spinner and completion state. */
  private async runStep(step: () => Promise<void>): Promise<void> {
    this.setGuidedLoading(true, i18next.t("panel.matching.steps.unknown"));
    try {
      await step();
    } catch (err) {
      logger.error("MatchingSubTab.runStep: pipeline step failed", err);
    } finally {
      this.setGuidedLoading(false);
    }
    if (this.isSourceComplete()) {
      this.matchingActive = false;
      this.store.setPhase("done");
      const segments = this.countMatchedSegments();
      if (this.guidedSegmentCountEl) {
        this.guidedSegmentCountEl.textContent = i18next.t(
          "panel.matching.steps.completedSummary",
          { rowsValidated: this.countValidatedSubLines(), totalSegments: segments },
        );
      }
      this.trackLayer?.setHighlightedSlice(null);
    }
    this.updateGuidedControls();
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

  private onReselectMatchedClick(): void {
    const src = this.sourceStore.getSource();
    const cursor = src?.cursor;
    if (!src || !cursor) return;
    const sub = src.lines[cursor.lineIndex]?.subLines[cursor.subLineIndex];
    if (!sub) return;

    const loadedSegmentIds = new Set(
      this.wmeSDK.DataModel.Segments.getAll().map((segment) => segment.id),
    );
    const selectableIds = sub.segmentIds.filter((id) => loadedSegmentIds.has(id));
    if (selectableIds.length === 0) {
      logger.warn("MatchingSubTab.onReselectMatchedClick: no matched ids currently loaded");
      return;
    }
    try {
      this.wmeSDK.Editing.setSelection({
        selection: { ids: selectableIds, objectType: "segment" },
      });
    } catch (err) {
      logger.warn("MatchingSubTab.onReselectMatchedClick: setSelection failed", err);
    }
  }

  private onRestartFromScratchClick(): void {
    confirmModal({
      message: i18next.t("panel.matching.restartConfirm"),
      confirmLabel: i18next.t("panel.matching.restartFromScratch"),
      cancelLabel: i18next.t("panel.finalFields.cancel"),
    })
      .then((confirmed) => {
        if (!confirmed) return;
        const entry = this.registry.getSelected();
        if (!entry) return;
        this.persistence.clear(entry.id);
        this.lazyPipeline = null;
        this.matchingActive = false;
        const fresh = this.buildSourceForEntry(entry);
        this.sourceStore.hydrate(fresh);
        this.store.setPhase("csv-loaded");
        this.resetGuidedSessionState();
        this.renderSourceState();
      })
      .catch((err: unknown) => {
        logger.error("MatchPanel: restart confirm modal rejected", err);
      });
  }

  private updateGuidedControls(): void {
    const phase = this.store.getState().phase;
    const hasSource = this.sourceStore.getSource() !== null;
    const isDone = phase === "done";
    const isMatching = this.matchingActive && !isDone;
    const isWaiting = isMatching && !this.guidedBusy;
    const canStart = hasSource && !this.matchingActive && !isDone && !this.guidedBusy;

    this.setButtonDisabled(this.guidedStartBtn, !canStart);
    this.setButtonDisabled(this.guidedValidateBtn, !isWaiting);
    this.setButtonDisabled(this.guidedSkipBtn, !isWaiting);
    this.setButtonDisabled(this.guidedBackBtn, !isWaiting);
    this.setButtonDisabled(this.guidedReselectBtn, !isWaiting);
    this.setButtonDisabled(this.guidedRerunBtn, !isWaiting);
    this.setButtonDisabled(this.guidedRestartBtn, !hasSource);

    this.setButtonVisible(this.guidedStartBtn, canStart);
    this.setButtonVisible(this.guidedValidateBtn, isMatching);
    this.setButtonVisible(this.guidedSkipBtn, isMatching);
    this.setButtonVisible(this.guidedBackBtn, isMatching);
    this.setButtonVisible(this.guidedReselectBtn, isMatching);
    this.setButtonVisible(this.guidedRerunBtn, isMatching);
    this.setButtonVisible(this.guidedDoneCloseBtn, isDone);
    this.setButtonVisible(this.guidedRestartBtn, hasSource && !isDone);

    if (this.guidedStatusEl) {
      const key = this.guidedBusy
        ? "running"
        : isMatching
          ? "waiting"
          : isDone
            ? "done"
            : "ready";
      this.guidedStatusEl.textContent = i18next.t(`panel.matching.panelStatus.${key}`);
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

  // ---------------------------------------------------------------------------
  // Private — SourceStore-driven view updates (header / overlay / counts)
  // ---------------------------------------------------------------------------

  private renderSourceState(): void {
    const src = this.sourceStore.getSource();
    if (!src) {
      this.trackLayer?.setHighlightedSlice(null);
      return;
    }
    const cursor = src.cursor;
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
      this.guidedRowHeaderEl.textContent = this.formatHeader(src, cursor.lineIndex, cursor.subLineIndex);
    }

    // Segment count for the current sub-line.
    if (this.guidedSegmentCountEl && sub) {
      this.guidedSegmentCountEl.textContent = i18next.t("panel.matching.segmentsMatched", {
        count: sub.segmentIds.length,
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

  // ---------------------------------------------------------------------------
  // Private — range slider
  // ---------------------------------------------------------------------------

  private buildRangeSlider(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";
    section.style.marginTop = "8px";

    if (!this.trackLayer) {
      return section;
    }

    const totalKm = this.trackLayer.getTotalKm();
    if (totalKm <= 0) {
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

    let pendingFrame = 0;
    let pendingLo = 0;
    let pendingHi = totalKm;

    const layer = this.trackLayer;

    const apply = () => {
      let lo = Number(minInput.value);
      let hi = Number(maxInput.value);
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

  private renderPhase(phase: SessionPhase): void {
    const atLeastTrackLoaded = this.phaseGte(phase, "track-loaded");
    const atLeastCsvLoaded = this.phaseGte(phase, "csv-loaded");

    this.setRowVisible(this.trackLengthRow, atLeastTrackLoaded);
    this.setRowVisible(this.rangeSliderRow, atLeastTrackLoaded);
    this.setRowVisible(this.startMatchingRow, atLeastCsvLoaded);
    this.setRowVisible(this.guidedMatchingRow, this.matchingPanelOpen && atLeastCsvLoaded);
    this.setRowVisible(this.downloadRow, atLeastCsvLoaded);
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
  // Private — URL event handlers
  // ---------------------------------------------------------------------------

  private onLoadUrlClick(): void {
    const url = this.getUrlInputValue();
    if (!url) return;

    if (this.urlErrorEl) {
      this.urlErrorEl.style.display = "none";
      this.urlErrorEl.textContent = "";
    }

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

    const geometry = this.trackLayer?.getTrackGeometry() ?? null;
    if (!geometry && this.loadFn) {
      await this.loadFn(url);
    }

    const geom = this.trackLayer?.getTrackGeometry() ?? null;
    const bbox = geom ? bboxOfMultiLineString(geom) : null;
    if (!bbox) {
      logger.warn("MatchPanel.onCenterUrlClick: no track geometry available to center");
      return;
    }

    this.wmeSDK.Map.zoomToExtent({ bbox });
    logger.info("MatchPanel.onCenterUrlClick: centered map on track bbox", { url, bbox });
  }

  private getUrlInputValue(): string {
    if (!this.urlInputEl) return "";
    const asWz = this.urlInputEl as unknown as { value?: string };
    if (typeof asWz.value === "string") {
      return asWz.value.trim();
    }
    const nativeInput = this.urlInputEl.querySelector("input");
    return nativeInput ? nativeInput.value.trim() : "";
  }

  // ---------------------------------------------------------------------------
  // Private — export
  // ---------------------------------------------------------------------------

  private onDownloadClosuresClick(): void {
    const src = this.sourceStore.getSource();
    if (!src) {
      const message = i18next.t("panel.matching.noPipelineRun");
      logger.warn("MatchPanel: " + message);
      alert(message);
      return;
    }

    const closures = closuresFromSource(src);
    const hasAny =
      closures.mode === "global-times"
        ? closures.segmentIds.length > 0
        : closures.bySegment.length > 0;
    if (!hasAny) {
      const message = i18next.t("panel.matching.mustValidateFirst");
      logger.warn("MatchPanel: " + message);
      alert(message);
      return;
    }

    if (closures.mode === "global-times") {
      void this.downloadClosuresGlobalTimes(closures.segmentIds);
      return;
    }
    void this.downloadClosuresPerLine(closures.bySegment);
  }

  /** No CSV — collect a single global window then apply to all segments. */
  private async downloadClosuresGlobalTimes(segmentIds: number[]): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const slowupDate = this.registry.getSelected()?.slowupDetails?.date;
    const window = await promptClosureWindow({
      date: slowupDate ?? today,
      startTime: "09:00",
      endTime: "17:30",
    });
    if (!window) return;

    const fields = await promptFinalFields();
    if (!fields) return;

    const geo = this.exportGeo();
    const rows: CsvRow[] = [
      {
        distance: 0,
        date: window.startISO.slice(0, 10),
        startTime: window.startISO.slice(11, 16),
        endTime: window.endISO.slice(11, 16),
        segments: segmentIds.slice(),
      },
    ];
    const groups: ClosureRowGroup[] = [{ rowIndex: 0, segmentIds: segmentIds.slice(), geo }];
    const closuresBySegment: Record<number, ClosureRange[]> = {};
    for (const id of segmentIds) {
      closuresBySegment[id] = [
        { startISO: window.startISO, endISO: window.endISO, rowIndex: 0 },
      ];
    }

    this.emitClosuresCsv(rows, groups, closuresBySegment, fields);
  }

  /** CSV-derived per-line windows — no global window popup. */
  private async downloadClosuresPerLine(
    bySegment: ReadonlyArray<{ segmentId: number; windows: { startISO: string; endISO: string }[] }>,
  ): Promise<void> {
    const fields = await promptFinalFields();
    if (!fields) return;

    const geo = this.exportGeo();
    // Synthesize the legacy ClosureRowGroup/ClosureRange/CsvRow shapes:
    // one synthetic row per (segment, window).
    const rows: CsvRow[] = [];
    const groups: ClosureRowGroup[] = [];
    const closuresBySegment: Record<number, ClosureRange[]> = {};

    bySegment.forEach((entry) => {
      entry.windows.forEach((win) => {
        const rowIndex = rows.length;
        rows.push({
          distance: 0,
          date: win.startISO.slice(0, 10),
          startTime: win.startISO.slice(11, 16),
          endTime: win.endISO.slice(11, 16),
          segments: [entry.segmentId],
        });
        groups.push({ rowIndex, segmentIds: [entry.segmentId], geo });
        const existing = closuresBySegment[entry.segmentId] ?? [];
        existing.push({ startISO: win.startISO, endISO: win.endISO, rowIndex });
        closuresBySegment[entry.segmentId] = existing;
      });
    });

    this.emitClosuresCsv(rows, groups, closuresBySegment, fields);
  }

  /** RowGeo derived from the current map view — used as the closure anchor. */
  private exportGeo(): RowGeo {
    let lon = 0;
    let lat = 0;
    let zoom = 16;
    try {
      const center = this.wmeSDK.Map.getMapCenter();
      lon = center.lon;
      lat = center.lat;
      zoom = this.wmeSDK.Map.getZoomLevel();
    } catch (err) {
      logger.warn("MatchingSubTab.exportGeo: failed to read map view", err);
    }
    return { lon, lat, zoom };
  }

  private emitClosuresCsv(
    rows: CsvRow[],
    groups: ClosureRowGroup[],
    closuresBySegment: Record<number, ClosureRange[]>,
    fields: FinalFields,
  ): void {
    try {
      const csv = buildClosuresCsv(rows, groups, closuresBySegment, fields);
      this.triggerDownload(csv, "closures.csv", "text/csv");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("MatchingSubTab: buildClosuresCsv failed", err);
      alert(message);
    }
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

  private updateBadge(state: WalkState): void {
    this.headerView?.setBadge(state);
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
        padding: 12px;
        overflow-y: auto;
      }

      .wmegj-guided-meta,
      .wmegj-guided-row,
      .wmegj-guided-count,
      .wmegj-guided-instruction {
        margin: 0 0 8px 0;
        font-size: 12px;
      }

      .wmegj-guided-row {
        color: #1f2937;
        font-weight: 700;
      }

      .wmegj-guided-count {
        color: #344054;
      }

      .wmegj-guided-instruction {
        color: #667085;
      }

      .wmegj-guided-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        align-items: stretch;
      }

      .wmegj-guided-secondary-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        margin-top: 8px;
      }

      .wmegj-guided-reset-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #edf0f4;
      }

      .wmegj-guided-button {
        min-width: 0;
        min-height: 42px;
        padding: 9px 14px;
      }

      .wmegj-guided-button--validate,
      .wmegj-guided-button--start {
        background: #3478f6;
        border-color: #3478f6;
        color: #ffffff;
      }

      .wmegj-guided-button--validate:hover,
      .wmegj-guided-button--start:hover {
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

      .wmegj-guided-button--reselect,
      .wmegj-guided-button--rerun {
        background: #ffffff;
        border-color: #c7d0d9;
        color: #344054;
      }

      .wmegj-guided-button--restart {
        width: auto;
        min-width: 0;
        min-height: 34px;
        padding: 7px 12px;
      }

      .wmegj-guided-button:hover:not(:disabled) {
        filter: brightness(0.98);
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

      .wmegj-file-input {
        padding: 6px 8px;
      }
    `;
    container.appendChild(style);
  }
}
