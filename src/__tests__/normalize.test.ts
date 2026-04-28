import { describe, it, expect } from "vitest";
import type { Feature, LineString, MultiLineString } from "geojson";
import { normalizeTrack } from "../geojson/normalize";

// ---------------------------------------------------------------------------
// Minimal SchweizMobil-shaped fixtures
// SchweizMobil track 1764963942 returns Feature<MultiLineString> in WGS84
// with optional 3D coordinates [lon, lat, elevation].
// ---------------------------------------------------------------------------

const lineStringFeature: Feature<LineString> = {
  type: "Feature",
  id: 1764963942,
  properties: { name: "Jakobsweg Ostschweiz" },
  geometry: {
    type: "LineString",
    coordinates: [
      [8.2, 47.3],
      [8.3, 47.4],
      [8.4, 47.5],
    ],
  },
};

const multiLineStringFeature: Feature<MultiLineString> = {
  type: "Feature",
  id: "trail-42",
  properties: { source: "schweizmobil" },
  geometry: {
    type: "MultiLineString",
    coordinates: [
      [
        [7.1, 46.1],
        [7.2, 46.2],
      ],
      [
        [7.3, 46.3],
        [7.4, 46.4],
      ],
    ],
  },
};

const threeDFeature: Feature<MultiLineString> = {
  type: "Feature",
  id: 999,
  properties: null,
  geometry: {
    type: "MultiLineString",
    coordinates: [
      [
        [8.0, 47.0, 450],
        [8.1, 47.1, 520],
        [8.2, 47.2, 610],
      ],
    ],
  },
};

const noIdFeature: Feature<LineString> = {
  type: "Feature",
  // No `id` field
  properties: null,
  geometry: {
    type: "LineString",
    coordinates: [
      [6.5, 45.5],
      [6.6, 45.6],
    ],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("normalizeTrack", () => {
  it("wraps a LineString in a MultiLineString with one sub-line, preserving coordinates", () => {
    const track = normalizeTrack(lineStringFeature);

    expect(track.geometry.type).toBe("MultiLineString");
    expect(track.geometry.coordinates).toHaveLength(1);
    expect(track.geometry.coordinates[0]).toEqual(lineStringFeature.geometry.coordinates);
  });

  it("passes through a MultiLineString, preserving all sub-lines", () => {
    const track = normalizeTrack(multiLineStringFeature);

    expect(track.geometry.type).toBe("MultiLineString");
    expect(track.geometry.coordinates).toHaveLength(2);
    expect(track.geometry.coordinates).toEqual(multiLineStringFeature.geometry.coordinates);
  });

  it("preserves 3D coordinates (third element / elevation) untouched", () => {
    const track = normalizeTrack(threeDFeature);

    const firstLine = track.geometry.coordinates[0];
    expect(firstLine).toBeDefined();
    // Each coordinate should still have 3 elements
    firstLine.forEach((coord) => {
      expect(coord).toHaveLength(3);
    });
    // Spot-check the elevation value
    expect(firstLine[0][2]).toBe(450);
    expect(firstLine[1][2]).toBe(520);
    expect(firstLine[2][2]).toBe(610);
  });

  it("extracts numeric id from payload as trackId", () => {
    const track = normalizeTrack(lineStringFeature);

    expect(track.trackId).toBe(1764963942);
  });

  it("extracts string id from payload as trackId", () => {
    const track = normalizeTrack(multiLineStringFeature);

    expect(track.trackId).toBe("trail-42");
  });

  it("returns trackId === null when no id field is present", () => {
    const track = normalizeTrack(noIdFeature);

    expect(track.trackId).toBeNull();
  });

  it("extracts non-null properties as rawProperties", () => {
    const track = normalizeTrack(lineStringFeature);

    expect(track.rawProperties).toEqual({ name: "Jakobsweg Ostschweiz" });
  });

  it("omits rawProperties when properties is null", () => {
    const track = normalizeTrack(threeDFeature);

    expect(track.rawProperties).toBeUndefined();
  });
});
