import { describe, it, expect, beforeAll } from "vitest";
import i18next from "i18next";
import { buildEntryFromTrack } from "../lines/featureCollectionLoader";
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
    coordinates: [[[0, 0], [0.009, 0]]],
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
