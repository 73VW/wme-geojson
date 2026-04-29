import type { WmeSDK } from "wme-sdk-typings";
import { bbox as turfBbox, length as turfLength } from "@turf/turf";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { NormalizedTrack } from "../geojson/types";
import type { TrackLayer } from "../layers/TrackLayer";
import type { WalkController } from "../controller/WalkController";
import type { WalkState } from "../controller/walkStates";
import { confirmModal } from "./modal";

/**
 * If the user tries to select more than this many segments at once, we show
 * a confirmation modal to warn that large selections may be slow or fail.
 * This is a code-level constant; it is NOT configurable through the UI
 * (Palier 6 scope if ever needed).
 */
export const LARGE_SELECTION_THRESHOLD = 200;

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
  private unsubscribeSelectionChanged: (() => void) | null = null;

  // Elements updated after mount
  private badgeEl: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private selectAllBtn: HTMLButtonElement | null = null;
  private progressEl: HTMLElement | null = null;
  private resultsCountEl: HTMLElement | null = null;
  private resultsEmptyEl: HTMLElement | null = null;
  private resultsList: HTMLUListElement | null = null;
  private selectionErrorEl: HTMLElement | null = null;

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

    // Selection-changed events → highlight the matching list item.
    // The event payload is `undefined` per the SDK typings; we read the current
    // selection with getSelection() when the event fires.
    this.unsubscribeSelectionChanged = this.wmeSDK.Events.on({
      eventName: "wme-selection-changed",
      eventHandler: () => {
        this.syncActiveItem();
      },
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
    this.unsubscribeSelectionChanged?.();
    this.unsubscribeState = null;
    this.unsubscribeProgress = null;
    this.unsubscribeMatchFound = null;
    this.unsubscribeSelectionChanged = null;

    if (this.tabPane) {
      while (this.tabPane.firstChild) {
        this.tabPane.removeChild(this.tabPane.firstChild);
      }
      this.tabPane = null;
    }

    this.badgeEl = null;
    this.startBtn = null;
    this.stopBtn = null;
    this.selectAllBtn = null;
    this.progressEl = null;
    this.resultsCountEl = null;
    this.resultsEmptyEl = null;
    this.resultsList = null;
    this.selectionErrorEl = null;

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

    // Distance range slider (filters which portion of the track is drawn)
    container.appendChild(this.buildRangeSlider());

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
    const trackIdValue = this.track.trackId !== null ? String(this.track.trackId) : "—";
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

  /**
   * Two-handle range slider that controls which kilometre window of the track
   * is rendered on the map. Implemented as two stacked native range inputs
   * since HTML lacks a built-in dual slider; the handlers enforce that the
   * lower handle stays ≤ the upper one.
   */
  private buildRangeSlider(): HTMLElement {
    const section = document.createElement("section");
    section.style.marginTop = "8px";

    const totalKm = this.trackLayer.getTotalKm();
    if (totalKm <= 0) {
      // Nothing meaningful to filter on (e.g. degenerate single-point track)
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

    // Use a hundredth-of-a-km step regardless of total length; the input
    // coerces to a sensible number of stops automatically.
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
    // track, so without coalescing the queue grows unbounded and the UI
    // freezes. We update the text label synchronously (cheap) and schedule
    // exactly one trackLayer.setVisibleRange per frame.
    let pendingFrame = 0;
    let pendingLo = 0;
    let pendingHi = totalKm;

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
          this.trackLayer.setVisibleRange(pendingLo, pendingHi);
        });
      }
    };

    minInput.addEventListener("input", apply);
    maxInput.addEventListener("input", apply);

    section.appendChild(minInput);
    section.appendChild(maxInput);

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

    // "Select all matched" — enabled once at least one match has been found.
    // The click handler shows a confirmation modal for large selections, then
    // delegates the actual SDK call to controller.selectAll().
    const selectAllBtn = document.createElement("button");
    selectAllBtn.textContent = i18next.t("panel.buttons.selectAll");
    selectAllBtn.disabled = true;
    selectAllBtn.addEventListener("click", () => {
      // Fire-and-forget; errors are rendered inline by the async handler.
      this.onSelectAllClick().catch((err: unknown) => {
        logger.error("MatchPanel: onSelectAllClick rejected unexpectedly", err);
      });
    });
    wrapper.appendChild(selectAllBtn);
    this.selectAllBtn = selectAllBtn;

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
   * The item is a clickable <button> that navigates to and selects the segment.
   * Also enables the "Select all matched" button on the first match.
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

    // Enable "Select all matched" now that at least one segment is available.
    if (this.selectAllBtn) {
      this.selectAllBtn.disabled = false;
    }

    if (!this.resultsList) return;

    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = i18next.t("panel.results.item", { id });
    btn.setAttribute("data-segment-id", String(id));
    btn.addEventListener("click", () => {
      this.onItemClick(id, li);
    });
    li.appendChild(btn);
    this.resultsList.appendChild(li);
  }

  /**
   * Handle a click on a result item button.
   *
   * Delegates SDK work to controller.focusSegment (which owns Map + Editing
   * calls), then handles the per-item error display if focus fails.
   * The try/catch ensures a single broken item does not affect the rest of
   * the list.
   */
  private onItemClick(id: number, li: HTMLElement): void {
    // Fire-and-forget; use explicit .catch to surface errors to the item.
    this.controller.focusSegment(id).catch((err: unknown) => {
      logger.warn(`MatchPanel: focusSegment failed for id=${id}`, err);
      this.showItemError(li);
    });
  }

  /**
   * Show a per-item "unavailable" error label inside the given list element.
   * Safe to call multiple times: a second call on the same item is a no-op.
   */
  private showItemError(li: HTMLElement): void {
    // Guard against duplicate error nodes if the user clicks the failing item
    // multiple times before the first error renders.
    if (li.querySelector(".wme-geojson-item-error")) return;

    const errSpan = document.createElement("span");
    errSpan.className = "wme-geojson-item-error";
    errSpan.textContent = ` ${i18next.t("panel.results.unavailable")}`;
    li.appendChild(errSpan);
  }

  /**
   * Handle the "Select all matched" button click.
   *
   * Architecture note (Palier 5):
   *  - Modal-prompting logic lives HERE (UI concern): we decide whether to ask
   *    the user based on count, and we render the error on failure.
   *  - The actual SDK setSelection call lives in controller.selectAll()
   *    (controller concern): it stays SDK-coupled and outside ui/.
   *
   * The method is async to await the confirmation modal for large selections.
   */
  private async onSelectAllClick(): Promise<void> {
    const ids = this.controller.getMatchedIds();
    const count = ids.length;

    if (count === 0) {
      // Button should already be disabled; guard defensively.
      logger.warn("MatchPanel: selectAll clicked with 0 matches");
      return;
    }

    // For large selections, ask the user to confirm before proceeding.
    const needsConfirmation = count > LARGE_SELECTION_THRESHOLD;
    if (needsConfirmation) {
      const confirmed = await confirmModal({
        message: i18next.t("panel.modal.largeSelectionWarning", { count }),
        confirmLabel: i18next.t("panel.buttons.selectAllConfirm"),
        cancelLabel: i18next.t("panel.buttons.cancel"),
      });

      if (!confirmed) {
        // User cancelled — do nothing. Leave the results list intact.
        return;
      }
    }

    // Delegate the SDK call to the controller and render any error inline.
    try {
      this.clearSelectionError();
      this.controller.selectAll();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("MatchPanel: selectAll failed", err);
      this.showSelectionError(errorMessage);
    }
  }

  /**
   * Render an inline error message below the button row.
   * Does NOT clear or destroy the results list so the user can still click
   * individual items after a failed "select all" attempt.
   *
   * If an error element already exists, updates its text in-place.
   */
  private showSelectionError(errorMessage: string): void {
    if (!this.tabPane) return;

    const text = i18next.t("panel.errors.selectionFailed", { error: errorMessage });

    if (this.selectionErrorEl) {
      this.selectionErrorEl.textContent = text;
      return;
    }

    const errEl = document.createElement("p");
    errEl.className = "wme-geojson-selection-error";
    errEl.textContent = text;
    errEl.style.color = "#c0392b";

    // Insert the error paragraph after the progress element (before the
    // results section) so it is visible without scrolling the panel.
    if (this.progressEl && this.progressEl.nextSibling) {
      this.tabPane.insertBefore(errEl, this.progressEl.nextSibling);
    } else {
      this.tabPane.appendChild(errEl);
    }

    this.selectionErrorEl = errEl;
  }

  /**
   * Remove the inline selection error element if it exists.
   */
  private clearSelectionError(): void {
    if (this.selectionErrorEl) {
      this.selectionErrorEl.parentNode?.removeChild(this.selectionErrorEl);
      this.selectionErrorEl = null;
    }
  }

  /**
   * Read the current selection and apply the `wme-geojson-active` CSS class
   * to the list item(s) whose segment ID is in the selection.  Remove the
   * class from all other items.
   *
   * CSS-class-only approach: avoids mutating button text (which would require
   * careful cleanup) and keeps the highlight purely presentational.  If the
   * i18n `(active)` label is ever needed, it can be injected via a CSS
   * `::after` rule without touching this code.
   */
  private syncActiveItem(): void {
    if (!this.resultsList) return;

    const selection = this.wmeSDK.Editing.getSelection();

    // Build the set of currently-selected segment IDs for fast lookup.
    const selectedIds = new Set<number>();
    if (selection && selection.objectType === "segment") {
      for (const id of selection.ids) {
        selectedIds.add(id);
      }
    }

    const items = this.resultsList.querySelectorAll<HTMLElement>("[data-segment-id]");
    for (const btn of items) {
      const rawId = btn.getAttribute("data-segment-id");
      if (!rawId) continue;
      const segId = Number(rawId);
      const isActive = selectedIds.has(segId);
      btn.classList.toggle("wme-geojson-active", isActive);
    }
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

    // Disable "Select all matched" until new matches accumulate.
    if (this.selectAllBtn) {
      this.selectAllBtn.disabled = true;
    }

    // Clear any leftover selection error from a previous attempt.
    this.clearSelectionError();
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
      state === "idle" || state === "done" || state === "cancelled" || state === "error";
    this.startBtn.disabled = !canStart;

    const isWalking = state === "walking";
    this.stopBtn.style.display = isWalking ? "" : "none";
  }
}
