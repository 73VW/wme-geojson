// Shell panel: registers the WME sidebar tab and hosts a native <wz-tabs>
// control with [Lignes][Matching] sub-tabs. All matching logic lives in
// MatchingSubTab; all line-loading logic in LinesSubTab.

import type { MultiLineString } from "geojson";
import type { WmeSDK } from "wme-sdk-typings";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { SessionStore } from "../state/SessionStore";
import type { LineRegistry } from "../lines/LineRegistry";
import type { LineEntry } from "../lines/types";
import { bboxOfMultiLineString } from "../matching/trackPortions";
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
  private loadFileFn: ((file: File) => Promise<void>) | null = null;
  private previewLayer: LinesPreviewLayer | null = null;
  // Whether the Lignes sub-tab content is currently on screen. Drives the
  // multi-colour preview — see the IntersectionObserver wired in mount().
  private linesTabVisible = false;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly store: SessionStore,
    private readonly registry: LineRegistry,
  ) {}

  /** Injected by main.user.ts to break the loadAndAttachLines import cycle. */
  setLoadFn(fn: (url: string) => Promise<void>): void {
    this.loadFn = fn;
  }

  /** Injected by main.user.ts to break the loadAndAttachFile import cycle. */
  setLoadFileFn(fn: (file: File) => Promise<void>): void {
    this.loadFileFn = fn;
  }

  /** Surface a successfully loaded/restored filename in the Lignes sub-tab. */
  notifyFileLoaded(name: string): void {
    this.linesSubTab?.setLoadedFile(name);
  }

  /** Surface a successfully loaded URL (manual or auto from query param). */
  notifyUrlLoaded(): void {
    this.linesSubTab?.setUrlLoaded();
  }

  async mount(): Promise<void> {
    if (this.tabPane) return;

    const { tabLabel, tabPane } = await this.wmeSDK.Sidebar.registerScriptTab();
    this.tabPane = tabPane;
    tabLabel.textContent = "Event Closures";
    tabPane.classList.add("wmegj-panel-root");
    this.injectShellStyles(tabPane);

    if (!this.loadFn) {
      logger.error("MatchPanel.mount: loadFn not set before mount");
      return;
    }

    this.linesSubTab = new LinesSubTab({
      registry: this.registry,
      loadFn: this.loadFn,
      loadFileFn:
        this.loadFileFn ??
        (async () => {
          logger.error("MatchPanel.mount: loadFileFn not set");
        }),
      onLineSelected: () => this.tabs?.setActiveTab(1),
      onCenterAll: () => this.centerOnAllLines(),
      onCenterLine: (id) => this.centerOnLine(id),
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
      // Always center the map on the newly selected line so it is
      // immediately identifiable. Preview visibility is driven by which
      // sub-tab is showing (the IntersectionObserver below), not by
      // selection — so returning to the Lignes list restores every trace.
      if (entry) this.zoomToEntries([entry]);
    });

    // <wz-tab> hides the inactive tab's content with display:none, so an
    // IntersectionObserver on the Lignes content flips as the user switches
    // sub-tabs: the multi-colour preview is drawn while the Lignes list is
    // visible and removed while the Matching tab is showing.
    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((records) => {
        this.linesTabVisible = records.some((record) => record.isIntersecting);
        this.refreshPreview();
      });
      observer.observe(this.linesSubTab.root);
    }

    logger.info("MatchPanel shell mounted");
  }

  /** Show the multi-colour preview only while the Lignes sub-tab is visible. */
  private refreshPreview(): void {
    if (!this.previewLayer) return;
    const entries = this.registry.getAll();
    if (this.linesTabVisible && entries.length > 0) {
      this.previewLayer.draw(entries);
    } else {
      this.previewLayer.destroy();
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
    this.zoomToEntries(this.registry.getAll());
  }

  /** Zoom the WME map to the bounding box of a single line. */
  private centerOnLine(id: string): void {
    const entry = this.registry.getEntryById(id);
    if (entry) this.zoomToEntries([entry]);
  }

  /** Zoom the WME map to the bounding box enclosing the given lines. */
  private zoomToEntries(entries: readonly LineEntry[]): void {
    if (entries.length === 0) return;

    const merged: MultiLineString = {
      type: "MultiLineString",
      coordinates: entries.flatMap((entry) => entry.track.geometry.coordinates),
    };
    const bbox = bboxOfMultiLineString(merged);
    if (!bbox) return;

    this.wmeSDK.Map.zoomToExtent({ bbox });
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
        border: none;
        background: #f2f4f7;
        border-right: 1px solid #d3d8de;
      }
      .wmegj-subtab-toggle button.wmegj-subtab-active {
        background: #fff;
        font-weight: 700;
      }
      .wmegj-line-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border: 1px solid #e5e8eb;
        border-radius: 8px;
        background: #fff;
        cursor: pointer;
        transition: background 0.12s ease, border-color 0.12s ease;
      }
      .wmegj-line-row:hover {
        background: #f2f4f7;
        border-color: #d3d8de;
      }
      .wmegj-line-pill {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex: 0 0 auto;
      }
      .wmegj-line-name { flex: 1 1 auto; font-size: 13px; }
      .wmegj-icon-btn {
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid #d3d8de;
        background: #fff;
        color: #2c6fbb;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wmegj-icon-btn:hover { background: #e9edf2; color: #1d5a9e; }
      .wmegj-line-arrow { flex: 0 0 auto; color: #9aa6b1; }
      .wmegj-line-row--loading { opacity: 0.6; cursor: default; }
      .wmegj-line-row--loading:hover { background: transparent; }
      .wmegj-line-warning { flex: 0 0 auto; color: #e0a800; }
      .wmegj-spinner {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        border: 2px solid #c7ced6;
        border-top-color: #2c6fbb;
        border-radius: 50%;
        animation: wmegj-spin 0.7s linear infinite;
      }
      @keyframes wmegj-spin { to { transform: rotate(360deg); } }
      .wmegj-source-line { font-weight: 600; font-size: 13px; margin: 4px 0 8px; }
      .wmegj-url-error { color: #c0392b; font-size: 12px; margin-top: 6px; }
      .wmegj-load-btn { display: block; margin-top: 8px; }
      .wmegj-lines-empty { font-size: 13px; color: #5b6770; }
    `;
    container.appendChild(style);
  }
}
