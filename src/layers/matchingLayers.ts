// Hide the WME layers that are useless while matching (everything but roads)
// and restore exactly those afterwards. Fewer layers = fewer features for WME
// to load and draw while the walker pans the map.

import type { WmeLayerName, WmeSDK } from "wme-sdk-typings";

const KEPT: ReadonlySet<string> = new Set(["roads"]);

const ALL: readonly WmeLayerName[] = [
  "cities",
  "roads",
  "places",
  "paths",
  "junctionBoxes",
  "closures",
  "permanentHazards",
  "gpsPoints",
  "houseNumbers",
  "mapComments",
  "mapProblems",
  "updateRequests",
  "satelliteImagery",
  "editSuggestions",
];

/** Currently visible layers that matching does not need. */
export function visibleDistractingLayers(sdk: WmeSDK): WmeLayerName[] {
  return ALL.filter((layerName) => {
    if (KEPT.has(layerName)) return false;
    try {
      return sdk.LayerSwitcher.getWMELayerVisibility({ layerName });
    } catch {
      return false;
    }
  });
}

export function setLayersVisible(
  sdk: WmeSDK,
  layerNames: readonly WmeLayerName[],
  isVisible: boolean,
): void {
  for (const layerName of layerNames) {
    try {
      sdk.LayerSwitcher.setWMELayerVisibility({ layerName, isVisible });
    } catch {
      // Unknown layer on this WME version: nothing to hide or restore.
    }
  }
}
