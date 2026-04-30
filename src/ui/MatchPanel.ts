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
import type { FinalFields, RowGeo } from "../csv/buildClosuresCsv";
import { wzButton, wzTextInput, fileInput } from "./components/wz";
import { MatchingPipeline } from "../controller/MatchingPipeline";
import { promptFinalFields } from "./promptFinalFields";
import { load as persistenceLoad, clearForCurrent } from "../persistence/sessionStorage";
import { confirmModal } from "./modal";


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

  // The tab label element returned by Sidebar.registerScriptTab(). Stored so
  // the pipeline can call tabLabel.click() to re-activate the userscript tab
  // after Editing.setSelection switches focus to the segment edit panel.
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

  /**
   * Return the tab label element so MatchingPipeline can re-activate the
   * userscript tab after each Editing.setSelection call.
   */
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
    this.guidedMatchingRow = null;

    logger.info("MatchPanel unmounted");
  }

  // ---------------------------------------------------------------------------
  // Private — DOM construction
  // ---------------------------------------------------------------------------

  private buildDOM(container: HTMLElement): void {
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

    // Load button — reads the value from the wz-text-input or native input
    const loadBtn = wzButton({
      text: i18next.t("panel.urlInput.load"),
      variant: "primary",
      onClick: () => {
        this.onLoadUrlClick();
      },
    });
    loadBtn.style.marginTop = "4px";
    section.appendChild(loadBtn);

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
      onFile: (file) => {
        this.onCsvFileSelected(file);
      },
    });
    section.appendChild(input);

    return section;
  }

  private buildStartMatchingRow(): HTMLElement {
    const section = document.createElement("section");
    section.className = "wmegj-section";
    section.style.marginTop = "8px";

    const btn = wzButton({
      text: i18next.t("panel.startMatching"),
      variant: "primary",
      onClick: () => {
        this.onStartMatchingClick();
      },
    });
    section.appendChild(btn);

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
    section.style.padding = "8px";
    section.style.border = "1px solid #ccc";
    section.style.borderRadius = "4px";

    const headerEl = document.createElement("p");
    headerEl.style.margin = "0 0 4px 0";
    headerEl.style.fontWeight = "600";
    headerEl.style.fontSize = "12px";
    headerEl.textContent = "—";
    section.appendChild(headerEl);
    this.guidedRowHeaderEl = headerEl;

    const instructionEl = document.createElement("p");
    instructionEl.style.margin = "0 0 4px 0";
    instructionEl.style.fontSize = "11px";
    instructionEl.style.color = "#555";
    instructionEl.textContent = i18next.t("panel.matching.validateOrCorrect");
    section.appendChild(instructionEl);

    const countEl = document.createElement("p");
    countEl.style.margin = "0 0 8px 0";
    countEl.style.fontSize = "12px";
    countEl.textContent = i18next.t("panel.matching.segmentsMatched", { count: 0 });
    section.appendChild(countEl);
    this.guidedSegmentCountEl = countEl;

    const btnRow = document.createElement("div");
    btnRow.className = "wmegj-button-stack";
    btnRow.style.display = "flex";
    btnRow.style.gap = "6px";

    const validateBtn = wzButton({
      text: i18next.t("panel.matching.validate"),
      variant: "primary",
      onClick: () => {
        this.pipeline?.validateCurrentRow();
      },
    });
    btnRow.appendChild(validateBtn);

    const skipBtn = wzButton({
      text: i18next.t("panel.matching.skip"),
      variant: "secondary",
      onClick: () => {
        this.pipeline?.skipCurrentRow();
      },
    });
    btnRow.appendChild(skipBtn);

    const backBtn = wzButton({
      text: i18next.t("panel.matching.back"),
      variant: "secondary",
      onClick: () => {
        this.pipeline?.goBackOneRow();
      },
    });
    btnRow.appendChild(backBtn);

    const pauseBtn = wzButton({
      text: i18next.t("panel.matching.pause"),
      variant: "secondary",
      onClick: () => {
        this.pipeline?.abort();
      },
    });
    btnRow.appendChild(pauseBtn);

    // Always-available escape hatch: discard all matched segments and start
    // again from row 0 with the same CSV (frozen user decision §2).
    const restartBtn = wzButton({
      text: i18next.t("panel.matching.restartFromScratch"),
      variant: "danger",
      onClick: () => {
        this.onRestartFromScratchClick();
      },
    });
    btnRow.appendChild(restartBtn);

    section.appendChild(btnRow);
    return section;
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

    const enrichedBtn = wzButton({
      text: i18next.t("panel.downloadEnriched"),
      variant: "secondary",
      onClick: () => {
        this.onDownloadEnrichedClick();
      },
    });
    section.appendChild(enrichedBtn);

    const closuresBtn = wzButton({
      text: i18next.t("panel.downloadClosures"),
      variant: "secondary",
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
  private renderResumeBanner(
    saved: SessionState,
    rows: CsvRow[],
    csvText: string,
  ): void {
    const banner = this.resumeBannerRow;
    if (!banner) return;

    // Clear any previous content (the same banner element is reused across
    // CSV uploads).
    while (banner.firstChild) banner.removeChild(banner.firstChild);

    const headerEl = document.createElement("p");
    headerEl.style.margin = "0 0 4px 0";
    headerEl.style.fontWeight = "600";
    headerEl.textContent = i18next.t("panel.resumeDetected");
    banner.appendChild(headerEl);

    const indexEl = document.createElement("p");
    indexEl.style.margin = "0 0 8px 0";
    indexEl.style.fontSize = "12px";
    indexEl.textContent = i18next.t("panel.resumeIndex", {
      index: saved.currentIndex,
      total: rows.length,
    });
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
    this.setRowVisible(this.startMatchingRow, atLeastCsvLoaded && !isMatching);
    this.setRowVisible(this.guidedMatchingRow, isMatching);
    this.setRowVisible(this.downloadRow, atLeastCsvLoaded);
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
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== "string") return;
      try {
        const rows = parseSchedule(text);
        // Cache so the restart-from-scratch button can re-load without asking
        // the user to re-upload the file.
        this.lastCsvText = text;
        this.lastCsvRows = rows;

        // Show only the labels whose distances appear in the CSV so the track
        // decorations match the pipeline waypoints from the start.
        if (this.trackLayer) {
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
        // Surface the parse error visually near the file input
        if (this.csvUploadRow) {
          let errEl = this.csvUploadRow.querySelector<HTMLElement>(".wmegj-csv-error");
          if (!errEl) {
            errEl = document.createElement("p");
            errEl.className = "wmegj-csv-error";
            errEl.style.color = "#c0392b";
            errEl.style.fontSize = "11px";
            errEl.style.margin = "2px 0 0 0";
            this.csvUploadRow.appendChild(errEl);
          }
          errEl.textContent = message;
        }
      }
    };
    reader.readAsText(file);
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

    const rowGeos = this.getExportRowGeos(csvRows);
    if (!rowGeos) {
      return;
    }

    promptFinalFields()
      .then((fields: FinalFields | null) => {
        if (!fields) return;

        try {
          // rowGeos is indexed parallel to csvRows; cast to the RowGeo type
          // expected by buildClosuresCsv (same shape — lon/lat/zoom).
          const csv = buildClosuresCsv(
            csvRows,
            rowGeos,
            closuresBySegment,
            fields,
          );
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

  private getExportRowGeos(rows: readonly CsvRow[]): RowGeo[] | null {
    const rowGeos = (this.pipeline?.getRowGeos() ?? []) as RowGeo[];
    const missingGeoIndex = rows.findIndex(
      (row, index) => row.segments !== null && row.segments.length > 0 && rowGeos[index] === undefined,
    );

    if (missingGeoIndex === -1) {
      return rowGeos;
    }

    const message = i18next.t("panel.matching.missingRowGeo", {
      index: missingGeoIndex + 1,
    });
    logger.warn("MatchPanel: " + message);
    alert(message);
    return null;
  }

  private onStartMatchingClick(): void {
    const { csvRows, geojsonUrl } = this.store.getState();

    logger.info("MatchPanel.onStartMatchingClick: clicked", {
      rowCount: csvRows.length,
      geojsonUrl,
      hasController: this.controller !== null,
      hasTrackLayer: this.trackLayer !== null,
      hasTabLabel: this.tabLabel !== null,
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

    const tabLabel = this.tabLabel;
    if (!tabLabel) {
      logger.warn("MatchPanel.onStartMatchingClick: tabLabel not available (not mounted?)");
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

    logger.info("MatchPanel.onStartMatchingClick: switching store phase to matching");
    this.store.setPhase("matching");

    logger.info("MatchPanel.onStartMatchingClick: creating MatchingPipeline", {
      rowCount: csvRows.length,
      currentIndex: this.store.getState().currentIndex,
    });
    this.pipeline = new MatchingPipeline(
      this.wmeSDK,
      this.store,
      this.controller,
      track,
      this.trackLayer,
      {
        onRowStarted: (index, total) => {
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
            this.guidedSegmentCountEl.textContent = i18next.t(
              "panel.matching.segmentsMatched",
              { count: 0 },
            );
          }
        },
        onRowMatched: (_index, segments) => {
          if (this.guidedSegmentCountEl) {
            this.guidedSegmentCountEl.textContent = i18next.t(
              "panel.matching.segmentsMatched",
              { count: segments.length },
            );
          }
        },
        onError: (message) => {
          logger.error("MatchingPipeline error:", message);
        },
        onDone: () => {
          logger.info("MatchPanel.onStartMatchingClick: pipeline reported done");
          this.store.setPhase("done");
        },
        onAborted: () => {
          logger.info("MatchPanel.onStartMatchingClick: pipeline reported aborted");
          // Return to csv-loaded phase so the user can restart
          this.store.setPhase("csv-loaded");
        },
      },
      tabLabel,
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
        font-size: 15px;
        font-weight: 700;
      }

      .wmegj-section {
        margin-bottom: 10px;
        padding: 10px;
        border: 1px solid #d8dee6;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
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
        border: 1px solid transparent;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
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

      .wmegj-button-stack {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .wmegj-guided-panel {
        border-color: #b9d9c3;
        background: linear-gradient(180deg, #fbfefc 0%, #f4fbf6 100%);
      }

      .wmegj-guided-overlay {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: min(360px, calc(100vw - 24px));
        margin: 0;
        z-index: 2200;
        box-shadow: 0 12px 28px rgba(16, 24, 40, 0.18);
      }

      @media (max-width: 640px) {
        .wmegj-guided-overlay {
          right: 12px;
          left: 12px;
          bottom: 12px;
          width: auto;
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
