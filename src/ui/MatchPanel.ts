// Shell panel: registers the WME sidebar tab and hosts a [Lignes][Matching]
// segmented toggle over two sub-tab controllers. All matching logic lives in
// MatchingSubTab; all line-loading logic in LinesSubTab.

import type { WmeSDK } from "wme-sdk-typings";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { SessionStore } from "../state/SessionStore";
import type { LineRegistry } from "../lines/LineRegistry";
import { LinesSubTab } from "./subtabs/LinesSubTab";
import { MatchingSubTab } from "./subtabs/MatchingSubTab";

type SubTab = "lines" | "matching";

export class MatchPanel {
  private tabPane: HTMLElement | null = null;
  private linesBtn: HTMLButtonElement | null = null;
  private matchingBtn: HTMLButtonElement | null = null;
  private linesContainer: HTMLElement | null = null;
  private matchingContainer: HTMLElement | null = null;
  private linesSubTab: LinesSubTab | null = null;
  private matchingSubTab: MatchingSubTab | null = null;
  private loadFn: ((url: string) => Promise<void>) | null = null;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly store: SessionStore,
    private readonly registry: LineRegistry,
  ) {}

  /** Injected by main.user.ts to break the loadAndAttachLines import cycle. */
  setLoadFn(fn: (url: string) => Promise<void>): void {
    this.loadFn = fn;
  }

  async mount(): Promise<void> {
    if (this.tabPane) return;

    const { tabLabel, tabPane } = await this.wmeSDK.Sidebar.registerScriptTab();
    this.tabPane = tabPane;
    tabLabel.textContent = "GeoJ";
    tabPane.classList.add("wmegj-panel-root");
    this.injectToggleStyles(tabPane);

    const toggle = document.createElement("div");
    toggle.className = "wmegj-subtab-toggle";
    this.linesBtn = this.makeToggleButton(i18next.t("panel.subtabs.lines"), "lines");
    this.matchingBtn = this.makeToggleButton(i18next.t("panel.subtabs.matching"), "matching");
    toggle.appendChild(this.linesBtn);
    toggle.appendChild(this.matchingBtn);
    tabPane.appendChild(toggle);

    this.linesContainer = document.createElement("div");
    this.matchingContainer = document.createElement("div");
    tabPane.appendChild(this.linesContainer);
    tabPane.appendChild(this.matchingContainer);

    if (!this.loadFn) {
      logger.error("MatchPanel.mount: loadFn not set before mount");
      return;
    }

    this.linesSubTab = new LinesSubTab({
      registry: this.registry,
      loadFn: this.loadFn,
      onLineSelected: () => this.setActiveTab("matching"),
    });
    this.linesContainer.appendChild(this.linesSubTab.root);

    this.matchingSubTab = new MatchingSubTab(this.wmeSDK, this.store, this.registry);
    this.matchingContainer.appendChild(this.matchingSubTab.buildRoot());

    this.setActiveTab("lines");
    logger.info("MatchPanel shell mounted");
  }

  /** Pre-fill the URL field from the query param. */
  setInitialUrl(url: string): void {
    this.linesSubTab?.setUrl(url);
  }

  /** Surface a URL load error in the Lignes sub-tab. */
  showLoadError(message: string): void {
    this.linesSubTab?.showError(message);
  }

  private makeToggleButton(label: string, tab: SubTab): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", () => this.setActiveTab(tab));
    return btn;
  }

  private setActiveTab(tab: SubTab): void {
    const showLines = tab === "lines";
    if (this.linesContainer) this.linesContainer.style.display = showLines ? "" : "none";
    if (this.matchingContainer) this.matchingContainer.style.display = showLines ? "none" : "";
    this.linesBtn?.classList.toggle("wmegj-subtab-active", showLines);
    this.matchingBtn?.classList.toggle("wmegj-subtab-active", !showLines);
  }

  private injectToggleStyles(container: HTMLElement): void {
    const style = document.createElement("style");
    style.textContent = `
      .wmegj-subtab-toggle { display: flex; gap: 0; margin-bottom: 8px; }
      .wmegj-subtab-toggle button { flex: 1; padding: 6px; cursor: pointer; border: 1px solid #ccc; background: #f4f4f4; }
      .wmegj-subtab-toggle button.wmegj-subtab-active { background: #fff; font-weight: 700; }
    `;
    container.appendChild(style);
  }
}
