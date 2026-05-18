/**
 * Real-world false-negative captured from a guided matching run.
 *
 * Segment 444061305 is the short "link" segment (~14 m) missing from the
 * auto-match output of slice row 2 (km 1.2 → 1.6). It connects two already-
 * matched segments at a junction:
 *  - 444061304 ends at [6.841312844, 46.725087720549]
 *  - 444061305 starts at [6.841312844, 46.725087720549], ends at [6.841171461, 46.7251572565239]
 *  - 297977222 ends at [6.841171461, 46.7251572565239] (reverse-direction anchor)
 *
 * The user had to add 444061305 manually. It should appear in the auto-match
 * output for this slice.
 *
 * Note: the GPS track has a small "wiggle" at indices ~17-22 (back-and-forth
 * vertices). These are kept as-is — they reflect real GPS data.
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
      [6.843538506350346, 46.72364785193266],
      [6.843390117865056, 46.723820174112916, 636.3599853515625],
      [6.843340117949992, 46.723880174104124, 636.3999938964844],
      [6.843230117578059, 46.723990174010396, 636.4599914550781],
      [6.843180117662996, 46.724050174001604, 636.489990234375],
      [6.843070117756724, 46.724140173755586, 636.5399780273438],
      [6.842990117613226, 46.724200173746794, 636.5599975585938],
      [6.842960117850453, 46.724220173899084, 636.5999755859375],
      [6.8428701176308095, 46.72428017389029, 636.5599975585938],
      [6.842800117563456, 46.72432017372921, 636.5499877929688],
      [6.842630117665976, 46.724410173948854, 636.5999755859375],
      [6.842070117592812, 46.72470017382875, 636.6699829101562],
      [6.841830117627978, 46.72482017381117, 636.739990234375],
      [6.841720117721707, 46.724880173802376, 636.7699890136719],
      [6.841300117783248, 46.72508017392829, 636.9199829101562],
      [6.841450117528439, 46.72520017391071, 636.2899780273438],
      [6.841590117663145, 46.725300173740834, 635.739990234375],
      [6.841650117654353, 46.72534017357975, 635.5599975585938],
      [6.841780117247254, 46.725260173436254, 634.1199951171875],
      [6.841870117466897, 46.725200173445046, 633.489990234375],
      [6.841780117247254, 46.725260173436254, 634.1199951171875],
      [6.841650117654353, 46.72534017357975, 635.5599975585938],
      [6.841590117663145, 46.725300173740834, 635.739990234375],
      [6.841450117528439, 46.72520017391071, 636.2899780273438],
      [6.841300117783248, 46.72508017392829, 636.9199829101562],
      [6.841190117876977, 46.7251401739195, 636.989990234375],
      [6.840920117683709, 46.725260173901916, 637.3399963378906],
      [6.840877599870065, 46.7252780761886],
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
    // Chain neighbour immediately before the false-negative.
    // Ends at [6.841312844, 46.725087720549] — the shared junction vertex.
    id: 444061304,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.841845423511458, 46.72481820803783],
        [6.841312844074999, 46.725087720549],
      ],
    },
  },
  {
    // The false-negative: ~14 m link segment at the junction.
    // Starts where 444061304 ends, ends where 297977222 ends.
    // Currently NOT matched by the auto-matcher.
    id: 444061305,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.841312844074999, 46.725087720549],
        [6.841171461105225, 46.7251572565239],
      ],
    },
  },
  {
    // Chain neighbour on the other side of the junction.
    // Ends at [6.841171461, 46.7251572565239] — the other shared junction vertex.
    id: 297977222,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.840472001354722, 46.7254546384343],
        [6.841171461105225, 46.7251572565239],
      ],
    },
  },
];

/**
 * The matcher must include 444061305 in its output for this slice.
 * (444061304 and 297977222 are expected to continue matching as anchors.)
 */
export const EXPECTED_MATCHED_IDS = [444061305] as const;
