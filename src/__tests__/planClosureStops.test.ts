import { describe, expect, it } from "vitest";
import { directionsFor, isoToMs, planClosureStops } from "../csv/planClosureStops";

const viewA = { lon: 6.1, lat: 46.2, zoom: 17 };
const viewB = { lon: 6.3, lat: 46.4, zoom: 16 };

describe("planClosureStops", () => {
  it("creates one stop per distinct view, in first-seen order", () => {
    const stops = planClosureStops([
      { startISO: "2026-05-31T09:00", endISO: "2026-05-31T17:00", geo: viewB, segmentIds: [1] },
      { startISO: "2026-05-31T09:00", endISO: "2026-05-31T17:00", geo: viewA, segmentIds: [2, 3] },
    ]);
    expect(stops.map((s) => s.geo)).toEqual([viewB, viewA]);
    expect(stops[1].closures.map((c) => c.segmentId)).toEqual([2, 3]);
  });

  it("merges items sharing a view and drops exact duplicates", () => {
    const stops = planClosureStops([
      { startISO: "2026-05-31T09:00", endISO: "2026-05-31T12:00", geo: viewA, segmentIds: [1, 1] },
      {
        startISO: "2026-05-31T14:00",
        endISO: "2026-05-31T17:00",
        geo: { ...viewA },
        segmentIds: [1],
      },
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0].closures).toEqual([
      { segmentId: 1, startMs: isoToMs("2026-05-31T09:00"), endMs: isoToMs("2026-05-31T12:00") },
      { segmentId: 1, startMs: isoToMs("2026-05-31T14:00"), endMs: isoToMs("2026-05-31T17:00") },
    ]);
  });

  it("skips empty items", () => {
    expect(
      planClosureStops([
        { startISO: "2026-05-31T09:00", endISO: "2026-05-31T17:00", geo: viewA, segmentIds: [] },
      ]),
    ).toEqual([]);
  });
});

describe("isoToMs", () => {
  it("reads the ISO string as local time", () => {
    expect(isoToMs("2026-05-31T09:00")).toBe(new Date(2026, 4, 31, 9, 0).getTime());
  });
  it("throws on garbage", () => {
    expect(() => isoToMs("nope")).toThrow();
  });
});

describe("directionsFor", () => {
  it("closes both directions on a two-way segment", () => {
    expect(directionsFor({ isAtoB: false, isBtoA: false })).toEqual([true, false]);
  });
  it("closes only A→B on an A→B one-way", () => {
    expect(directionsFor({ isAtoB: true, isBtoA: false })).toEqual([true]);
  });
  it("closes only B→A on a B→A one-way", () => {
    expect(directionsFor({ isAtoB: false, isBtoA: true })).toEqual([false]);
  });
});
