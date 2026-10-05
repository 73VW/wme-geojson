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
import { injectStyles } from "./styles";
import { lineProgress } from "../domain/lineProgress";
import { SourcePersistence } from "../domain/SourcePersistence";

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
  notifyUrlLoaded(url: string): void {
    this.linesSubTab?.setUrlLoaded(url);
  }

  async mount(): Promise<void> {
    if (this.tabPane) return;

    const { tabLabel, tabPane } = await this.wmeSDK.Sidebar.registerScriptTab();
    this.tabPane = tabPane;
    tabLabel.textContent = "Event Closures";
    tabPane.classList.add("wmegj-panel-root");
    injectStyles(document);

    if (!this.loadFn) {
      logger.error("MatchPanel.mount: loadFn not set before mount");
      return;
    }

    // Read-only: load() only reads localStorage.
    const progressReader = new SourcePersistence();
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
      loadProgress: (id) => lineProgress(progressReader.load(id)),
    });

    this.matchingSubTab = new MatchingSubTab(this.wmeSDK, this.store, this.registry, () =>
      this.tabs?.setActiveTab(0),
    );
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
        const becameVisible = !this.linesTabVisible && records.some((r) => r.isIntersecting);
        this.linesTabVisible = records.some((record) => record.isIntersecting);
        if (becameVisible) this.linesSubTab?.refresh();
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
}
