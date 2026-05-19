// Shell panel: registers the WME sidebar tab and hosts a native <wz-tabs>
// control with [Lignes][Matching] sub-tabs. All matching logic lives in
// MatchingSubTab; all line-loading logic in LinesSubTab.

import type { WmeSDK } from "wme-sdk-typings";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { SessionStore } from "../state/SessionStore";
import type { LineRegistry } from "../lines/LineRegistry";
import { wzTabs, type WzTabsHandle } from "./components/wz";
import { LinesSubTab } from "./subtabs/LinesSubTab";
import { MatchingSubTab } from "./subtabs/MatchingSubTab";
import { LinesPreviewLayer } from "../layers/LinesPreviewLayer";

export class MatchPanel {
  private tabPane: HTMLElement | null = null;
  private tabs: WzTabsHandle | null = null;
  private linesSubTab: LinesSubTab | null = null;
  private matchingSubTab: MatchingSubTab | null = null;
  private loadFn: ((url: string) => Promise<void>) | null = null;
  private previewLayer: LinesPreviewLayer | null = null;

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

    if (!this.loadFn) {
      logger.error("MatchPanel.mount: loadFn not set before mount");
      return;
    }

    this.linesSubTab = new LinesSubTab({
      registry: this.registry,
      loadFn: this.loadFn,
      onLineSelected: () => this.tabs?.setActiveTab(1),
      onCenterAll: () => this.centerOnAllLines(),
    });

    this.matchingSubTab = new MatchingSubTab(this.wmeSDK, this.store, this.registry);
    const matchingRoot = this.matchingSubTab.buildRoot();

    this.tabs = wzTabs([
      { label: i18next.t("panel.subtabs.lines"), content: this.linesSubTab.root },
      { label: i18next.t("panel.subtabs.matching"), content: matchingRoot },
    ]);
    tabPane.appendChild(this.tabs.root);

    // The shell mounts once per WME session and is never re-mounted (mount()
    // early-returns when tabPane exists), so these registry subscriptions are
    // intentionally never unsubscribed — they live for the page lifetime.
    this.previewLayer = new LinesPreviewLayer(this.wmeSDK);
    this.registry.onLinesChanged(() => this.refreshPreview());
    this.registry.onSelectedLineChanged((entry) => {
      if (entry) {
        this.previewLayer?.destroy();
      } else {
        this.refreshPreview();
      }
    });

    logger.info("MatchPanel shell mounted");
  }

  /** Show the multi-colour preview only while no line is selected. */
  private refreshPreview(): void {
    if (!this.previewLayer) return;
    if (this.registry.getSelected() !== null) {
      this.previewLayer.destroy();
      return;
    }
    const entries = this.registry.getAll();
    if (entries.length === 0) {
      this.previewLayer.destroy();
    } else {
      this.previewLayer.draw(entries);
    }
  }

  /** Pre-fill the URL field from the query param. */
  setInitialUrl(url: string): void {
    this.linesSubTab?.setUrl(url);
  }

  /** Surface a URL load error in the Lignes sub-tab. */
  showLoadError(message: string): void {
    this.linesSubTab?.showError(message);
  }

  /** Zoom the WME map to the bounding box enclosing every loaded line. */
  private centerOnAllLines(): void {
    const entries = this.registry.getAll();
    if (entries.length === 0) return;

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const entry of entries) {
      for (const line of entry.track.geometry.coordinates) {
        for (const coord of line) {
          const lon = coord[0];
          const lat = coord[1];
          if (lon < minLon) minLon = lon;
          if (lat < minLat) minLat = lat;
          if (lon > maxLon) maxLon = lon;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    if (!Number.isFinite(minLon)) return;

    this.wmeSDK.Map.zoomToExtent({ bbox: [minLon, minLat, maxLon, maxLat] as import("geojson").BBox });
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
