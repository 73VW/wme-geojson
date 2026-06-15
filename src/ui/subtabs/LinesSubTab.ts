// Controller for the "Lignes" sub-tab: owns the LinesListView, drives URL
// loading through the injected loadFn, and reflects LineRegistry state.

import { i18next } from "../../../locales/i18n";
import { computeDisplayName } from "../../lines/displayName";
import { logger } from "../../utils/logger";
import type { LineRegistry } from "../../lines/LineRegistry";
import type { LineEntry } from "../../lines/types";
import { fetchSlowupDetails } from "../../lines/slowupClient";
import { parseSlowupDateUTC } from "../../lines/slowupDate";
import { LinesListView } from "../views/LinesListView";

export interface LinesSubTabDeps {
  registry: LineRegistry;
  /** Fetches the URL and populates the registry. Handles its own errors. */
  loadFn: (url: string) => Promise<void>;
  /** Called after a line is selected, so the shell can switch sub-tabs. */
  onLineSelected: () => void;
  /** Zooms the WME map to the bounding box of all loaded lines. */
  onCenterAll: () => void;
  /** Zooms the WME map to the bounding box of a single line. */
  onCenterLine: (id: string) => void;
}

function parseSortableSlowupDate(date: string | undefined): number | null {
  if (typeof date !== "string") {
    return null;
  }

  const parsed = parseSlowupDateUTC(date);
  return parsed === null ? null : parsed.getTime();
}

function sortSlowupEntries(entries: readonly LineEntry[]): LineEntry[] {
  const sortableSlowupEntries = entries
    .filter((entry) => parseSortableSlowupDate(entry.slowupDetails?.date) !== null)
    .sort((left, right) => {
      const leftDate = parseSortableSlowupDate(left.slowupDetails?.date);
      const rightDate = parseSortableSlowupDate(right.slowupDetails?.date);

      if (leftDate === null || rightDate === null) {
        return 0;
      }

      return leftDate - rightDate;
    });

  let sortableIndex = 0;

  return entries.map((entry) => {
    if (parseSortableSlowupDate(entry.slowupDetails?.date) === null) {
      return entry;
    }

    const sortedEntry = sortableSlowupEntries[sortableIndex];
    sortableIndex += 1;
    return sortedEntry ?? entry;
  });
}

export class LinesSubTab {
  readonly root: HTMLElement;
  private readonly view: LinesListView;
  private readonly deps: LinesSubTabDeps;
  private readonly unsubscribeLinesChanged: () => void;
  private readonly unsubscribeEntryUpdated: () => void;

  constructor(deps: LinesSubTabDeps) {
    this.deps = deps;
    this.view = new LinesListView({
      onLoadUrl: (url) => void this.handleLoad(url),
      onSelect: (id) => this.handleSelect(id),
      onCenterAll: deps.onCenterAll,
      onCenterLine: deps.onCenterLine,
    });
    this.root = this.view.root;

    this.view.setEntries(sortSlowupEntries(deps.registry.getAll()));
    this.unsubscribeLinesChanged = deps.registry.onLinesChanged(() => {
      const entries = deps.registry.getAll();
      this.view.setEntries(sortSlowupEntries(entries));
      void this.fetchSlowupDetailsForLines(entries);
    });
    this.unsubscribeEntryUpdated = deps.registry.onEntryUpdated(() => {
      this.view.setEntries(sortSlowupEntries(deps.registry.getAll()));
    });
  }

  setUrl(url: string): void {
    this.view.setUrl(url);
  }

  showError(message: string): void {
    this.view.showError(message);
  }

  private async handleLoad(url: string): Promise<void> {
    if (url === "") return;
    this.view.clearError();
    try {
      await this.deps.loadFn(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("LinesSubTab: load failed", err);
      this.view.showError(message);
    }
  }

  private handleSelect(id: string): void {
    this.deps.registry.setSelected(id);
    this.deps.onLineSelected();
  }

  private async fetchSlowupDetailsForLines(entries: readonly LineEntry[]): Promise<void> {
    const lang = i18next.language.split("-")[0] || "fr";

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.slowupNumber === undefined || entry.slowupFetchStatus !== "idle") {
          return;
        }

        this.deps.registry.updateEntry(entry.id, { slowupFetchStatus: "loading" });

        try {
          const slowupDetails = await fetchSlowupDetails(entry.slowupNumber, lang);
          this.deps.registry.updateEntry(entry.id, {
            slowupDetails,
            slowupFetchStatus: "ok",
            displayName: computeDisplayName({
              lengthKm: entry.lengthKm,
              properties: entry.track.rawProperties,
              slowupDetails,
            }),
          });
        } catch (error) {
          this.deps.registry.updateEntry(entry.id, { slowupFetchStatus: "error" });
          logger.warn(
            `LinesSubTab: failed to fetch slowUp details for ${entry.id} (slowup ${entry.slowupNumber})`,
            error,
          );
        }
      }),
    );
  }

  dispose(): void {
    this.unsubscribeLinesChanged();
    this.unsubscribeEntryUpdated();
  }
}
