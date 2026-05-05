import { describe, expect, it, vi } from "vitest";
import type { WmeSDK } from "wme-sdk-typings";
import { TrackLayer } from "../layers/TrackLayer";
import type { NormalizedTrack } from "../geojson/types";

interface AddedFeature {
  geometryType: string;
  kind: unknown;
}

function makeSdkMock(features: AddedFeature[]) {
  return {
    Map: {
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeAllFeaturesFromLayer: vi.fn(() => {
        features.length = 0;
      }),
      addFeatureToLayer: vi.fn(
        (args: { feature: { geometry: { type: string }; properties?: { kind?: unknown } } }) => {
          features.push({
            geometryType: args.feature.geometry.type,
            kind: args.feature.properties?.kind,
          });
        },
      ),
    },
  } as unknown as WmeSDK;
}

function makeTrack(): NormalizedTrack {
  return {
    trackId: 1,
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [7.0, 46.0],
          [7.01, 46.01],
          [7.02, 46.02],
        ],
      ],
    },
  };
}

describe("TrackLayer label visibility", () => {
  it("keeps labels hidden on initial draw", () => {
    const features: AddedFeature[] = [];
    const sdk = makeSdkMock(features);
    const layer = new TrackLayer(sdk);

    layer.draw(makeTrack());

    const pointCount = features.filter((feature) => feature.geometryType === "Point").length;
    expect(pointCount).toBe(0);
  });

  it("shows labels after setVisibleDistances is called", () => {
    const features: AddedFeature[] = [];
    const sdk = makeSdkMock(features);
    const layer = new TrackLayer(sdk);

    layer.draw(makeTrack());
    layer.setVisibleDistances(null);
    const firstVisibleKm = layer.getVisibleLabels()[0]?.km;
    expect(typeof firstVisibleKm).toBe("number");

    layer.setVisibleDistances([firstVisibleKm as number]);

    const pointCount = features.filter((feature) => feature.geometryType === "Point").length;
    expect(pointCount).toBeGreaterThan(0);
  });
});
