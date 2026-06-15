import { describe, it, expect, beforeAll } from "vitest";
import i18next from "i18next";
import { validateFeatureCollection } from "../geojson/validate";
import { TrackLoadError } from "../geojson/types";
import { buildEntriesFromData } from "../lines/featureCollectionLoader";

beforeAll(async () => {
  await i18next.init({
    lng: "fr",
    resources: {
      fr: { translation: { panel: { lines: { fallbackName: "Tracé de {{km}} km" } } } },
    },
  });
});

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
      features: [
        lineFeature([
          [7, 46],
          [7.01, 46],
        ]),
        pointFeature,
      ],
    };
    const result = validateFeatureCollection(fc);
    expect(result).toHaveLength(1);
    expect(result[0].geometry.type).toBe("LineString");
  });

  it("keeps both LineString and MultiLineString features", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        lineFeature([
          [7, 46],
          [7.01, 46],
        ]),
        {
          type: "Feature",
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [7, 46],
                [7.02, 46],
              ],
            ],
          },
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
      features: [
        lineFeature([
          [2600000, 1200000],
          [2600100, 1200100],
        ]),
      ],
    };
    expect(() => validateFeatureCollection(fc)).toThrow(TrackLoadError);
  });
});

describe("buildEntriesFromData", () => {
  const url = "https://example.com/x.geojson";

  it("builds one entry per line feature of a FeatureCollection", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [0.009, 0],
            ],
          },
          properties: { name: "A" },
        },
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 0],
              [1.009, 0],
            ],
          },
          properties: { name: "B" },
        },
      ],
    };
    const entries = buildEntriesFromData(fc, url);
    expect(entries.map((e) => e.displayName)).toEqual(["A", "B"]);
  });

  it("gives every entry a stable, unique id", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [0.009, 0],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 0],
              [1.009, 0],
            ],
          },
          properties: {},
        },
      ],
    };
    const entries = buildEntriesFromData(fc, url);
    expect(entries.map((e) => e.id)).toEqual([`${url}#0`, `${url}#1`]);
  });

  it("still handles a lone Feature payload (one entry)", () => {
    const feature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0.009, 0],
        ],
      },
      properties: { name: "Solo" },
    };
    const entries = buildEntriesFromData(feature, url);
    expect(entries).toHaveLength(1);
    expect(entries[0].displayName).toBe("Solo");
  });

  it("assigns distinct colours to distinct entries", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [0.009, 0],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 0],
              [1.009, 0],
            ],
          },
          properties: {},
        },
      ],
    };
    const [a, b] = buildEntriesFromData(fc, url);
    expect(a.color).not.toBe(b.color);
  });
});

describe("buildEntriesFromData — slowUp grouping", () => {
  const url = "https://example.com/slowups.geojson";

  const slowupFeature = (slowupNumber: number, coords: number[][]) => ({
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: [coords] },
    properties: { slowup_number: slowupNumber },
  });

  it("merges features sharing a slowup_number into one entry", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        slowupFeature(19, [
          [0, 0],
          [0.009, 0],
        ]),
        slowupFeature(19, [
          [1, 0],
          [1.009, 0],
        ]),
        slowupFeature(7, [
          [2, 0],
          [2.009, 0],
        ]),
      ],
    };
    const entries = buildEntriesFromData(fc, url);
    expect(entries).toHaveLength(2);
    expect(entries[0].slowupNumber).toBe(19);
    expect(entries[1].slowupNumber).toBe(7);
  });

  it("a merged entry's geometry concatenates every member's sub-lines", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        slowupFeature(19, [
          [0, 0],
          [0.009, 0],
        ]),
        slowupFeature(19, [
          [1, 0],
          [1.009, 0],
        ]),
      ],
    };
    const [entry] = buildEntriesFromData(fc, url);
    expect(entry.track.geometry.type).toBe("MultiLineString");
    expect(entry.track.geometry.coordinates).toHaveLength(2);
  });

  it("gives merged entries a stable slowup-based id", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        slowupFeature(19, [
          [0, 0],
          [0.009, 0],
        ]),
      ],
    };
    expect(buildEntriesFromData(fc, url)[0].id).toBe(`${url}#slowup-19`);
  });

  it("keeps features without a slowup_number as one entry each", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [0.009, 0],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 0],
              [1.009, 0],
            ],
          },
          properties: {},
        },
      ],
    };
    expect(buildEntriesFromData(fc, url)).toHaveLength(2);
  });

  it("preserves first-seen order across interleaved slowup numbers", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        slowupFeature(19, [
          [0, 0],
          [0.009, 0],
        ]),
        slowupFeature(7, [
          [1, 0],
          [1.009, 0],
        ]),
        slowupFeature(19, [
          [2, 0],
          [2.009, 0],
        ]),
      ],
    };
    const entries = buildEntriesFromData(fc, url);
    expect(entries.map((e) => e.slowupNumber)).toEqual([19, 7]);
  });
});
