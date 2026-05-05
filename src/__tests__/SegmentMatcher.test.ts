import { describe, it, expect } from "vitest";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { buffer as turfBuffer } from "@turf/turf";
import { matchSegments } from "../matching/SegmentMatcher";
import type { SegmentLike } from "../matching/types";
import {
  TRACK_SLICE as JUNCTION_TRACK,
  MATCHED_SEGMENTS as JUNCTION_SEGMENTS,
  FALSE_POSITIVE_IDS as JUNCTION_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as JUNCTION_TRUE_POSITIVE_IDS,
} from "./fixtures/junctionFalsePositive";
import {
  TRACK_SLICE as LOOP_TRACK,
  MATCHED_SEGMENTS as LOOP_SEGMENTS,
  FALSE_POSITIVE_IDS as LOOP_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as LOOP_TRUE_POSITIVE_IDS,
} from "./fixtures/loopShortcutFalsePositive";
import {
  TRACK_SLICE as ROUNDABOUT_TRACK,
  MATCHED_SEGMENTS as ROUNDABOUT_SEGMENTS,
  FALSE_POSITIVE_IDS as ROUNDABOUT_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as ROUNDABOUT_TRUE_POSITIVE_IDS,
} from "./fixtures/roundaboutFalsePositive";
import {
  TRACK_SLICE as PARALLEL_TRACK,
  MATCHED_SEGMENTS as PARALLEL_SEGMENTS,
  FALSE_POSITIVE_IDS as PARALLEL_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as PARALLEL_TRUE_POSITIVE_IDS,
} from "./fixtures/parallelStreetFalsePositive";
import {
  TRACK_SLICE as HAIRPIN_TRACK,
  MATCHED_SEGMENTS as HAIRPIN_SEGMENTS,
  FALSE_POSITIVE_IDS as HAIRPIN_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as HAIRPIN_TRUE_POSITIVE_IDS,
} from "./fixtures/hairpinFalsePositive";
import {
  TRACK_SLICE as PERP_SPUR_TRACK,
  MATCHED_SEGMENTS as PERP_SPUR_SEGMENTS,
  FALSE_POSITIVE_IDS as PERP_SPUR_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as PERP_SPUR_TRUE_POSITIVE_IDS,
} from "./fixtures/perpendicularSpurFalsePositive";
import {
  TRACK_SLICE as ROUNDABOUT_LOOP_TRACK,
  MATCHED_SEGMENTS as ROUNDABOUT_LOOP_SEGMENTS,
  FALSE_POSITIVE_IDS as ROUNDABOUT_LOOP_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as ROUNDABOUT_LOOP_TRUE_POSITIVE_IDS,
} from "./fixtures/roundaboutLoopFalsePositive";
import {
  TRACK_SLICE as SPUR_OFF_TRACK,
  MATCHED_SEGMENTS as SPUR_OFF_SEGMENTS,
  FALSE_POSITIVE_IDS as SPUR_OFF_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as SPUR_OFF_TRUE_POSITIVE_IDS,
} from "./fixtures/spurOffTrackFalsePositive";
import {
  TRACK_SLICE as SLICE_BOUNDARY_TRACK,
  SELECTED_SEGMENTS as SLICE_BOUNDARY_SEGMENTS,
  EXPECTED_MATCHED_IDS as SLICE_BOUNDARY_EXPECTED_IDS,
} from "./fixtures/sliceBoundaryFalseNegative";
import {
  ROW_10_TRACK_SLICE as SLICE_BOUNDARY_2_ROW_10,
  ROW_11_TRACK_SLICE as SLICE_BOUNDARY_2_ROW_11,
  SEGMENT_302908393,
} from "./fixtures/sliceBoundaryFalseNegative2";
import {
  ROW_18_TRACK_SLICE as SLICE_BOUNDARY_3_ROW_18,
  ROW_19_TRACK_SLICE as SLICE_BOUNDARY_3_ROW_19,
  SEGMENT_210924767,
} from "./fixtures/sliceBoundaryFalseNegative3";
import {
  TRACK_SLICE as KMB_PERP_TRACK,
  MATCHED_SEGMENTS as KMB_PERP_SEGMENTS,
  FALSE_POSITIVE_IDS as KMB_PERP_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as KMB_PERP_TRUE_POSITIVE_IDS,
} from "./fixtures/junctionEndOfSlicePerpendicular";
import {
  TRACK_SLICE as UTURN_CHORD_TRACK,
  MATCHED_SEGMENTS as UTURN_CHORD_SEGMENTS,
  FALSE_POSITIVE_IDS as UTURN_CHORD_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as UTURN_CHORD_TRUE_POSITIVE_IDS,
} from "./fixtures/uTurnChordFalsePositive";
import {
  TRACK_SLICE as LONG_OFFTRACK_TRACK,
  MATCHED_SEGMENTS as LONG_OFFTRACK_SEGMENTS,
  FALSE_POSITIVE_IDS as LONG_OFFTRACK_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as LONG_OFFTRACK_TRUE_POSITIVE_IDS,
} from "./fixtures/longOffTrackFalsePositive";
import {
  TRACK_SLICE as OFFTRACK_END_TRACK,
  MATCHED_SEGMENTS as OFFTRACK_END_SEGMENTS,
  FALSE_POSITIVE_IDS as OFFTRACK_END_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as OFFTRACK_END_TRUE_POSITIVE_IDS,
} from "./fixtures/offTrackEndpointFalsePositive";

