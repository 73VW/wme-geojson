/**
 * Real-world false-negative captured from a guided matching run.
 *
 * Segment 432486991 is missing from the auto-match output of slice row 52
 * (km 54.1 → 55.3). It starts at [6.542341, 46.728711], which is shared with
 * anchor segment 432486990 (already matched). Most of the segment's vertices
 * fall directly on the slice's first leg (slice vertices 0-4 at lng 6.5405-6.5417
 * lat 46.7291-46.7303 are within metres of segment's vertices), but the segment's
 * last vertex [6.540305, 46.73088] extends ~50m past the slice start vertex
 * [6.540546, 46.73037]. The segment "kisses" the slice from start onwards then
 * exits past the slice's start boundary. Same family as the 474406759 / 211268240
 * boundary-continuation cases.
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
      [6.54054606704795, 46.73037074065478],
      [6.540670501533896, 46.73017039615661],
      [6.540909697301686, 46.72987001482397],
      [6.541210537776351, 46.72956022247672],
      [6.541739716660231, 46.72912988206372],
      [6.543399424292147, 46.72790148621425],
      [6.5439104358665645, 46.72746019763872],
      [6.544150237459689, 46.72720029624179],
      [6.544309736695141, 46.72697035036981],
      [6.544530262704939, 46.72661044029519],
      [6.544659530278295, 46.72631008783355],
      // Adjacent duplicates dropped: [6.544662056490779,46.72631550487131] and
      // [6.544660673942417,46.726319992449135] are within centimetres of the
      // preceding vertex — turf would treat them as degenerate segments.
      [6.544740198645741, 46.72610021336004],
      [6.544800451025367, 46.72578042699024],
      [6.544830617960542, 46.72546040453017],
      [6.544820030685514, 46.72531008766964],
      [6.544800128787756, 46.72509042778984],
      [6.544749999418855, 46.72480036178604],
      [6.544619965367019, 46.72428026935086],
      [6.544540246017277, 46.723960283678025],
      [6.54434059234336, 46.72330020554364],
      [6.544219557195902, 46.722790078725666],
      [6.543780448846519, 46.721189830917865],
      [6.5436904625967145, 46.720779803581536],
      [6.543923310612233, 46.720738532751405],
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
    // Anchor: already matched, shares endpoint [6.542341, 46.728711] with 432486991's first vertex.
    id: 432486990,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.543854199094, 46.727536634262],
        [6.543462470986, 46.727873541356],
        [6.542341140377, 46.728711712523],
      ],
    },
  },
  {
    // The false-negative: starts where 432486990 ends (shared junction vertex),
    // its vertices track the slice's initial leg northward, then the last vertex
    // [6.540305, 46.73088] extends ~50m past the slice start vertex [6.540546, 46.73037].
    id: 432486991,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.542341140377481, 46.728711712523065],
        [6.541512193081835, 46.729309950003575],
        [6.541080357430442, 46.729694197089536],
        [6.540927471516568, 46.72985782300841],
        [6.5406833904962545, 46.730166688557965],
        [6.54051441132829, 46.73042775210712],
        [6.540305199025141, 46.730880014138954],
      ],
    },
  },
];

/**
 * The matcher must include 432486991 in its output for this slice.
 * (432486990 is expected to continue matching as it already did.)
 */
export const EXPECTED_MATCHED_IDS = [432486991] as const;
