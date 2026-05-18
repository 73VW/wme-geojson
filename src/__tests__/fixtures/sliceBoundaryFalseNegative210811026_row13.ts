/**
 * Real-world false-negative captured from a guided matching run.
 *
 * Segment 210811026 is missing from the auto-match output of slice row 13
 * (km 13.8 → 14.1). Its start vertex [6.638619, 46.71433] is shared with
 * anchor segment 450224752, which IS correctly matched. The route passes
 * through both segments, but 210811026 is dropped — likely because it
 * extends slightly outside (or barely inside) the slice boundary window.
 *
 * TRACK_WITH_TAIL pads the slice with a far-away anchor so that
 * matchInCurrentViewport(0, SLICE_LENGTH_KM) runs with
 * allowEndBoundaryContinuation = false, mirroring production conditions.
 */

import { length as turfLength } from "@turf/turf";
import type { LineString, MultiLineString, Position } from "geojson";

export const TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.638440158377742, 46.71436284437775],
      [6.638730513397604, 46.71432994026691, 600.1999816894531],
      [6.638749472796917, 46.714550473727286, 600.2999877929688],
      [6.638829792384058, 46.714690475258976, 600.2999877929688],
      [6.6394101129844785, 46.71551048196852, 600.1999816894531],
      [6.641123758068774, 46.715207367861446],
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
    // Anchor: already matched, shares endpoint [6.638619, 46.71433] with 210811026.
    id: 450224752,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.638708373070678, 46.714374804531225],
        [6.638694906801523, 46.71437552582501],
        [6.6386934785577, 46.71437550768679],
        [6.638680060489165, 46.71437444497151],
        [6.6386671154230195, 46.71437180085908],
        [6.638655036685086, 46.7143676556893],
        [6.638644191278526, 46.71436213541003],
        [6.63863490873287, 46.71435540775034],
        [6.638627471091772, 46.71434767712441],
        [6.638622104343475, 46.71433917842084],
        [6.638619277168466, 46.71433147464208],
      ],
    },
  },
  {
    // The false-negative: starts where 450224752 ends, heads west — should be matched.
    id: 210811026,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.638619277168466, 46.71433147464208],
        [6.638266651045686, 46.714389531947255],
      ],
    },
  },
];

/**
 * The matcher must include 210811026 in its output for this slice.
 * (450224752 is expected to continue matching as it already did.)
 */
export const EXPECTED_MATCHED_IDS = [210811026] as const;