// ---------------------------------------------------------------------------
// Fixtures — a simple east-west track near Geneva
// ---------------------------------------------------------------------------

const TRACK_LINE = {
  type: "Feature" as const,
  geometry: {
    type: "MultiLineString" as const,
    coordinates: [
      [
        [6.14, 46.2],
        [6.16, 46.2],
      ],
    ],
  },
  properties: null,
};

const BUFFER_METERS = 15;

function makeBufferedTrack(): Feature<Polygon | MultiPolygon> {
  const result = turfBuffer(TRACK_LINE, BUFFER_METERS, { units: "meters" });
  if (!result) throw new Error("turfBuffer returned falsy");
  return result;
}

// ---------------------------------------------------------------------------
// Segment helpers
// ---------------------------------------------------------------------------

function seg(id: number, coords: number[][]): SegmentLike {
  return {
    id,
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("matchSegments", () => {
  const bufferedTrack = makeBufferedTrack();

  it("matches a segment fully inside the buffer", () => {
    // A very short segment that lies right on the track centerline.
    const inside = seg(1, [
      [6.148, 46.2],
      [6.15, 46.2],
    ]);
    const result = matchSegments({ segments: [inside], bufferedTrack });

    expect(result.has(1)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("does not match a segment fully outside the buffer", () => {
    // ~100 m north of the track — well outside the 15 m buffer.
    const outside = seg(2, [
      [6.14, 46.202],
      [6.16, 46.202],
    ]);
    const result = matchSegments({ segments: [outside], bufferedTrack });

    expect(result.has(2)).toBe(false);
    expect(result.size).toBe(0);
  });

  it("matches a segment that crosses the buffer boundary at one point", () => {
    // Starts inside the buffer and extends well outside to the north.
    // At 46.20° lat, 0.0001° ≈ 7 m, so the segment starts ~5 m north of the
    // center (inside the 15 m buffer) and ends ~200 m north (outside).
    const crossing = seg(3, [
      [6.15, 46.200065], // ≈7 m north of centerline — still inside 15 m buffer
      [6.15, 46.202], // ~200 m north — outside buffer
    ]);
    const result = matchSegments({ segments: [crossing], bufferedTrack });

    expect(result.has(3)).toBe(true);
  });

  it("returns only matching IDs from a mixed batch", () => {
    const inside = seg(10, [
      [6.148, 46.2],
      [6.15, 46.2],
    ]);
    const outsideFar = seg(20, [
      [6.14, 46.203],
      [6.16, 46.203],
    ]);
    const outsideFar2 = seg(30, [
      [6.1, 46.21],
      [6.11, 46.21],
    ]);
    const alsoCrossing = seg(40, [
      [6.155, 46.200065],
      [6.155, 46.203],
    ]);

    const result = matchSegments({
      segments: [inside, outsideFar, outsideFar2, alsoCrossing],
      bufferedTrack,
    });

    expect(result.has(10)).toBe(true);
    expect(result.has(40)).toBe(true);
    expect(result.has(20)).toBe(false);
    expect(result.has(30)).toBe(false);
    expect(result.size).toBe(2);
  });

  it("returns an empty Set when no segments are provided", () => {
    const result = matchSegments({ segments: [], bufferedTrack });

    expect(result.size).toBe(0);
  });

  it("handles duplicate segment IDs without growing the Set beyond one entry", () => {
    const seg1 = seg(99, [
      [6.148, 46.2],
      [6.15, 46.2],
    ]);
    // Same geometry, same id — should still only appear once in the result Set.
    const result = matchSegments({ segments: [seg1, seg1], bufferedTrack });

    expect(result.size).toBe(1);
    expect(result.has(99)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real-world false-positive regression — captured from a guided run on
// 2026-05-05 (see fixtures/junctionFalsePositive.ts).
//
// Marked .fails until the matcher gains a directional/projected-span filter:
// segment 449171158 is a side street meeting the route at a junction. Both
// of its endpoints fall inside the buffer, so the current intersects-only
// check matches it incorrectly.
// ---------------------------------------------------------------------------

function bufferFor(geometry: { type: "MultiLineString"; coordinates: number[][][] }) {
  const result = turfBuffer(
    { type: "Feature" as const, geometry, properties: null },
    15,
    { units: "meters" },
  );
  if (!result) throw new Error("turfBuffer returned falsy");
  return result as Feature<Polygon | MultiPolygon>;
}

describe("matchSegments — junction false positive", () => {
  const bufferedTrack = bufferFor(JUNCTION_TRACK);
  const segments: SegmentLike[] = JUNCTION_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects side-street segments that only touch the route at a junction", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of JUNCTION_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of JUNCTION_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — loop shortcut false positive", () => {
  const bufferedTrack = bufferFor(LOOP_TRACK);
  const segments: SegmentLike[] = LOOP_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects chord segments that cut across a route loop", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of LOOP_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the loop", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of LOOP_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — roundabout false positive", () => {
  const bufferedTrack = bufferFor(ROUNDABOUT_TRACK);
  const segments: SegmentLike[] = ROUNDABOUT_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects roundabout-loop segments whose mid-vertices bulge off the track", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of ROUNDABOUT_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the route past the roundabout", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of ROUNDABOUT_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — parallel-street / junction-kink false positives", () => {
  const bufferedTrack = bufferFor(PARALLEL_TRACK);
  const segments: SegmentLike[] = PARALLEL_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it(
    "rejects both the parallel half of a divided street and a junction kink",
    () => {
      const matched = matchSegments({ segments, bufferedTrack });

      for (const id of PARALLEL_FALSE_POSITIVE_IDS) {
        expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
      }
    },
  );

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of PARALLEL_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — hairpin spur false positive", () => {
  const bufferedTrack = bufferFor(HAIRPIN_TRACK);
  const segments: SegmentLike[] = HAIRPIN_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it(
    "rejects spur segments that share only the apex node of an out-and-back hairpin",
    () => {
      const matched = matchSegments({ segments, bufferedTrack });

      for (const id of HAIRPIN_FALSE_POSITIVE_IDS) {
        expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
      }
    },
  );

  it("still matches every segment that genuinely follows the hairpin", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of HAIRPIN_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — perpendicular spur false positive", () => {
  const bufferedTrack = bufferFor(PERP_SPUR_TRACK);
  const segments: SegmentLike[] = PERP_SPUR_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects a tiny perpendicular spur attached at a junction node", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of PERP_SPUR_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of PERP_SPUR_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — roundabout-loop false positive (row 80)", () => {
  const bufferedTrack = bufferFor(ROUNDABOUT_LOOP_TRACK);
  const segments: SegmentLike[] = ROUNDABOUT_LOOP_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it(
    "rejects a roundabout-style detour whose mid-vertices bulge off the track",
    () => {
      const matched = matchSegments({ segments, bufferedTrack });

      for (const id of ROUNDABOUT_LOOP_FALSE_POSITIVE_IDS) {
        expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
      }
    },
  );

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of ROUNDABOUT_LOOP_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — spur off the track (row 81)", () => {
  const bufferedTrack = bufferFor(SPUR_OFF_TRACK);
  const segments: SegmentLike[] = SPUR_OFF_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects a spur whose far endpoint is well off the track", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of SPUR_OFF_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of SPUR_OFF_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — slice-boundary false negative (row 9 / 149959928)", () => {
  const bufferedTrack = bufferFor(SLICE_BOUNDARY_TRACK);
  const segments: SegmentLike[] = SLICE_BOUNDARY_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("matches a segment whose tail crosses the slice's kmA boundary", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of SLICE_BOUNDARY_EXPECTED_IDS) {
      expect(matched.has(id), `expected ${id} to be matched`).toBe(true);
    }
  });
});

describe("matchSegments — slice-boundary false negative (rows 10/11 / 302908393)", () => {
  const segments: SegmentLike[] = [
    { id: SEGMENT_302908393.id, geometry: SEGMENT_302908393.geometry },
  ];

  it("matches segment 302908393 against row 10's slice (its v3 is on this slice)", () => {
    const matched = matchSegments({
      segments,
      bufferedTrack: bufferFor(SLICE_BOUNDARY_2_ROW_10),
    });
    expect(matched.has(SEGMENT_302908393.id)).toBe(true);
  });

  it("matches segment 302908393 against row 11's slice (its v1/v2 are on this slice)", () => {
    const matched = matchSegments({
      segments,
      bufferedTrack: bufferFor(SLICE_BOUNDARY_2_ROW_11),
    });
    expect(matched.has(SEGMENT_302908393.id)).toBe(true);
  });
});

describe("matchSegments — slice-boundary false negative (rows 18/19 / 210924767)", () => {
  const segments: SegmentLike[] = [
    { id: SEGMENT_210924767.id, geometry: SEGMENT_210924767.geometry },
  ];

  it("matches segment 210924767 against row 18's slice (v2 lands on this slice)", () => {
    const matched = matchSegments({
      segments,
      bufferedTrack: bufferFor(SLICE_BOUNDARY_3_ROW_18),
    });
    expect(matched.has(SEGMENT_210924767.id)).toBe(true);
  });

  it("matches segment 210924767 against row 19's slice (v1 lands on this slice)", () => {
    const matched = matchSegments({
      segments,
      bufferedTrack: bufferFor(SLICE_BOUNDARY_3_ROW_19),
    });
    expect(matched.has(SEGMENT_210924767.id)).toBe(true);
  });
});

describe("matchSegments — kmB-end junction perpendicular spurs (row 44)", () => {
  const bufferedTrack = bufferFor(KMB_PERP_TRACK);
  const segments: SegmentLike[] = KMB_PERP_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects two perpendicular spurs branching off the kmB junction", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of KMB_PERP_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of KMB_PERP_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — U-turn chord false positive (row 1 / 211742068)", () => {
  const bufferedTrack = bufferFor(UTURN_CHORD_TRACK);
  const segments: SegmentLike[] = UTURN_CHORD_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects a 2-vertex chord that cuts across a U-turn loop in the track", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of UTURN_CHORD_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of UTURN_CHORD_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — long off-track segment with on-track endpoints (row 12 / 434621647)", () => {
  const bufferedTrack = bufferFor(LONG_OFFTRACK_TRACK);
  const segments: SegmentLike[] = LONG_OFFTRACK_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects a long segment whose mid-vertices wander far off the track", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of LONG_OFFTRACK_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of LONG_OFFTRACK_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});

describe("matchSegments — off-track endpoint false positives (row 20)", () => {
  const bufferedTrack = bufferFor(OFFTRACK_END_TRACK);
  const segments: SegmentLike[] = OFFTRACK_END_SEGMENTS.map((s) => ({
    id: s.id,
    geometry: s.geometry,
  }));

  it("rejects segments with one endpoint or mid-vertices far off the track", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of OFFTRACK_END_FALSE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to be filtered out`).toBe(false);
    }
  });

  it("still matches every segment that genuinely follows the route", () => {
    const matched = matchSegments({ segments, bufferedTrack });

    for (const id of OFFTRACK_END_TRUE_POSITIVE_IDS) {
      expect(matched.has(id), `expected ${id} to remain matched`).toBe(true);
    }
  });
});
