/**
 * Real-world false-positive captured from a guided matching run on
 * 2026-04-29 (row 1, km 98 → 98.5).
 *
 * The track describes a U-turn loop: it goes west-then-east (peaks at lon
 * 6.66430), and the eastbound and westbound branches are 50–60 m apart in
 * latitude.
 *
 * Segment 211742068 has only two vertices — one on each branch:
 *   v1 [6.66477, 46.63732] — on the eastbound branch (~track km X)
 *   v2 [6.66500, 46.63679] — on the westbound branch (~track km X − ~150 m
 *     along the track due to the U-turn)
 *
 * Both endpoints fall inside the 15 m buffer; the chord between them is
 * ~26 m off the centerline at its midpoint. A *per-vertex* within-buffer
 * filter would NOT catch this — the segment has no internal vertices to
 * sample. A projected-span ratio also fails: the cumulative km span between
 * the two projections is large (the U-turn distance) versus the chord
 * length, so the ratio is too high to flag.
 *
 * This case suggests the matcher needs to **densify** the candidate
 * segment (sample interior points along each edge) before applying a
 * within-buffer or distance-to-track threshold.
 */

import type { LineString, MultiLineString } from "geojson";

export const TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.665768975291917, 46.63645482173702],
      [6.665610148571432, 46.63652022089809],
      [6.665230148471892, 46.636700220406055],
      [6.66495014866814, 46.63683022046462],
      [6.664360148366541, 46.637080220039934],
      [6.664300148375332, 46.637100220192224],
      [6.664500148501247, 46.63719022041187],
      [6.664510148577392, 46.63719022041187],
      [6.66474014846608, 46.63730022031814],
      [6.665010148193687, 46.6374302203767],
      [6.6655201483517885, 46.63768021995202],
      [6.6658701482228935, 46.63784021977335],
      [6.666130148340017, 46.637970219831914],
      [6.6663201483897865, 46.63805021997541],
      [6.6667301482521, 46.63822021987289],
      [6.66688014799729, 46.638270219787955],
      [6.666960148140788, 46.638310219626874],
      [6.667300148401409, 46.63845021976158],
      [6.667500148061663, 46.63854021998122],
      [6.667470148298889, 46.638670220039785],
      [6.6674501481465995, 46.63875021971762],
      [6.667390148155391, 46.638990219682455],
      [6.667345244118143, 46.63919977208862],
    ],
  ],
};

export interface CapturedSegment {
  id: number;
  geometry: LineString;
}

export const MATCHED_SEGMENTS: CapturedSegment[] = [
  {
    id: 150560256,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.664774166132, 46.637319399137],
        [6.664419631514, 46.63715462347802],
        [6.6643150580073, 46.637080693781016],
      ],
    },
  },
  {
    id: 150612993,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6643150580073, 46.637080693781016],
        [6.6644451451446, 46.63703465249402],
        [6.665001473730001, 46.636791119244016],
      ],
    },
  },
  {
    id: 150888214,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6675044000149, 46.638563027083],
        [6.6673863828182, 46.638478313406],
        [6.6673032343388, 46.638434114913],
        [6.6669699728477, 46.638324155119],
      ],
    },
  },
  {
    id: 150888215,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6669699728477, 46.638324155119],
        [6.6668626630248, 46.638288748142],
      ],
    },
  },
  {
    id: 150888217,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6668626630248, 46.638288748142],
        [6.6664866689962, 46.638138269153],
      ],
    },
  },
  {
    id: 150888227,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.665504958275, 46.637676939660984],
        [6.665007494006301, 46.637433984912015],
      ],
    },
  },
  {
    id: 150888229,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.665007494006301, 46.637433984912015],
        [6.664840663848899, 46.637351412398004],
      ],
    },
  },
  {
    id: 150888230,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6648406638489, 46.637351412398],
        [6.664774166132, 46.637319399137],
      ],
    },
  },
  {
    id: 150956891,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6651974777502, 46.636701899923985],
        [6.6658058491717, 46.63643039225899],
      ],
    },
  },
  {
    id: 150956892,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6658058491717, 46.63643039225899],
        [6.665886667096017, 46.63639506308706],
        [6.665948709557227, 46.63633395043282],
      ],
    },
  },
  {
    id: 211742067,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.665504958275, 46.637676939660984],
        [6.6664866689962, 46.638138269153],
      ],
    },
  },
  {
    id: 211742068,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.664774166132, 46.637319399137],
        [6.665001473730001, 46.636791119244016],
      ],
    },
  },
  {
    id: 294093484,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6651974777502, 46.636701899923985],
        [6.665001473730001, 46.636791119244016],
      ],
    },
  },
  {
    id: 420349311,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.6673750574, 46.639772100026],
        [6.667329, 46.639497],
        [6.667351514101, 46.639065781613],
        [6.667504400015, 46.638563027083],
      ],
    },
  },
];

export const FALSE_POSITIVE_IDS: readonly number[] = [211742068];

export const TRUE_POSITIVE_IDS: readonly number[] = [
  150560256, 150612993, 150888214, 150888215, 150888217, 150888227, 150888229, 150888230,
  150956891, 150956892, 211742067, 294093484, 420349311,
];
