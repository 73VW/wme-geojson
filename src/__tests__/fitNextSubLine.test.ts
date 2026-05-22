import { describe, expect, it } from "vitest";
import type { MultiLineString } from "geojson";
import { fitNextSubLine } from "../matching/fitNextSubLine";

const TARGET_ZOOM = 16;

function lineFromKmRange(kmA: number, kmB: number): MultiLineString {
  // Use a 1-km/deg-longitude approximation at the equator (≈ 111 km/deg).
  const lonA = kmA / 111;
  const lonB = kmB / 111;
  return { type: "MultiLineString", coordinates: [[[lonA, 0], [lonB, 0]]] };
}

describe("fitNextSubLine", () => {
  it("accepts the whole pending range when it fits at the target zoom", () => {
    const result = fitNextSubLine({
      pending: { kmA: 0, kmB: 1 },
      geometry: lineFromKmRange(0, 1),
      targetZoom: TARGET_ZOOM,
      evaluateZoom: () => TARGET_ZOOM,
      sliceByKm: (_, a, b) => lineFromKmRange(a, b),
    });
    expect(result.accepted.kmA).toBe(0);
    expect(result.accepted.kmB).toBe(1);
    expect(result.remainder).toBeNull();
  });

  it("splits and returns a remainder when the candidate is below target zoom", () => {
    const result = fitNextSubLine({
      pending: { kmA: 0, kmB: 8 },
      geometry: lineFromKmRange(0, 8),
      targetZoom: TARGET_ZOOM,
      // Pretend the whole range needs z13 but a head trimmed to 75% reaches z16.
      evaluateZoom: (geom) => {
        const span = geom.coordinates[0][1][0] - geom.coordinates[0][0][0];
        return span > 0.05 ? 13 : 16;
      },
      sliceByKm: (_, a, b) => lineFromKmRange(a, b),
    });
    expect(result.accepted.kmA).toBe(0);
    expect(result.accepted.kmB).toBeLessThan(8);
    expect(result.accepted.kmB).toBeGreaterThan(0);
    expect(result.remainder).not.toBeNull();
    expect(result.remainder!.kmA).toBe(result.accepted.kmB);
    expect(result.remainder!.kmB).toBe(8);
  });

  it("accepts undersized slices when span <= MIN", () => {
    const result = fitNextSubLine({
      pending: { kmA: 0, kmB: 0.005 },
      geometry: lineFromKmRange(0, 0.005),
      targetZoom: TARGET_ZOOM,
      evaluateZoom: () => 14, // below target
      sliceByKm: (_, a, b) => lineFromKmRange(a, b),
      minSpanKm: 0.01,
    });
    expect(result.accepted.kmB).toBe(0.005);
    expect(result.remainder).toBeNull();
  });
});
