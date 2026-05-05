/**
 * Real-world false-positive captured from a guided matching run on
 * 2026-05-05 (row 59, km 74.1 → 74.6).
 *
 * Two distinct failure modes co-occur in this slice:
 *
 *  - 209560415: a short ~14 m kink that joins the route at junction
 *    [6.792936, 46.67112]. Both endpoints project onto the track within a
 *    couple of metres of each other — same shape as junctionFalsePositive.
 *    A projected-span / segment-length filter should catch it.
 *
 *  - 209560404: the **northern** half of a divided street that runs roughly
 *    parallel to the route at ~7 m offset. The actual route follows
 *    209560403 (the southern half). Both endpoints, all mid-vertices, and
 *    the full projected span fit inside a 15 m buffer — neither the
 *    projected-span ratio nor a per-vertex within-buffer test rejects it.
 *    Filtering this case requires either a tighter buffer or a
 *    mean-distance-to-track threshold (i.e. prefer the closer twin).
 *
 * This fixture is the trickiest one yet because it shows that the matcher
 * cannot rely solely on geometry of a *single* segment vs the track — the
 * presence of a closer parallel alternative is part of what makes 209560404
 * wrong.
 *
 * Source coordinates are stripped of the third (elevation) value present in
 * the raw user payload; lon/lat is sufficient for the matcher.
 */

import type { LineString, MultiLineString } from "geojson";

export const TRACK_SLICE_KM_A = 74.1;
export const TRACK_SLICE_KM_B = 74.6;

export const TRACK_SLICE: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6.793156166375617, 46.671148040070754],
      [6.792840103153139, 46.671120152343065],
      [6.792710103094578, 46.671100152190775],
      [6.792540103197098, 46.67105015227571],
      [6.7923001032322645, 46.6709901522845],
      [6.792220103088766, 46.67094015236944],
      [6.792220103088766, 46.67094015236944],
      [6.792180103249848, 46.67092015221715],
      [6.792080103419721, 46.67084015253931],
      [6.791990103200078, 46.67077015247196],
      [6.79191010305658, 46.67071015248075],
      [6.791720103472471, 46.670530152507126],
      [6.791290103457868, 46.67010015249252],
      [6.79121010331437, 46.67003015242517],
      [6.791130103170872, 46.66994015267119],
      [6.791070103179663, 46.66986015252769],
      [6.7910601031035185, 46.669850152451545],
      [6.7910201032646, 46.66978015238419],
      [6.790960103273392, 46.669680152554065],
      [6.7908901032060385, 46.66956015257165],
      [6.790690103545785, 46.66919015254825],
      [6.790580103173852, 46.66897015273571],
      [6.790520103182644, 46.66886015282944],
      [6.790450103580952, 46.66874015284702],
      [6.790190103463829, 46.668240152765065],
      [6.79013010347262, 46.66814015246928],
      [6.790070103481412, 46.66806015279144],
      [6.7900201035663486, 46.66800015280023],
      [6.789970103185624, 46.66796015249565],
      [6.7899201032705605, 46.667920152656734],
      [6.789850103203207, 46.66787015274167],
      [6.78977010352537, 46.667820152360946],
      [6.789670103229582, 46.66778015252203],
      [6.789600103162229, 46.667750152759254],
      [6.789510103408247, 46.667730152606964],
      [6.789481066151122, 46.66772289325043],
    ],
  ],
};

export interface CapturedSegment {
  id: number;
  geometry: LineString;
}

export const MATCHED_SEGMENTS: CapturedSegment[] = [
  {
    id: 209560403,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.792208701044696, 46.6709314995333],
        [6.792254837768796, 46.67091771426829],
        [6.792303117531059, 46.67092875725936],
        [6.792469414490025, 46.671006058136115],
        [6.792936118858522, 46.67112200924283],
      ],
    },
  },
  {
    id: 209560404,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.792759093063593, 46.671193788375625],
        [6.792539864778601, 46.67111085428097],
        [6.792339592747256, 46.671016588545],
        [6.792208701044696, 46.6709314995333],
      ],
    },
  },
  {
    id: 209560405,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.792208701044696, 46.6709314995333],
        [6.792073711193648, 46.670834411465954],
      ],
    },
  },
  {
    id: 209560415,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.792759093063593, 46.671193788375625],
        [6.792839559334042, 46.67113857366682],
        [6.792874428051218, 46.671125690226766],
        [6.792936118858522, 46.67112200924283],
      ],
    },
  },
  {
    id: 209560857,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.792073711193648, 46.670834411465954],
        [6.791910439304838, 46.67070370342385],
        [6.791634171776333, 46.67044051041977],
        [6.791304260067468, 46.670109216704084],
        [6.791086243728207, 46.6698453383403],
      ],
    },
  },
  {
    id: 209560860,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.791086243728207, 46.6698453383403],
        [6.790926068596357, 46.66959018580007],
        [6.790589199803493, 46.66896422660312],
      ],
    },
  },
  {
    id: 209560861,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.790589199803493, 46.66896422660312],
        [6.790558606124658, 46.66890737801399],
      ],
    },
  },
  {
    id: 209563392,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.792936118858522, 46.67112200924283],
        [6.7934162342722555, 46.67116250004743],
        [6.793687137382837, 46.671160659556975],
        [6.793982180374456, 46.671122009243106],
        [6.794191392677562, 46.67106863495461],
        [6.794967857535401, 46.67080754280011],
      ],
    },
  },
  {
    id: 434358712,
    geometry: {
      type: "LineString",
      coordinates: [
        [6.789637001770206, 46.667757485527126],
        [6.789795252102028, 46.66782190671152],
        [6.789905222671691, 46.66789000902278],
        [6.790087612884666, 46.66804830055007],
        [6.790221723335398, 46.66826549049599],
        [6.790558606124658, 46.66890737801399],
      ],
    },
  },
];

export const FALSE_POSITIVE_IDS: readonly number[] = [209560404, 209560415];

export const TRUE_POSITIVE_IDS: readonly number[] = [
  209560403, 209560405, 209560857, 209560860, 209560861, 209563392, 434358712,
];
