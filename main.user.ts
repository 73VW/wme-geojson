import type { WmeSDK } from "wme-sdk-typings";
import { initI18n } from "./locales/i18n";
import { SessionStore } from "./src/state/SessionStore";
import { MatchPanel } from "./src/ui/MatchPanel";
import { loadAndAttachTrack } from "./src/bootstrap/loadAndAttachTrack";
import { getGeojsonUrlFromLocation } from "./src/utils/queryParams";
import { logger } from "./src/utils/logger";

// Only the SDK_INITIALIZED hook runs at module top-level.
// All script behaviour is inside initScript, which is called by the SDK runtime.
unsafeWindow.SDK_INITIALIZED.then(initScript);

async function initScript(): Promise<void> {
  if (!unsafeWindow.getWmeSdk) {
    logger.error("getWmeSdk not available on unsafeWindow; aborting.");
    return;
  }
  const wmeSDK: WmeSDK = unsafeWindow.getWmeSdk({
    scriptId: "wme-geojson",
    scriptName: "WME GeoJSON",
  });

  await initI18n(wmeSDK);

  // Wait for WME to be fully ready before accessing the data model or map
  await wmeSDK.Events.once({ eventName: "wme-ready" });

  const store = new SessionStore();
  const panel = new MatchPanel(wmeSDK, store, null, null);

  // Break the circular import: MatchPanel cannot import loadAndAttachTrack
  // directly (loadAndAttachTrack imports MatchPanel for its parameter type),
  // so main.user.ts — which imports both — injects the bound function here.
  panel.setLoadFn((url: string) => loadAndAttachTrack(url, wmeSDK, store, panel));

  await panel.mount();

  const url = getGeojsonUrlFromLocation();
  if (url) {
    await loadAndAttachTrack(url, wmeSDK, store, panel);
  }
}
