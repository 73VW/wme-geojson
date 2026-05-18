/**
 * Real-world false-positive captured from a guided matching run.
 *
 * Segment 444061303 is a ~150 m, 9-vertex segment that runs from the
 * south-west ([6.83955, 46.72380]) north-east up to the junction point
 * [6.841312844, 46.725087720549]. Its last vertex lands exactly on the
 * slice, but its other 8 vertices are 30-100 m south-west of the route.
 *
 * Currently the matcher includes 444061303 (false positive). It should be
 * filtered out because only its last vertex is on the slice — the body of
 * the segment curves through coordinates the route does NOT traverse.
 *
 * The legitimate neighbour 444061304 (which ends at the same junction point
 * as 444061303's last vertex but whose body correctly follows the route)
 * must remain matched.
 *
 * Geometric note: 444061303 only "touches" the slice at its very last vertex.
 * The other 8 vertices are far from the slice. The parallel-spur ratio guard
 * should catch it, but apparently does not — likely because the last vertex IS
 * on the slice and the count of close samples is too low to reach the ratio
 * check. A fix would add a minimum-closeSamples-relative-to-total floor BEFORE
 * applying the ratio, or switch to checking the projected span on slice
 * relative to segment length (very low for this case).
 *
 * TRACK_WITH_TAIL pads the slice with a far-away anchor so that
 * matchInCurrentViewport(0, SLICE_LENGTH_KM) runs with
 * allowEndBoundaryContinuation = false, mirroring production conditions.
 */

import { length as turfLength } from "@turf/turf";
import type { LineString, MultiLineString, Position } from "geojson";

// Same slice geometry as junctionLinkFalseNegative444061305_row2 (row 2, km 1.2 → 1.6).
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
    // False-positive: 9-vertex, ~150 m segment. Ends at the junction
    // [6.841312844, 46.725087720549] but its body curves through coordinates
    // 30-100 m south-west of the route. Should NOT be matched.
    id: 444061303,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.83955430984497, 46.72380828857418],
        [6.839603424072271, 46.723850250244084],
        [6.839686393737789, 46.72391891479489],
        [6.83991050720215, 46.724056243896484],
        [6.84072542190552, 46.72452545166021],
        [6.840954303741451, 46.72465515136718],
        [6.841131210327151, 46.724815368652294],
        [6.84127283096313, 46.72500228881841],
        [6.841312844074999, 46.725087720549],
      ],
    },
  },
  {
    // Legitimate match: ends at the same junction point as 444061303's last
    // vertex, but its body correctly follows the route. Must remain matched.
    id: 444061304,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.841845423511458, 46.72481820803783],
        [6.841312844074999, 46.725087720549],
      ],
    },
  },
];

/** 444061303 is the wrong path — must be filtered out. */
export const EXPECTED_NOT_MATCHED_IDS: readonly number[] = [444061303];

/** 444061304 is legitimately matched — must stay matched. */
export const EXPECTED_MATCHED_IDS: readonly number[] = [444061304];
