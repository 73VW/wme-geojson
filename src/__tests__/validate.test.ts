import { describe, it, expect } from "vitest";
import { validateFeature } from "../geojson/validate";
import { TrackLoadError } from "../geojson/types";

describe("validateFeature", () => {
  it("accepts a valid LineString Feature", () => {
    const input = {
      type: "Feature",
      id: 1,
      properties: null,
      geometry: {
        type: "LineString",
        coordinates: [
          [8.0, 47.0],
          [8.1, 47.1],
        ],
      },
    };
    expect(() => validateFeature(input)).not.toThrow();
  });

  it("accepts a valid MultiLineString Feature", () => {
    const input = {
      type: "Feature",
      id: "x",
      properties: null,
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [7.0, 46.0],
            [7.1, 46.1],
          ],
        ],
      },
    };
    expect(() => validateFeature(input)).not.toThrow();
  });

  it("rejects a non-Feature type", () => {
    const input = {
      type: "FeatureCollection",
      features: [],
    };
    expect(() => validateFeature(input)).toThrow(TrackLoadError);
  });

  it("rejects a Point geometry", () => {
    const input = {
      type: "Feature",
      properties: null,
      geometry: {
        type: "Point",
        coordinates: [8.0, 47.0],
      },
    };
    expect(() => validateFeature(input)).toThrow(TrackLoadError);
  });

  it("throws with CRS mention when coordinates appear to be in LV95 (projected CRS)", () => {
    // LV95 easting is ~2,600,000 which is outside WGS84 lon range of [-180, 180]
    const input = {
      type: "Feature",
      properties: null,
      geometry: {
        type: "LineString",
        coordinates: [
          [2_600_000, 1_200_000],
          [2_601_000, 1_201_000],
        ],
      },
    };
    expect(() => validateFeature(input)).toThrow(
      "coordinates appear to be in a projected CRS (LV95?) instead of WGS84",
    );
  });

  it("accepts 3D WGS84 coordinates without CRS error", () => {
    const input = {
      type: "Feature",
      properties: null,
      geometry: {
        type: "LineString",
        coordinates: [
          [8.0, 47.0, 450],
          [8.1, 47.1, 520],
        ],
      },
    };
    expect(() => validateFeature(input)).not.toThrow();
  });

  it("throws TrackLoadError when feature has no geometry", () => {
    const input = {
      type: "Feature",
      properties: null,
      geometry: null,
    };
    expect(() => validateFeature(input)).toThrow(TrackLoadError);
  });
});
