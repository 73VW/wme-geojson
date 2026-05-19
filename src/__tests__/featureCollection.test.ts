import { describe, it, expect } from "vitest";
import { validateFeatureCollection } from "../geojson/validate";
import { TrackLoadError } from "../geojson/types";

const lineFeature = (coords: number[][]) => ({
  type: "Feature",
  geometry: { type: "LineString", coordinates: coords },
  properties: {},
});
const pointFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [7, 46] },
  properties: {},
};

describe("validateFeatureCollection", () => {
  it("returns the line features and drops Point features", () => {
    const fc = {
      type: "FeatureCollection",
      features: [lineFeature([[7, 46], [7.01, 46]]), pointFeature],
    };
    const result = validateFeatureCollection(fc);
    expect(result).toHaveLength(1);
    expect(result[0].geometry.type).toBe("LineString");
  });

  it("keeps both LineString and MultiLineString features", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        lineFeature([[7, 46], [7.01, 46]]),
        {
          type: "Feature",
          geometry: { type: "MultiLineString", coordinates: [[[7, 46], [7.02, 46]]] },
          properties: {},
        },
      ],
    };
    expect(validateFeatureCollection(fc)).toHaveLength(2);
  });

  it("throws when raw is not a FeatureCollection", () => {
    expect(() => validateFeatureCollection({ type: "Feature" })).toThrow(TrackLoadError);
  });

  it("throws when no line features survive", () => {
    const fc = { type: "FeatureCollection", features: [pointFeature] };
    expect(() => validateFeatureCollection(fc)).toThrow(TrackLoadError);
  });

  it("rejects a line feature with projected (non-WGS84) coordinates", () => {
    const fc = {
      type: "FeatureCollection",
      features: [lineFeature([[2600000, 1200000], [2600100, 1200100]])],
    };
    expect(() => validateFeatureCollection(fc)).toThrow(TrackLoadError);
  });
});
