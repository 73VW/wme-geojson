import { describe, expect, it } from "vitest";
import type { WmeSDK } from "wme-sdk-typings";
import { setLayersVisible, visibleDistractingLayers } from "../layers/matchingLayers";

function makeSdk(visible: Record<string, boolean>) {
  return {
    LayerSwitcher: {
      getWMELayerVisibility: ({ layerName }: { layerName: string }) => {
        if (!(layerName in visible)) throw new Error("unknown layer");
        return visible[layerName];
      },
      setWMELayerVisibility: ({
        layerName,
        isVisible,
      }: {
        layerName: string;
        isVisible: boolean;
      }) => {
        visible[layerName] = isVisible;
      },
    },
  } as unknown as WmeSDK;
}

describe("matchingLayers", () => {
  it("hides visible non-road layers and restores exactly those", () => {
    const state = { roads: true, places: true, mapComments: false, satelliteImagery: true };
    const sdk = makeSdk(state);

    const hidden = visibleDistractingLayers(sdk);
    expect(hidden.sort()).toEqual(["places", "satelliteImagery"]);

    setLayersVisible(sdk, hidden, false);
    expect(state).toEqual({
      roads: true,
      places: false,
      mapComments: false,
      satelliteImagery: false,
    });

    setLayersVisible(sdk, hidden, true);
    expect(state).toEqual({
      roads: true,
      places: true,
      mapComments: false,
      satelliteImagery: true,
    });
  });
});
