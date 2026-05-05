/**
 * Real-world false-positive captured from a guided matching run on
 * 2026-05-05 (row 20, km 31.6 → 31.9).
 *
 * The route describes a small detour: it enters a junction, loops around via
 * 211527550 / 211527559 / 211527567, and exits at the other side. Segment
 * 211527557 is a chord that connects the two ends of this loop directly — its
 * endpoints land on the route (so a projected-span filter would happily keep
 * it) but its mid-points fall ~25-40 m from the track centerline, well
 * outside the 15 m buffer used by the matcher.
 *
 * This case complements junctionFalsePositive.ts: the two failure modes
 * together motivate a per-vertex distance check rather than a pure
 * intersects/within toggle.
 *
 * Source coordinates are stripped of the third (elevation) value present in
 * the raw user payload; lon/lat is sufficient for the matcher.
 */

import type { LineString, MultiLineString } from "geojson";

export const TRACK_SLICE_KM_A = 31.6;
export const TRACK_SLICE_KM_B = 31.9;

export const TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.757971920041547, 46.70625971042986],
      [6.757910134270787, 46.7061902009882],
      [6.757710134144872, 46.70597020117566],
      [6.757630134001374, 46.70586020126939],
      [6.757620134390891, 46.7058402011171],
      [6.757620134390891, 46.70580020127818],
      [6.757630134001374, 46.70575020136312],
      [6.757640134077519, 46.7057102015242],
      [6.757640134077519, 46.70568020129576],
      [6.7576301344670355, 46.70565020153299],
      [6.757610134314746, 46.7056302013807],
      [6.757560134399682, 46.70561020169407],
      [6.757510134484619, 46.70559020154178],
      [6.757430134341121, 46.70556020131335],
      [6.757340134121478, 46.70553020155057],
      [6.757260134443641, 46.705490201711655],
      [6.757130134385079, 46.70537020172924],
      [6.757030134089291, 46.70531020173803],
      [6.756780134048313, 46.70515020145103],
      [6.756710134446621, 46.70510020153597],
      [6.75654013408348, 46.70501020131633],
      [6.756310134194791, 46.7049102014862],
      [6.75618013413623, 46.704860201105475],
      [6.755930134095252, 46.704770201351494],
      [6.755690134130418, 46.70470020128414],
      [6.755560134071857, 46.704670201055706],
      [6.755188118038268, 46.70457719726385],
    ],
  ],
};

export interface CapturedSegment {
  id: number;
  geometry: LineString;
}

export const MATCHED_SEGMENTS: CapturedSegment[] = [
  {
    id: 211527550,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.757616918304115, 46.7058118520379],
        [6.757627647140204, 46.70571620782569],
        [6.757590096214029, 46.705613206175975],
      ],
    },
  },
  {
    id: 211527557,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.757616918304115, 46.7058118520379],
        [6.757466714599326, 46.7058008161768],
        [6.756994645812693, 46.705543312088246],
        [6.756967823722517, 46.70548813248129],
        [6.757010739066781, 46.70542559552497],
        [6.757112663009397, 46.705374094446825],
      ],
    },
  },
  {
    id: 211527559,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.757112663009397, 46.705374094446825],
        [6.757396977164887, 46.705550669364534],
        [6.757590096214029, 46.705613206175975],
      ],
    },
  },
  {
    id: 211527567,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.755924504342301, 46.704776642227245],
        [6.756050508239429, 46.704814936730116],
        [6.7564957549358855, 46.70499519215301],
        [6.75688199303408, 46.70520119761367],
        [6.757112663009397, 46.705374094446825],
      ],
    },
  },
  {
    id: 354149625,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.761015916870235, 46.708410033728605],
        [6.760041635253628, 46.70765113085519],
        [6.7594300915982055, 46.70724649489232],
        [6.758813183524783, 46.70687496283746],
        [6.758164088943185, 46.70644824959916],
        [6.757869045951519, 46.70615396264245],
        [6.757659833648379, 46.70591485330857],
        [6.757616918304115, 46.7058118520379],
      ],
    },
  },
  {
    id: 465194425,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.755387454446821, 46.704627123612205],
        [6.755578439452797, 46.70467146769845],
        [6.755924504342301, 46.704776642227245],
      ],
    },
  },
];

export const FALSE_POSITIVE_IDS: readonly number[] = [211527557];

export const TRUE_POSITIVE_IDS: readonly number[] = [
  211527550, 211527559, 211527567, 354149625, 465194425,
];
