import { describe, expect, it } from "vitest";
import { computeBboxViews } from "../matching/bboxViews";

// Realistic-ish viewport sizes: at zoom 17 in Switzerland (~46° lat) one
// viewport covers roughly 0.005° lon × 0.0035° lat. The unit tests below use
// round numbers to keep the algebra readable.
const VP = {
  viewportLonSpanAtCurrentZoom: 0.01,
  viewportLatSpanAtCurrentZoom: 0.01,
  currentZoom: 16,
  minZoom: 14,
  maxZoom: 18,
};

describe("computeBboxViews", () => {
  it("returns no views for an empty label list", () => {
    expect(computeBboxViews({ ...VP, labels: [] })).toEqual([]);
  });

  it("returns a single view at maxZoom for a single point", () => {
    const views = computeBboxViews({
      ...VP,
      labels: [{ coord: [7.05, 46.18], km: 1.2 }],
    });
    expect(views).toHaveLength(1);
    expect(views[0].centerLon).toBeCloseTo(7.05);
    expect(views[0].centerLat).toBeCloseTo(46.18);
    expect(views[0].zoom).toBe(VP.maxZoom);
  });

  it("returns one view when all labels fit a single viewport, picking the highest fitting zoom", () => {
    // Two points 0.002° apart — well inside the 0.01° viewport at currentZoom,
    // and small enough that several zoom levels fit it. The algo should pick
    // the highest legal zoom, capped at maxZoom.
    const views = computeBboxViews({
      ...VP,
      labels: [
        { coord: [7.05, 46.18], km: 1.0 },
        { coord: [7.052, 46.181], km: 1.1 },
      ],
    });
    expect(views).toHaveLength(1);
    expect(views[0].zoom).toBe(VP.maxZoom);
    expect(views[0].centerLon).toBeCloseTo(7.051);
    expect(views[0].centerLat).toBeCloseTo(46.1805);
  });

  it("picks a zoom strictly between min and max when the bbox forces it", () => {
    // bbox 0.012° in lon — overflows currentZoom (0.01°) but fits at z15
    // (0.02°). Algo should pick exactly z15.
    const views = computeBboxViews({
      ...VP,
      labels: [
        { coord: [7.05, 46.18], km: 1.0 },
        { coord: [7.062, 46.18], km: 5.0 },
      ],
    });
    expect(views).toHaveLength(1);
    expect(views[0].zoom).toBe(15);
  });

  it("splits labels too spread for a single z14 viewport into multiple views", () => {
    // At minZoom=14 the viewport span is 0.01 × 2^(16-14) = 0.04°.
    // Labels are 0.5° apart in lon — that overflows even at z14, so each
    // label becomes its own cluster.
    const views = computeBboxViews({
      ...VP,
      labels: [
        { coord: [7.0, 46.0], km: 0 },
        { coord: [7.5, 46.0], km: 30 },
        { coord: [8.0, 46.0], km: 60 },
      ],
    });
    expect(views.length).toBeGreaterThanOrEqual(2);
    // Each single-point cluster fits at maxZoom.
    for (const v of views) expect(v.zoom).toBe(VP.maxZoom);
  });

  it("clamps the chosen zoom into [minZoom, maxZoom]", () => {
    // Two points just slightly apart — analytical zoom would exceed maxZoom.
    const views = computeBboxViews({
      ...VP,
      labels: [
        { coord: [7.05, 46.18], km: 1.0 },
        { coord: [7.0500001, 46.18], km: 1.001 },
      ],
    });
    expect(views).toHaveLength(1);
    expect(views[0].zoom).toBeLessThanOrEqual(VP.maxZoom);
    expect(views[0].zoom).toBeGreaterThanOrEqual(VP.minZoom);
  });
});
