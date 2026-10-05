import type { WmeSDK } from "wme-sdk-typings";
import { initI18n } from "./locales/i18n";
import { SessionStore } from "./src/state/SessionStore";
import { LineRegistry } from "./src/lines/LineRegistry";
import { MatchPanel } from "./src/ui/MatchPanel";
import {
  loadAndAttachLines,
  loadAndAttachFile,
  restoreUploadedFile,
} from "./src/bootstrap/loadAndAttachTrack";
import { getGeojsonUrlFromLocation } from "./src/utils/queryParams";
import { logger } from "./src/utils/logger";

// Only the SDK_INITIALIZED hook runs at module top-level.
unsafeWindow.SDK_INITIALIZED.then(initScript);

async function initScript(): Promise<void> {
  if (!unsafeWindow.getWmeSdk) {
    logger.error("getWmeSdk not available on unsafeWindow; aborting.");
    return;
  }
  const wmeSDK: WmeSDK = unsafeWindow.getWmeSdk({
    scriptId: "wme-geojson",
    scriptName: "WME Event Closures",
  });

  await initI18n(wmeSDK);
  await wmeSDK.Events.once({ eventName: "wme-ready" });

  const store = new SessionStore();
  const registry = new LineRegistry();
  const panel = new MatchPanel(wmeSDK, store, registry);

  panel.setLoadFn((url: string) => loadAndAttachLines(url, registry, panel));
  panel.setLoadFileFn((file: File) => loadAndAttachFile(file, registry, panel));

  await panel.mount();

  await restoreUploadedFile(registry, panel);

  const url = getGeojsonUrlFromLocation();
  if (url) {
    panel.setInitialUrl(url);
    await loadAndAttachLines(url, registry, panel);
  }
}
