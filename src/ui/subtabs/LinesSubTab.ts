// Controller for the "Lignes" sub-tab: owns the LinesListView, drives URL
// loading through the injected loadFn, and reflects LineRegistry state.

import { logger } from "../../utils/logger";
import type { LineRegistry } from "../../lines/LineRegistry";
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

export class LinesSubTab {
  readonly root: HTMLElement;
  private readonly view: LinesListView;
  private readonly deps: LinesSubTabDeps;
  private readonly unsubscribe: () => void;

  constructor(deps: LinesSubTabDeps) {
    this.deps = deps;
    this.view = new LinesListView({
      onLoadUrl: (url) => void this.handleLoad(url),
      onSelect: (id) => this.handleSelect(id),
      onCenterAll: deps.onCenterAll,
      onCenterLine: deps.onCenterLine,
    });
    this.root = this.view.root;

    this.view.setEntries(deps.registry.getAll());
    this.unsubscribe = deps.registry.onLinesChanged(() => {
      this.view.setEntries(deps.registry.getAll());
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

  dispose(): void {
    this.unsubscribe();
  }
}
