import type { WmeSDK } from "wme-sdk-typings";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { TrackLayer } from "../layers/TrackLayer";
import type { WalkController } from "../controller/WalkController";
import type { WalkState } from "../controller/walkStates";
import type { SessionStore, SessionPhase } from "../state/SessionStore";
import { parseSchedule } from "../csv/parseSchedule";
import { serializeSchedule } from "../csv/serializeSchedule";
import { buildClosuresCsv } from "../csv/buildClosuresCsv";
import type { FinalFields, RowGeo } from "../csv/buildClosuresCsv";
import { wzButton, wzTextInput, fileInput } from "./components/wz";


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
  private downloadRow: HTMLElement | null = null;
  private resumeBannerRow: HTMLElement | null = null;

  // URL input — updated to show load error inline
  private urlInputEl: HTMLElement | null = null;
  private urlErrorEl: HTMLElement | null = null;

  // State badge driven by WalkController
  private badgeEl: HTMLElement | null = null;

  // Pending slider frame (rAF coalescing — see buildRangeSlider)
  private _onRangeChanged: (() => void) | null = null;

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
    this.tabPane = tabPane;
    this.injectStyles(tabPane);
    this.buildDOM(tabPane);

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

    logger.info("MatchPanel unmounted");
  }

  // ---------------------------------------------------------------------------
  // Private — DOM construction
  // ---------------------------------------------------------------------------

  private buildDOM(container: HTMLElement): void {
    const title = document.createElement("h3");
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

    // Row 5 — Start matching button (hidden until csv-loaded)
    this.startMatchingRow = this.buildStartMatchingRow();
    container.appendChild(this.startMatchingRow);

    // Row 6 — Download buttons (hidden until csv-loaded)
    this.downloadRow = this.buildDownloadRow();
    container.appendChild(this.downloadRow);

    // Row 7 — Resume banner placeholder (populated by Lot 5)
    this.resumeBannerRow = this.buildResumeBannerRow();
    container.appendChild(this.resumeBannerRow);
  }

  private buildUrlRow(): HTMLElement {
    const section = document.createElement("section");
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
    section.style.marginTop = "8px";

    const btn = wzButton({
      text: i18next.t("panel.startMatching"),
      variant: "primary",
      onClick: () => {
        // Lot 3 will replace this click handler with the real pipeline.
        // For now we advance the phase to let downstream rows become visible.
        logger.warn("matching pipeline not wired yet — Lot 3");
        this.store.setPhase("matching");
      },
    });
    section.appendChild(btn);

    return section;
  }

  private buildDownloadRow(): HTMLElement {
    const section = document.createElement("section");
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
    section.style.marginTop = "8px";
    // Lot 5 will populate this via maybeShowResumeBanner().
    this.maybeShowResumeBanner();
    return section;
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

    this.setRowVisible(this.trackLengthRow, atLeastTrackLoaded);
    this.setRowVisible(this.rangeSliderRow, atLeastTrackLoaded);
    this.setRowVisible(this.csvUploadRow, atLeastTrackLoaded);
    this.setRowVisible(this.startMatchingRow, atLeastCsvLoaded);
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
        this.store.setCsvRows(rows);
        this.store.setPhase("csv-loaded");

        // Show only the labels whose distances appear in the CSV so the track
        // decorations match the pipeline waypoints from the start (Lot 2 default).
        if (this.trackLayer) {
          const distanceKeys = rows.map((r) => r.distance);
          this.trackLayer.setVisibleDistances(distanceKeys);
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
    // Lot 3 will wire promptFinalFields here. For now we emit a header-only
    // stub so the download is not broken and the user can see the format.
    const dummyFields: FinalFields = {
      reason: "stub",
      ignoreTraffic: true,
      mteId: "",
      comment: "",
    };
    // Empty rows / geos / closures — Lot 3 will pass real data.
    const emptyGeos: RowGeo[] = [];
    try {
      const csv = buildClosuresCsv([], emptyGeos, {}, dummyFields);
      this.triggerDownload(csv, "closures.csv", "text/csv");
    } catch (err) {
      logger.error("MatchPanel: buildClosuresCsv failed in stub mode", err);
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
    if (this.badgeEl) {
      this.badgeEl.textContent = i18next.t(`panel.status.${state}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — resume banner (Lot 5 wires detection; no-op for now)
  // ---------------------------------------------------------------------------

  /**
   * Check whether a saved session exists for the current (geojsonUrl, csvText)
   * pair and, if so, show a resume banner with "Continue" and "Start fresh"
   * buttons. No-op for now — Lot 5 implements the detection and UI.
   *
   * TODO (Lot 5): call sessionStorage.load(url, csvText) here, render the
   * banner, and wire the "Start fresh" button to sessionStorage.clearForCurrent
   * followed by store.reset().
   */
  private maybeShowResumeBanner(): void {
    // no-op placeholder — Lot 5
  }

  // ---------------------------------------------------------------------------
  // Private — CSS injection
  // ---------------------------------------------------------------------------

  private injectStyles(container: HTMLElement): void {
    const style = document.createElement("style");
    style.textContent = `
      .wmegj-file-input {
        display: block;
        margin-top: 4px;
        font-size: 12px;
        cursor: pointer;
      }
    `;
    container.appendChild(style);
  }
}
