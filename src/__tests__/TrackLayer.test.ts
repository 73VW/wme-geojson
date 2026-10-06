import { describe, expect, it, vi } from "vitest";
import type { WmeSDK } from "wme-sdk-typings";
import { TrackLayer } from "../layers/TrackLayer";
import type { NormalizedTrack } from "../geojson/types";

interface AddedFeature {
  geometryType: string;
  coordinates?: unknown;
  kind: unknown;
  km?: unknown;
  lineColor?: unknown;
}

function makeSdkMock(features: AddedFeature[]) {
  return {
    Map: {
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeAllFeaturesFromLayer: vi.fn(() => {
        features.length = 0;
      }),
      addFeaturesToLayer: vi.fn(
        (args: {
          features: { geometry: { type: string }; properties?: Record<string, unknown> }[];
        }) => {
          for (const feature of args.features) {
            features.push({
              geometryType: feature.geometry.type,
              coordinates: (feature.geometry as { coordinates?: unknown }).coordinates,
              kind: feature.properties?.kind,
              km: feature.properties?.km,
              lineColor: feature.properties?.lineColor,
            });
          }
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

  it("positions requested-distance labels by interpolation instead of snapping to vertices", () => {
    const features: AddedFeature[] = [];
    const sdk = makeSdkMock(features);
    const layer = new TrackLayer(sdk);
    const track: NormalizedTrack = {
      trackId: 1,
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [7.0, 46.0],
            [7.02, 46.0],
          ],
        ],
      },
    };

    layer.draw(track);
    const halfwayKm = layer.getTotalKm() / 2;
    layer.setVisibleDistances([halfwayKm]);

    const label = features.find((feature) => feature.geometryType === "Point");
    expect(label?.km).toBe(halfwayKm);
    expect(label?.coordinates).toEqual([7.01, 46.0]);
  });

  it("places origin-offset labels at (distance − origin) but keeps the roadbook km as text", () => {
    // Display geometry that starts at roadbook km 5.7 (leading slice dropped):
    // the label "5.7" must sit at the very start of the displayed track, and
    // the next roadbook distance halfway along it.
    const features: AddedFeature[] = [];
    const sdk = makeSdkMock(features);
    const layer = new TrackLayer(sdk);
    const track: NormalizedTrack = {
      trackId: 1,
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [7.0, 46.0],
            [7.02, 46.0],
          ],
        ],
      },
    };

    layer.draw(track);
    const originKm = 5.7;
    const halfwayKm = layer.getTotalKm() / 2;
    layer.setVisibleDistances([originKm, originKm + halfwayKm], originKm);

    const labels = features.filter((feature) => feature.geometryType === "Point");
    expect(labels).toHaveLength(2);
    expect(labels[0].coordinates).toEqual([7.0, 46.0]);
    expect(labels[0].km).toBe(originKm);
    expect(labels[1].coordinates).toEqual([7.01, 46.0]);
    expect(labels[1].km).toBe(originKm + halfwayKm);
  });

  it("uses distinct colors for different sub-lines in per-subline mode", () => {
    const features: AddedFeature[] = [];
    const sdk = makeSdkMock(features);
    const layer = new TrackLayer(sdk);
    const track: NormalizedTrack = {
      trackId: 1,
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [7.0, 46.0],
            [7.01, 46.0],
          ],
          [
            [7.02, 46.0],
            [7.03, 46.0],
          ],
        ],
      },
    };

    layer.draw(track, { colorMode: "per-subline" });

    const lineColors = features
      .filter((feature) => feature.geometryType === "LineString" && feature.kind === "line")
      .map((feature) => feature.lineColor)
      .filter((color): color is string => typeof color === "string");

    expect(lineColors).toHaveLength(2);
    expect(lineColors[0]).not.toBe(lineColors[1]);
  });
});

describe("TrackLayer SDK batching", () => {
  it("adds track, slice and labels in a single SDK call per redraw", () => {
    const features: AddedFeature[] = [];
    const sdk = makeSdkMock(features);
    const layer = new TrackLayer(sdk);

    layer.draw(makeTrack());
    layer.setVisibleDistances(null);
    layer.setHighlightedSlice(makeTrack().geometry);
    vi.mocked(sdk.Map.addFeaturesToLayer).mockClear();

    layer.setVisibleRange(0, layer.getTotalKm());

    expect(sdk.Map.addFeaturesToLayer).toHaveBeenCalledTimes(1);
    const kinds = features.map((f) => f.kind);
    expect(kinds.slice(0, 2)).toEqual(["line", "slice"]);
    expect(kinds.length).toBeGreaterThan(2);
    expect(kinds.slice(2).every((kind) => kind === "label")).toBe(true);
  });
});
