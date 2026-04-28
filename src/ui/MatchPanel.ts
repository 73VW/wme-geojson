import type { WmeSDK } from "wme-sdk-typings";
import { bbox as turfBbox, length as turfLength } from "@turf/turf";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { NormalizedTrack } from "../geojson/types";
import type { TrackLayer } from "../layers/TrackLayer";
import type { WalkController } from "../controller/WalkController";
import type { WalkState } from "../controller/walkStates";

/**
 * Sidebar panel for Palier 2.
 *
 * Presentation-only: no business logic, no SDK calls beyond map navigation.
 * It renders track info, a status badge, and action buttons, then keeps itself
 * in sync with the WalkController via onStateChange.
 *
 * DOM is created with createElement/textContent only — no innerHTML with
 * external data, which avoids XSS vectors even though this runs as a
 * userscript.
 */
export class MatchPanel {
  private tabPane: HTMLElement | null = null;
  private unsubscribeState: (() => void) | null = null;

  // Elements that need to be updated on state change
  private badgeEl: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly controller: WalkController,
    private readonly track: NormalizedTrack,
    private readonly trackLayer: TrackLayer,
  ) {}

  /**
   * Register a sidebar tab, populate it, and wire up controller events.
   * Safe to call only once; a second call is a no-op (SDK throws on duplicate
   * scriptId registration anyway).
   */
  async mount(): Promise<void> {
    if (this.tabPane) {
      return;
    }

    let tabLabel: HTMLElement;
    let tabPane: HTMLElement;

    try {
      ({ tabLabel, tabPane } =
        await this.wmeSDK.Sidebar.registerScriptTab());
    } catch (err) {
      logger.error("MatchPanel.mount: failed to register sidebar tab", err);
      return;
    }

    // Label is a short abbreviation so it fits in the tab strip
    tabLabel.textContent = "GeoJ";

    this.tabPane = tabPane;
    this.buildDOM(tabPane);

    // Keep the badge and buttons in sync with controller transitions
    this.unsubscribeState = this.controller.onStateChange((s) => {
      this.updateState(s);
    });

    logger.info("MatchPanel mounted");
  }

  /**
   * Remove all DOM content from the tab pane and unsubscribe from the
   * controller.  Called when the track is unloaded or the script tears down.
   */
  unmount(): void {
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }

    if (this.tabPane) {
      while (this.tabPane.firstChild) {
        this.tabPane.removeChild(this.tabPane.firstChild);
      }
      this.tabPane = null;
    }

    this.badgeEl = null;
    this.startBtn = null;
    this.stopBtn = null;

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

    // Progress area (empty at Palier 2)
    const progress = document.createElement("p");
    progress.textContent = i18next.t("panel.progress.empty");
    container.appendChild(progress);

    // Results list (empty at Palier 2)
    const resultsList = document.createElement("ul");
    container.appendChild(resultsList);
  }

  private buildTrackInfo(): HTMLElement {
    const section = document.createElement("section");

    const idLine = document.createElement("p");
    const trackIdValue =
      this.track.trackId !== null ? String(this.track.trackId) : "—";
    idLine.textContent = i18next.t("panel.trackInfo.id", {
      id: trackIdValue,
    });
    section.appendChild(idLine);

    const lengthLine = document.createElement("p");
    // turfLength returns kilometres by default (units: "kilometers" is the
    // default), rounded to two decimal places for display.
    // turfLength expects a Feature or FeatureCollection, not a bare geometry,
    // so we wrap the MultiLineString in a Feature shell.
    const lengthKm = turfLength(
      {
        type: "Feature",
        geometry: this.track.geometry,
        properties: null,
      },
      { units: "kilometers" },
    ).toFixed(2);
    lengthLine.textContent = i18next.t("panel.trackInfo.length", {
      km: lengthKm,
    });
    section.appendChild(lengthLine);

    return section;
  }

  private buildButtons(): HTMLElement {
    const wrapper = document.createElement("div");

    // "Center on track" — always enabled, genuinely functional at Palier 2.
    // Uses Map.zoomToExtent (SDK line 4042) which accepts a GeoJSON BBox
    // [minLon, minLat, maxLon, maxLat].  This is the preferred method over
    // setMapCenter + setZoomLevel because it accounts for non-square bboxes.
    const centerBtn = document.createElement("button");
    centerBtn.textContent = i18next.t("panel.buttons.centerOnTrack");
    centerBtn.addEventListener("click", () => {
      this.centerOnTrack();
    });
    wrapper.appendChild(centerBtn);

    // "Start matching" — enabled in idle and done states
    const startBtn = document.createElement("button");
    startBtn.textContent = i18next.t("panel.buttons.start");
    startBtn.addEventListener("click", () => {
      this.controller.start();
    });
    wrapper.appendChild(startBtn);
    this.startBtn = startBtn;

    // "Stop" — visible only in walking state
    const stopBtn = document.createElement("button");
    stopBtn.textContent = i18next.t("panel.buttons.stop");
    stopBtn.addEventListener("click", () => {
      this.controller.stop();
    });
    wrapper.appendChild(stopBtn);
    this.stopBtn = stopBtn;

    // "Select all matched" — disabled at Palier 2 (no matches yet)
    const selectAllBtn = document.createElement("button");
    selectAllBtn.textContent = i18next.t("panel.buttons.selectAll");
    selectAllBtn.disabled = true;
    wrapper.appendChild(selectAllBtn);

    // Apply initial button visibility for the "idle" state
    this.applyButtonState(this.controller.state);

    return wrapper;
  }

  /**
   * Center the map on the bounding box of the loaded track.
   *
   * SDK method: Map.zoomToExtent (index.d.ts line 4042) — sets zoom to the
   * level that fits the given bbox, then calls setMapCenter implicitly.
   * This is cleaner than manually computing zoom from the bbox span.
   */
  private centerOnTrack(): void {
    // turfBbox returns [minLon, minLat, maxLon, maxLat] — exactly what
    // SDK's zoomToExtent expects as a GeoJSON BBox.
    const box = turfBbox(this.track.geometry);
    this.wmeSDK.Map.zoomToExtent({ bbox: box });
    logger.info("MatchPanel: centered on track bbox", box);
  }

  /**
   * Called on every state transition.  Updates the badge text and the
   * enabled/visible state of the action buttons.
   */
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

    // Start is available when no walk is currently in progress.
    // After cancel/error the user must be able to retry without reloading.
    const canStart =
      state === "idle" ||
      state === "done" ||
      state === "cancelled" ||
      state === "error";
    this.startBtn.disabled = !canStart;

    // Stop is meaningful only while walking
    const isWalking = state === "walking";
    this.stopBtn.style.display = isWalking ? "" : "none";
  }
}
