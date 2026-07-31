// Bootstrap helper: load a GeoJSON source URL into the LineRegistry.
// Drawing and controller creation happen later, when a line is selected
// in the MatchingSubTab.

import { buildEntriesFromText, loadLines } from "../lines/featureCollectionLoader";
import type { LineRegistry } from "../lines/LineRegistry";
import { logger } from "../utils/logger";
import type { MatchPanel } from "../ui/MatchPanel";
import { clearUploadedFile, loadUploadedFile, saveUploadedFile } from "../persistence/uploadedFile";

/**
 * Read a File object, parse it (GeoJSON, GPX, or KML), persist to localStorage,
 * and populate the registry. Calls panel.showLoadError on failure.
 * Calls panel.notifyFileLoaded(filename) on success.
 */
export async function loadAndAttachFile(
  file: File,
  registry: LineRegistry,
  panel: MatchPanel,
): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("loadAndAttachFile: failed to read file", err);
    panel.showLoadError(message);
    return;
  }

  let entries;
  try {
    entries = buildEntriesFromText(text, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("loadAndAttachFile: failed to parse file", err);
    panel.showLoadError(message);
    return;
  }

  saveUploadedFile(file.name, text);
  registry.setEntries(entries);
  logger.info(`loadAndAttachFile: loaded ${entries.length} line(s) from ${file.name}`);
  panel.notifyFileLoaded(file.name);
}

/**
 * Restore the last uploaded file from localStorage (if any).
 * Calls panel.notifyFileLoaded(filename) on success.
 * Silently skips if nothing stored or parse fails.
 */
export async function restoreUploadedFile(
  registry: LineRegistry,
  panel: MatchPanel,
): Promise<void> {
  const stored = loadUploadedFile();
  if (stored === null) {
    return;
  }

  let entries;
  try {
    entries = buildEntriesFromText(stored.content, stored.name);
  } catch (err) {
    logger.warn("restoreUploadedFile: failed to parse stored file, clearing", err);
    clearUploadedFile();
    return;
  }

  registry.setEntries(entries);
  logger.info(`restoreUploadedFile: restored ${entries.length} line(s) from ${stored.name}`);
  panel.notifyFileLoaded(stored.name);
}

export async function loadAndAttachLines(
  url: string,
  registry: LineRegistry,
  panel: MatchPanel,
): Promise<void> {
  try {
    const entries = await loadLines(url);

    // Persist URL in the query string so a reload re-triggers auto-load.
    const params = new URLSearchParams(window.location.search);
    params.set("geojson", url);
    history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);

    registry.setEntries(entries);
    logger.info(`loadAndAttachLines: loaded ${entries.length} line(s) from ${url}`);
    panel.notifyUrlLoaded();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("loadAndAttachLines: failed", err);
    panel.showLoadError(message);
  }
}

/** Clear the line(s) loaded from a URL and drop the `geojson` query param. */
export function clearLoadedUrl(registry: LineRegistry): void {
  const params = new URLSearchParams(window.location.search);
  params.delete("geojson");
  const query = params.toString();
  history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  registry.setEntries([]);
}
