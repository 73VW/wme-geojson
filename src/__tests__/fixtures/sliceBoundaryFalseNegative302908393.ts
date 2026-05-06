/**
 * Real-world false-negative captured from a guided matching run on
 * 2026-05-06 (row 3, km 108.6 -> 109.1).
 *
 * Segment 302908393 follows the route closely on its northern half (vertex s2
 * sits within ~5m of the track), but its southern half extends past the slice
 * end. The captured run dropped the segment from the auto-selection while it
 * should have been kept (the user had to add it manually in WME).
 *
 * The slice is NOT the last portion of the track in production (kmB 109.1
 * versus a total track length above 109.1 km). The fixture reproduces that by
 * exposing a `TRACK_WITH_TAIL` that pads `TRACK_SLICE` with a far-away anchor
 * so that `matchInCurrentViewport(0, SLICE_LENGTH_KM)` runs with
 * `allowEndBoundaryContinuation = false`, mirroring production conditions.
 */

import { length as turfLength } from "@turf/turf";
import type { LineString, MultiLineString, Position } from "geojson";

export const TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.8148799250978795, 46.56863284447562],
      [6.814730113837868, 46.56849016714841, 611.1799926757812],
      [6.814640114083886, 46.568390167318285, 612.0299987792969],
      [6.814600113779306, 46.568330167327076, 612.5099792480469],
      [6.814570114016533, 46.56826016725972, 613.0399780273438],
      [6.814550113864243, 46.568200167268515, 613.5199890136719],
      [6.8145301141776145, 46.56811016751453, 614.2099914550781],
      [6.814500114414841, 46.56787016801536, 615.739990234375],
      [6.8144601145759225, 46.56748016830534, 618.3999938964844],
      [6.814420115202665, 46.567110168747604, 620.8599853515625],
      [6.8144001150503755, 46.56700016884133, 621.5699768066406],
      [6.814350115600973, 46.56644016969949, 625.3799743652344],
      [6.814310115762055, 46.566110169980675, 626.8099975585938],
      [6.81430011568591, 46.56603016983718, 626.969970703125],
      [6.81430011568591, 46.56603016983718, 626.969970703125],
      [6.814290115609765, 46.565920169930905, 627.0599975585938],
      [6.814290115609765, 46.56591016985476, 627.0499877929688],
      [6.814280115999281, 46.56590017024428, 627.0599975585938],
      [6.814250115770847, 46.56584017025307, 627.0999755859375],
      [6.814170115627348, 46.56574016995728, 627.1799926757812],
      [6.814170115627348, 46.56574016995728, 627.1899719238281],
      [6.814160116016865, 46.56571017019451, 627.219970703125],
      [6.813970115967095, 46.56542017031461, 627.75],
      [6.813840115908533, 46.565220170188695, 627.8199768066406],
      [6.8138201157562435, 46.56515017012134, 627.8899841308594],
      [6.813700115773827, 46.564750170335174, 628.3299865722656],
      [6.813660115934908, 46.56459017051384, 628.5],
      [6.813577152889215, 46.56429022634899],
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
    id: 146852911,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.8138523220246565, 46.56522477357059],
        [6.8140153288853, 46.56550737996],
        [6.81415787495225, 46.56572689545332],
      ],
    },
  },
  {
    id: 146852969,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.81415787495225, 46.56572689545332],
        [6.814280883257443, 46.56588810093465],
        [6.814314708112884, 46.56603778051838],
      ],
    },
  },
  {
    id: 149959113,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.8143497106956, 46.566419474745004],
        [6.8143962025653, 46.566892270261],
        [6.814418184816662, 46.56699954544706],
      ],
    },
  },
  {
    id: 149959430,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.814418184816662, 46.56699954544706],
        [6.814470181347661, 46.56748554434782],
      ],
    },
  },
  {
    id: 178632605,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.814314708112884, 46.56603778051838],
        [6.8143497106956, 46.566419474745004],
      ],
    },
  },
  {
    id: 302908394,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.813803773692961, 46.56511307770751],
        [6.8138523220246565, 46.56522477357059],
      ],
    },
  },
  {
    id: 475058306,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.814470181347661, 46.56748554434782],
        [6.8144927620898, 46.567781089351],
        [6.814524948598001, 46.567994993846],
        [6.8145574480286, 46.56819575718798],
        [6.8145923167458, 46.568297176753006],
        [6.814621166725974, 46.56833803489404],
      ],
    },
  },
  {
    id: 302908393,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.8134125377181, 46.56370114796402],
        [6.8134765177959, 46.56395901598001],
        [6.813803773692961, 46.56511307770751],
      ],
    },
  },
];

export const EXPECTED_MATCHED_IDS = [
  146852911, 146852969, 149959113, 149959430, 178632605, 302908394, 475058306, 302908393,
] as const;
