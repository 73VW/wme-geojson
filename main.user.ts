import type { WmeSDK } from "wme-sdk-typings";
import { initI18n } from "./locales/i18n";
import { loadTrack } from "./src/geojson/Loader";
import { TrackLayer } from "./src/layers/TrackLayer";
import { getGeojsonUrlFromLocation } from "./src/utils/queryParams";
import { logger } from "./src/utils/logger";

// Only the SDK_INITIALIZED hook runs at module top-level.
// All script behaviour is inside initScript, which is called by the SDK runtime.
unsafeWindow.SDK_INITIALIZED.then(initScript);

async function initScript(): Promise<void> {
  const wmeSDK: WmeSDK = unsafeWindow.getWmeSdk!({
    scriptId: "wme-geojson",
    scriptName: "WME GeoJSON",
  });

  await initI18n(wmeSDK);

  const url = getGeojsonUrlFromLocation();
  if (!url) {
    logger.info("No geojson query param, idle.");
    return;
  }

  // Wait for WME to be fully ready before accessing the data model or map
  await wmeSDK.Events.once({ eventName: "wme-ready" });

  try {
    const track = await loadTrack(url);
    const layer = new TrackLayer(wmeSDK);
    layer.draw(track);
    logger.info(`Track drawn (id=${track.trackId ?? "unknown"})`);
  } catch (err) {
    logger.error("Failed to load and draw track", err);
  }
}
