/**
 * Real-world false-negative captured from a guided matching run on
 * 2026-05-05 (rows 18/19, segment 210924767 missing on both auto-runs).
 *
 * Segment 210924767 has 2 vertices straddling the row 18 / row 19 boundary
 * at km 119.8:
 *   v1 [6.76875, 46.49661] — projects on row 19 track (km 119.8 → 120.3)
 *   v2 [6.76901, 46.49808] — projects on row 18 track (km 119.6 → 119.8),
 *     ~1 m from track point [6.76900, 46.49807]
 *
 * Same family as the previous two slice-boundary cases.
 */

import type { LineString, MultiLineString } from "geojson";

export const ROW_18_TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.770161481750508, 46.499266019795876],
      [6.769690113607794, 46.49910016730428],
      [6.769500113558024, 46.499030167236924],
      [6.7692801132798195, 46.49892016686499],
      [6.769230113364756, 46.498890166636556],
      [6.769200113136321, 46.49888016656041],
      [6.769150113221258, 46.49887016694993],
      [6.769160113297403, 46.49879016680643],
      [6.769100112840533, 46.49856016645208],
      [6.769020112697035, 46.498150165658444],
      [6.769000112544745, 46.498070165514946],
      [6.7689679985889235, 46.49788604565443],
    ],
  ],
};

export const ROW_19_TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.7689679985889235, 46.49788604565443],
      [6.768850112333894, 46.49721016502008],
      [6.768810112029314, 46.496990164741874],
      [6.768710112199187, 46.4963701646775],
      [6.7686801119707525, 46.49618016462773],
      [6.768610111903399, 46.495790164452046],
      [6.768560111988336, 46.49546016426757],
      [6.768550111912191, 46.49539016420022],
      [6.768470111768693, 46.49491016427055],
    ],
  ],
};

export const SEGMENT_210924767: { id: number; geometry: LineString } = {
  id: 210924767,
  geometry: {
    type: "LineString",
    coordinates: [
      [6.7687533744679, 46.49660753240399],
      [6.7690094923664, 46.498079523716996],
    ],
  },
};
