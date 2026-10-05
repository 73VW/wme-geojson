import { describe, it, expect, beforeAll } from "vitest";
import i18next from "i18next";
import { buildEntriesFromData, buildEntryFromTrack } from "../lines/featureCollectionLoader";
import type { NormalizedTrack } from "../geojson/types";

beforeAll(async () => {
  await i18next.init({
    lng: "fr",
    resources: {
      fr: { translation: { panel: { lines: { fallbackName: "Tracé de {{km}} km" } } } },
    },
  });
});

const track: NormalizedTrack = {
  trackId: "t1",
  geometry: {
    type: "MultiLineString",
    // ~1 km along the equator
    coordinates: [
      [
        [0, 0],
        [0.009, 0],
      ],
    ],
  },
  rawProperties: { name: "Test line" },
};

describe("buildEntryFromTrack", () => {
  it("produces one entry with a stable id from url and index", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json#0");
    expect(entry.id).toBe("https://example.com/x.json#0");
  });

  it("computes lengthKm from the geometry", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json#0");
    expect(entry.lengthKm).toBeGreaterThan(0.9);
    expect(entry.lengthKm).toBeLessThan(1.1);
  });

  it("uses properties.name for the display name", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json#0");
    expect(entry.displayName).toBe("Test line");
  });

  it("preserves rawProperties on the track", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json#0");
    expect(entry.track.rawProperties).toEqual({ name: "Test line" });
  });

  it("defaults to synthetic mode and idle states", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json#0");
    expect(entry.mode).toBe("synthetic");
    expect(entry.matchPhase).toBe("idle");
    expect(entry.slowupFetchStatus).toBe("idle");
  });

  it("falls back to a length-based name when properties has no name", () => {
    const nameless: NormalizedTrack = { ...track, rawProperties: {} };
    const entry = buildEntryFromTrack(nameless, "https://example.com/x.json#0");
    expect(entry.displayName).toMatch(/^Tracé de /);
  });
});

describe("line colours", () => {
  it("gives the tracks of one file clearly different colours", () => {
    // Ids of one file differ only by their last character ("…kmz#0", "#1"…):
    // a hash of the id gave four almost identical greens.
    const line = (x: number) => ({
      type: "Feature",
      properties: { name: `Stage ${x}` },
      geometry: {
        type: "LineString",
        coordinates: [
          [x, 46],
          [x + 0.01, 46],
        ],
      },
    });
    const entries = buildEntriesFromData(
      { type: "FeatureCollection", features: [line(6), line(7), line(8), line(9)] },
      "MyMaps-Rallye.kmz",
    );
    const hues = entries.map((entry) => Number(/hsl\((\d+(?:\.\d+)?)/.exec(entry.color)?.[1]));
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const gap = Math.abs(hues[i] - hues[j]) % 360;
        expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(30);
      }
    }
  });
});
