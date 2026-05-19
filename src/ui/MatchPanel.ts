// Shell panel: registers the WME sidebar tab and hosts a [Lignes][Matching]
// segmented toggle over two sub-tab controllers. All matching logic lives in
// MatchingSubTab; all line-loading logic in LinesSubTab.

import type { WmeSDK } from "wme-sdk-typings";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { SessionStore } from "../state/SessionStore";
import type { LineRegistry } from "../lines/LineRegistry";
import { wzButton } from "./components/wz";
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
    this.injectShellStyles(tabPane);

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

    const backBtn = wzButton({
      text: i18next.t("panel.matching.backToLines"),
      variant: "secondary",
      onClick: () => this.setActiveTab("lines"),
    });
    backBtn.classList.add("wmegj-back-btn");
    this.matchingContainer.appendChild(backBtn);

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

  private injectShellStyles(container: HTMLElement): void {
    const style = document.createElement("style");
    style.textContent = `
      .wmegj-subtab-toggle {
        display: flex;
        margin: 10px 0 12px;
        border: 1px solid #d3d8de;
        border-radius: 6px;
        overflow: hidden;
      }
      .wmegj-subtab-toggle button {
        flex: 1;
        padding: 8px 6px;
        cursor: pointer;
        border: 0;
        background: #f2f4f7;
        font-size: 13px;
        color: #5b6770;
      }
      .wmegj-subtab-toggle button + button { border-left: 1px solid #d3d8de; }
      .wmegj-subtab-toggle button.wmegj-subtab-active {
        background: #fff;
        font-weight: 700;
        color: #1f2937;
      }
      .wmegj-back-btn { display: block; margin: 0 0 10px; }
      .wmegj-line-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid #e5e8eb;
        border-radius: 6px;
        margin-bottom: 6px;
      }
      .wmegj-line-pill {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex: 0 0 auto;
      }
      .wmegj-line-name { flex: 1 1 auto; font-size: 13px; }
      .wmegj-source-line { font-weight: 600; font-size: 13px; margin: 4px 0 8px; }
      .wmegj-url-error { color: #c0392b; font-size: 12px; margin-top: 6px; }
      .wmegj-load-btn { display: block; margin-top: 8px; }
      .wmegj-lines-empty { font-size: 13px; color: #5b6770; }
    `;
    container.appendChild(style);
  }
}
