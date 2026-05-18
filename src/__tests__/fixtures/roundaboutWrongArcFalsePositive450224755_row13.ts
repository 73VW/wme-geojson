/**
 * Real-world false-positive captured from a guided matching run.
 *
 * Three tiny segments form a 3-arc loop (roundabout) at the junction
 * near [6.6387, 46.7144] in slice row 13 (km 13.8 → 14.1).
 * The route traverses only two of the three arcs:
 *   - 450224754 (north-northeast leg, towards slice start direction)
 *   - 450224752 (west-southwest leg, back along incoming direction)
 *
 * 450224755 is the "outside" arc that curves north then south-west;
 * the route does NOT traverse it, but the matcher incorrectly includes it.
 *
 * The slice's first edge runs from [6.638440, 46.71436] eastward to
 * [6.638730, 46.71432]. 450224754 connects the junction's south node to
 * the west node; 450224752 runs west from the junction; 450224755 is the
 * remaining arc completing the loop — it should be dropped.
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
    // Legitimate match: south leg connecting to the roundabout junction.
    id: 450224754,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.63871319830136, 46.714270652612704],
        [6.638726036847685, 46.7142735307],
        [6.63873795142482, 46.71427789361936],
        [6.638748580010834, 46.7142836088046],
        [6.638757599658524, 46.71429050260093],
        [6.638764736308355, 46.71429836554126],
        [6.638769773115979, 46.71430695871134],
        [6.638772061965137, 46.71431365976411],
      ],
    },
  },
  {
    // False-positive: the unused "outside" arc of the 3-arc loop (~10 m total).
    // 10 vertices all clustered in a ~5×7 m bbox. Should NOT be matched.
    id: 450224755,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.638772061965137, 46.71431365976411],
        [6.638773113966109, 46.714322892764244],
        [6.638771811578141, 46.71433211074016],
        [6.638768194376996, 46.71434103360729],
        [6.638762372273211, 46.714349390248785],
        [6.63875452217207, 46.714356926753275],
        [6.638744882597942, 46.714363414129735],
        [6.638733746446482, 46.714368655265005],
        [6.638721452084877, 46.71437249091268],
        [6.638708373070678, 46.714374804531225],
      ],
    },
  },
  {
    // Legitimate match: west leg from the roundabout junction back along the route.
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
];

/** 450224755 is the wrong arc — must be filtered out. */
export const EXPECTED_NOT_MATCHED_IDS: readonly number[] = [450224755];

/** 450224752 and 450224754 are legitimately matched — must stay matched. */
export const EXPECTED_MATCHED_IDS: readonly number[] = [450224752, 450224754];
