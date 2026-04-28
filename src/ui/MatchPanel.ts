import type { WmeSDK } from "wme-sdk-typings";
import { bbox as turfBbox, length as turfLength } from "@turf/turf";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { NormalizedTrack } from "../geojson/types";
import type { TrackLayer } from "../layers/TrackLayer";
import type { WalkController } from "../controller/WalkController";
import type { WalkState } from "../controller/walkStates";

/**
 * Sidebar panel for Palier 3.
 *
 * Presentation-only: no business logic, no SDK calls beyond map navigation.
 * It renders track info, a status badge, action buttons, a progress counter,
 * and a live results list that populates as segments are matched.
 *
 * DOM is created with createElement/textContent only — no innerHTML with
 * external data (avoids XSS even in userscript context).
 */
export class MatchPanel {
  private tabPane: HTMLElement | null = null;

  // Unsubscribe handles — cleaned up in unmount()
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeProgress: (() => void) | null = null;
  private unsubscribeMatchFound: (() => void) | null = null;

  // Elements updated after mount
  private badgeEl: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private progressEl: HTMLElement | null = null;
  private resultsCountEl: HTMLElement | null = null;
  private resultsEmptyEl: HTMLElement | null = null;
  private resultsList: HTMLUListElement | null = null;

  /** Total matched segment count across all cells. */
  private matchedCount = 0;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly controller: WalkController,
    private readonly track: NormalizedTrack,
    private readonly trackLayer: TrackLayer,
  ) {}

  /**
   * Register a sidebar tab, populate it, and wire up controller events.
   * Safe to call only once; a second call is a no-op.
   */
  async mount(): Promise<void> {
    if (this.tabPane) {
      return;
    }

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
    this.buildDOM(tabPane);

    // State changes → badge + button visibility, and reset the results list
    // when a new walk starts so stale items from a prior run don't accumulate.
    this.unsubscribeState = this.controller.onStateChange((s) => {
      if (s === "walking") {
        this.resetResults();
      }
      this.updateState(s);
    });

    // Progress updates → live counter
    this.unsubscribeProgress = this.controller.onProgress((visited, total, _newIds) => {
      if (this.progressEl) {
        this.progressEl.textContent = i18next.t("panel.progress.running", {
          visited,
          total,
        });
      }
    });

    // Match-found events → append list item
    this.unsubscribeMatchFound = this.controller.onMatchFound((id, _geometry) => {
      this.appendResultItem(id);
    });

    logger.info("MatchPanel mounted");
  }

  /**
   * Remove all DOM content and unsubscribe from the controller.
   */
  unmount(): void {
    this.unsubscribeState?.();
    this.unsubscribeProgress?.();
    this.unsubscribeMatchFound?.();
    this.unsubscribeState = null;
    this.unsubscribeProgress = null;
    this.unsubscribeMatchFound = null;

    if (this.tabPane) {
      while (this.tabPane.firstChild) {
        this.tabPane.removeChild(this.tabPane.firstChild);
      }
      this.tabPane = null;
    }

    this.badgeEl = null;
    this.startBtn = null;
    this.stopBtn = null;
    this.progressEl = null;
    this.resultsCountEl = null;
    this.resultsEmptyEl = null;
    this.resultsList = null;

    logger.info("MatchPanel unmounted");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildDOM(container: HTMLElement): void {
    // Title
    const title = document.createElement("h3");
    title.textContent = i18next.t("panel.title");
    container.appendChild(title);

    // Track info section
    container.appendChild(this.buildTrackInfo());

    // Status badge
    const badgeWrapper = document.createElement("p");
    const badge = document.createElement("strong");
    badge.textContent = i18next.t(`panel.status.${this.controller.state}`);
    badgeWrapper.appendChild(badge);
    container.appendChild(badgeWrapper);
    this.badgeEl = badge;

    // Buttons
    container.appendChild(this.buildButtons());

    // Progress area
    const progress = document.createElement("p");
    progress.textContent = i18next.t("panel.progress.empty");
    container.appendChild(progress);
    this.progressEl = progress;

    // Results section
    container.appendChild(this.buildResultsSection());
  }

  private buildTrackInfo(): HTMLElement {
    const section = document.createElement("section");

    const idLine = document.createElement("p");
    const trackIdValue =
      this.track.trackId !== null ? String(this.track.trackId) : "—";
    idLine.textContent = i18next.t("panel.trackInfo.id", { id: trackIdValue });
    section.appendChild(idLine);

    const lengthLine = document.createElement("p");
    const lengthKm = turfLength(
      { type: "Feature", geometry: this.track.geometry, properties: null },
      { units: "kilometers" },
    ).toFixed(2);
    lengthLine.textContent = i18next.t("panel.trackInfo.length", { km: lengthKm });
    section.appendChild(lengthLine);

    return section;
  }

  private buildButtons(): HTMLElement {
    const wrapper = document.createElement("div");

    // "Center on track" — always enabled; uses Map.zoomToExtent (SDK line 4042).
    const centerBtn = document.createElement("button");
    centerBtn.textContent = i18next.t("panel.buttons.centerOnTrack");
    centerBtn.addEventListener("click", () => {
      this.centerOnTrack();
    });
    wrapper.appendChild(centerBtn);

    // "Start matching" — enabled in idle, done, cancelled, error states.
    const startBtn = document.createElement("button");
    startBtn.textContent = i18next.t("panel.buttons.start");
    startBtn.addEventListener("click", () => {
      // start() is async; fire-and-forget here — progress events drive the UI.
      // A .catch is required because `void` would silently swallow rejections
      // and the controller transitions to `error` rather than throw, but a
      // catastrophic crash before the first transition still bubbles here.
      this.controller.start().catch((err: unknown) => {
        logger.error("MatchPanel: controller.start rejected", err);
      });
    });
    wrapper.appendChild(startBtn);
    this.startBtn = startBtn;

    // "Stop" — visible only while walking.
    const stopBtn = document.createElement("button");
    stopBtn.textContent = i18next.t("panel.buttons.stop");
    stopBtn.addEventListener("click", () => {
      this.controller.stop();
    });
    wrapper.appendChild(stopBtn);
    this.stopBtn = stopBtn;

    // "Select all matched" — disabled at Palier 3 (Palier 5 wires this).
    const selectAllBtn = document.createElement("button");
    selectAllBtn.textContent = i18next.t("panel.buttons.selectAll");
    selectAllBtn.disabled = true;
    wrapper.appendChild(selectAllBtn);

    // Apply initial visibility for idle state.
    this.applyButtonState(this.controller.state);

    return wrapper;
  }

  private buildResultsSection(): HTMLElement {
    const section = document.createElement("section");

    // Count header — hidden initially (shown once first match arrives).
    const countEl = document.createElement("p");
    countEl.textContent = i18next.t("panel.results.count", { count: 0 });
    countEl.style.display = "none";
    section.appendChild(countEl);
    this.resultsCountEl = countEl;

    // "No matches yet" placeholder.
    const emptyEl = document.createElement("p");
    emptyEl.textContent = i18next.t("panel.results.empty");
    section.appendChild(emptyEl);
    this.resultsEmptyEl = emptyEl;

    // The actual results list.
    const list = document.createElement("ul");
    section.appendChild(list);
    this.resultsList = list;

    return section;
  }

  /**
   * Append a single result item for a newly-matched segment.
   * The item is a <button> element (clicking does nothing at Palier 3;
   * Palier 4 wires click-to-recenter).
   */
  private appendResultItem(id: number): void {
    this.matchedCount++;

    // Hide the "empty" placeholder once the first item arrives.
    if (this.resultsEmptyEl) {
      this.resultsEmptyEl.style.display = "none";
    }

    // Update the count header.
    if (this.resultsCountEl) {
      this.resultsCountEl.style.display = "";
      this.resultsCountEl.textContent = i18next.t("panel.results.count", {
        count: this.matchedCount,
      });
    }

    if (!this.resultsList) return;

    const li = document.createElement("li");
    // Render as a button so Palier 4 can attach a click handler easily.
    // The button does nothing at this palier — clicking is intentionally a no-op.
    const btn = document.createElement("button");
    btn.textContent = i18next.t("panel.results.item", { id });
    btn.setAttribute("data-segment-id", String(id));
    li.appendChild(btn);
    this.resultsList.appendChild(li);
  }

  /**
   * Center the map on the bounding box of the loaded track.
   * SDK: Map.zoomToExtent (index.d.ts line 4042).
   */
  private centerOnTrack(): void {
    const box = turfBbox(this.track.geometry);
    this.wmeSDK.Map.zoomToExtent({ bbox: box });
    logger.info("MatchPanel: centered on track bbox", box);
  }

  /**
   * Wipe the results list, count header, and matched counter back to their
   * post-mount empty state. Called whenever the controller transitions into
   * `walking` so a re-run doesn't append onto leftover items.
   */
  private resetResults(): void {
    this.matchedCount = 0;

    if (this.resultsList) {
      while (this.resultsList.firstChild) {
        this.resultsList.removeChild(this.resultsList.firstChild);
      }
    }
    if (this.resultsCountEl) {
      this.resultsCountEl.style.display = "none";
      this.resultsCountEl.textContent = i18next.t("panel.results.count", {
        count: 0,
      });
    }
    if (this.resultsEmptyEl) {
      this.resultsEmptyEl.style.display = "";
    }
    if (this.progressEl) {
      this.progressEl.textContent = i18next.t("panel.progress.empty");
    }
  }

  private updateState(state: WalkState): void {
    if (this.badgeEl) {
      this.badgeEl.textContent = i18next.t(`panel.status.${state}`);
    }
    this.applyButtonState(state);
  }

  private applyButtonState(state: WalkState): void {
    if (!this.startBtn || !this.stopBtn) {
      return;
    }

    const canStart =
      state === "idle" ||
      state === "done" ||
      state === "cancelled" ||
      state === "error";
    this.startBtn.disabled = !canStart;

    const isWalking = state === "walking";
    this.stopBtn.style.display = isWalking ? "" : "none";
  }
}
