/**
 * Real-world false-negative captured from a guided matching run.
 *
 * Segment 474406759 is the missing link between two correctly-matched segments
 * at a slice boundary (row 9, km 9.7 → 10.1):
 *  - 296555144 ends at [6.601229, 46.70700] — matched in the previous slice (row 8)
 *  - 474406759 starts at [6.601229, 46.70700], ends at [6.600755, 46.70552] — NOT matched
 *  - 474406760 starts at [6.600755, 46.70552] — matched in this slice
 *
 * The user had to add 474406759 manually. It should appear in the auto-match
 * output of at least one of the two slices surrounding the boundary.
 *
 * This fixture covers the row 9 slice (km 9.7 → 10.1). TRACK_WITH_TAIL pads the
 * slice with a far-away anchor so that matchInCurrentViewport(0, SLICE_LENGTH_KM)
 * runs with allowEndBoundaryContinuation = false, mirroring production conditions.
 */

import { length as turfLength } from "@turf/turf";
import type { LineString, MultiLineString, Position } from "geojson";

export const TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.600925084739026, 46.706214454932386],
      [6.600790517870337, 46.705750160850585, 560.7999877929688],
      [6.60072073712945, 46.70536012109369, 560.5],
      [6.600719920359552, 46.70516040362418, 560.5],
      [6.6008103378117085, 46.70498024998233, 560.8999938964844],
      [6.601020062342286, 46.704780283384025, 561.5999755859375],
      [6.601021369919181, 46.70478029269725, 561.5999755859375],
      [6.601150550413877, 46.7046301108785, 562.5],
      [6.601240182761103, 46.70450032828376, 562.8999938964844],
      [6.601379641331732, 46.704530141316354, 563.2999877929688],
      [6.601810400839895, 46.70458008814603, 565],
      [6.602099547628313, 46.70457051880658, 566.1999816894531],
      [6.602220329456031, 46.70453992066905, 566.6999816894531],
      [6.603668354259959, 46.70409630916476],
    ],
  ],
};

const FAR_TAIL_COORD: Position = [6.5, 46.0];

export const TRACK_WITH_TAIL: MultiLineString = {
  type: "MultiLineString",
  coordinates: [[...TRACK_SLICE.coordinates[0], FAR_TAIL_COORD]],
};

export const SLICE_LENGTH_KM = turfLength(
  { type: "Feature", geometry: TRACK_SLICE, properties: null },
  { units: "kilometers" },
);

export interface CapturedSegment {
  id: number;
  geometry: LineString;
}

export const MATCHED_SEGMENTS: CapturedSegment[] = [
  {
    // The false-negative: connects 296555144 (row 8) to 474406760 across the boundary.
    id: 474406759,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.601229124100875, 46.70700054525077],
        [6.601069627228899, 46.706588908379615],
        [6.600887237015891, 46.70606930824061],
        [6.600771902028281, 46.70562235615494],
        [6.600755325285293, 46.705519174580935],
      ],
    },
  },
  {
    // Segment immediately after 474406759 — its start is 474406759's end.
    id: 474406760,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.600755325285293, 46.705519174580935],
        [6.600719598952458, 46.70529679613339],
        [6.600733009997581, 46.7051662037081],
        [6.60077324313271, 46.70507423702278],
      ],
    },
  },
];

/**
 * The matcher must include 474406759 in its output for this slice.
 * (474406760 is expected to continue matching as it already did.)
 */
export const EXPECTED_MATCHED_IDS = [474406759] as const;
