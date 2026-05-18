/**
 * Real-world false-negative captured from a guided matching run.
 *
 * Segment 474406759 is the missing link between two correctly-matched segments
 * at a slice boundary (row 8, km 7.7 → 9.7):
 *  - 296555144 ends at [6.601229, 46.70700] — matched in this slice
 *  - 474406759 starts at [6.601229, 46.70700], ends at [6.600755, 46.70552] — NOT matched
 *  - 474406760 starts at [6.600755, 46.70552] — matched in the next slice (row 9)
 *
 * The user had to add 474406759 manually. It should appear in the auto-match
 * output of at least one of the two slices surrounding the boundary.
 *
 * This fixture covers the row 8 slice (km 7.7 → 9.7). TRACK_WITH_TAIL pads the
 * slice with a far-away anchor so that matchInCurrentViewport(0, SLICE_LENGTH_KM)
 * runs with allowEndBoundaryContinuation = false, mirroring production conditions.
 */

import { length as turfLength } from "@turf/turf";
import type { LineString, MultiLineString, Position } from "geojson";

export const TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.59544959089218, 46.72163360044346],
      [6.595449634827673, 46.72146990755573, 575.1999816894531],
      [6.595919525716454, 46.72003042884171, 568.1999816894531],
      [6.5960602620616555, 46.71973010478541, 566.7999877929688],
      [6.59749964857474, 46.717769724316895, 557.5999755859375],
      [6.600790712982416, 46.71364144375548, 562.8999938964844],
      [6.601020423229784, 46.713420033454895, 563.2999877929688],
      [6.601309490855783, 46.71325033670291, 563.5999755859375],
      [6.6017303466796875, 46.71310049900785, 563.7999877929688],
      [6.603360048960894, 46.71258980082348, 565.2999877929688],
      [6.603629862423986, 46.712480229791254, 565.6999816894531],
      [6.603740506339818, 46.7124297642149, 565.8999938964844],
      [6.603890147060156, 46.71231031510979, 566.0999755859375],
      [6.604019644204527, 46.71214034082368, 566.1999816894531],
      [6.604060743004084, 46.712020095903426, 566.2999877929688],
      [6.60408046329394, 46.71176025690511, 566.3999938964844],
      [6.604040623642504, 46.711630422621965, 566.5],
      [6.603989709168673, 46.7115400894545, 566.5],
      [6.602509828284383, 46.70990005740896, 565],
      [6.602250084746629, 46.709530213847756, 564.5999755859375],
      [6.602109572850168, 46.709230514708906, 564.1999816894531],
      [6.601260280236602, 46.707161489874125, 560.7999877929688],
      [6.600929523818195, 46.70622977102175, 561.0999755859375],
      [6.600925084739026, 46.706214454932386],
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
    // Segment immediately before 474406759 — its endpoint is 474406759's start.
    id: 296555144,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.601290909472665, 46.70716000293966],
        [6.601229124100875, 46.70700054525077],
      ],
    },
  },
  {
    // The false-negative: connects 296555144 to 474406760 across the boundary.
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
];

/**
 * The matcher must include 474406759 in its output for this slice.
 * (296555144 is expected to continue matching as it already did.)
 */
export const EXPECTED_MATCHED_IDS = [474406759] as const;
