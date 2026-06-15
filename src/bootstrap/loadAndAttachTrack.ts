// Bootstrap helper: load a GeoJSON source URL into the LineRegistry.
// Drawing and controller creation happen later, when a line is selected
// in the MatchingSubTab.

import { loadLines } from "../lines/featureCollectionLoader";
import type { LineRegistry } from "../lines/LineRegistry";
import { logger } from "../utils/logger";
import type { MatchPanel } from "../ui/MatchPanel";

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("loadAndAttachLines: failed", err);
    panel.showLoadError(message);
  }
}
