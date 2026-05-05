/**
 * Real-world false-negative captured from a guided matching run on
 * 2026-05-05 (row 9 in the captured run, km 108.4 → 108.6).
 *
 * Segment 149959928 traces from the loop apex at [6.8149591, 46.56916]
 * (which is exactly on the route) south-west through three on-track
 * vertices, with its final vertex landing at [6.81329, 46.56855] — about
 * 23 m past the slice's kmA boundary [6.81356, 46.56865]. The bulk of the
 * segment is inside the buffer; only the trailing tail crosses the slice
 * boundary.
 *
 * The segment was NOT matched by the auto-run. This either means:
 *  - the leaf slice used at match time was smaller than the row range and
 *    excluded the apex, or
 *  - some upstream filter (road type, viewport load) dropped it.
 *
 * The test asserts that, given this captured row-level slice and segment,
 * matchSegments must include 149959928. If `matchSegments` already returns
 * it, the test acts as a regression guard; if not, we have a direct
 * reproducer of the bug at the matcher level.
 *
 * Source coordinates are stripped of the third (elevation) value present in
 * the raw user payload; lon/lat is sufficient for the matcher.
 */

import type { LineString, MultiLineString } from "geojson";

export const TRACK_SLICE_KM_A = 108.4;
export const TRACK_SLICE_KM_B = 108.6;

export const TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.81355682558649, 46.56864601562467],
      [6.813930112868547, 46.568780165631324],
      [6.814420112874359, 46.56896016560495],
      [6.814430112950504, 46.56896016607061],
      [6.81476011313498, 46.56908016605303],
      [6.814900113269687, 46.56913016596809],
      [6.81493011303246, 46.569140166044235],
      [6.81495011318475, 46.569160165730864],
      [6.814970112871379, 46.56917016580701],
      [6.814980112947524, 46.5691901659593],
      [6.815170113462955, 46.56909016612917],
      [6.81512011308223, 46.56903016613796],
      [6.815080113243312, 46.56894016638398],
      [6.815060113556683, 46.56886016624048],
      [6.815040113404393, 46.56881016632542],
      [6.815000113565475, 46.56876016641036],
      [6.814940113574266, 46.568690166808665],
      [6.8148799250978795, 46.56863284447562],
    ],
  ],
};

export interface CapturedSegment {
  id: number;
  geometry: LineString;
}

export const SELECTED_SEGMENTS: CapturedSegment[] = [
  {
    id: 149959012,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.8149591088287, 46.569160618366],
        [6.8151416915885, 46.569135313119],
      ],
    },
  },
  {
    id: 475058307,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.814621166725974, 46.56833803489404],
        [6.8147264271965, 46.568487107427025],
        [6.814951732753799, 46.56870654106701],
        [6.8150643855324, 46.568846683094975],
        [6.815113281870399, 46.56898008496398],
        [6.8151416915885, 46.569135313119],
      ],
    },
  },
  {
    id: 149959928,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.8149591088287, 46.569160618366],
        [6.8148974180213, 46.569120051208],
        [6.8148062229148, 46.569079484021],
        [6.8132870759155, 46.568547537892],
      ],
    },
  },
];

export const EXPECTED_MATCHED_IDS: readonly number[] = [149959012, 475058307, 149959928];
