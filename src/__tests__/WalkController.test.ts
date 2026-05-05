import { describe, it, expect } from "vitest";
import type { MultiLineString } from "geojson";
import type { RoadTypeId, WmeSDK } from "wme-sdk-typings";
import { WalkController } from "../controller/WalkController";
import {
  TRACK_SLICE as ROW_108_4_TRACK,
  MATCHED_SEGMENTS as ROW_108_4_SEGMENTS,
  EXPECTED_MATCHED_IDS as ROW_108_4_EXPECTED_IDS,
} from "./fixtures/sliceBoundaryFalseNegative4";

const ROAD_TYPE = {
  STREET: 1 as RoadTypeId,
  WALKWAY: 9 as RoadTypeId,
} as const;

function makeTrack(): MultiLineString {
  return {
    type: "MultiLineString",
    coordinates: [
      [
        [6.14, 46.2],
        [6.17, 46.2],
      ],
    ],
  };
}

function makeWmeSdkForSegments(
  segmentLines: Array<{ id: number; coordinates: number[][]; roadType?: RoadTypeId }>,
): WmeSDK {
  const segments = segmentLines.map((segmentLine) => ({
    id: segmentLine.id,
    geometry: {
      type: "LineString" as const,
      coordinates: segmentLine.coordinates,
    },
    roadType: segmentLine.roadType ?? ROAD_TYPE.STREET,
  }));

  return {
    DataModel: {
      Segments: {
        getAll: () => segments,
      },
    },
  } as unknown as WmeSDK;
}

describe("WalkController.matchInCurrentViewport", () => {
  it("matches only the requested track portion and resets previous results", async () => {
    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 101,
        coordinates: [
          [6.145, 46.2],
          [6.147, 46.2],
        ],
      },
      {
        id: 202,
        coordinates: [
          [6.165, 46.2],
          [6.1665, 46.2],
        ],
      },
      {
        id: 303,
        coordinates: [
          [6.145, 46.203],
          [6.147, 46.203],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, makeTrack());

    const foundIds: number[] = [];
    const progressPayloads: Array<{ visited: number; total: number; newIds: number[] }> = [];

    controller.onMatchFound((id) => {
      foundIds.push(id);
    });

    controller.onProgress((visited, total, newIds) => {
      progressPayloads.push({ visited, total, newIds });
    });

    await controller.matchInCurrentViewport(0, 1);

    expect(controller.getMatchedIds()).toEqual([101]);
    expect(foundIds).toEqual([101]);
    expect(progressPayloads[0]).toEqual({ visited: 1, total: 1, newIds: [101] });

    await controller.matchInCurrentViewport(1.5, 3);

    expect(controller.getMatchedIds()).toEqual([202]);
    expect(foundIds).toEqual([101, 202]);
    expect(progressPayloads[1]).toEqual({ visited: 1, total: 1, newIds: [202] });
  });

  it("emits empty progress when the sliced portion is empty", async () => {
    const wmeSdk = makeWmeSdkForSegments([]);
    const controller = new WalkController(wmeSdk, makeTrack());

    const progressPayloads: Array<{ visited: number; total: number; newIds: number[] }> = [];
    controller.onProgress((visited, total, newIds) => {
      progressPayloads.push({ visited, total, newIds });
    });

    await controller.matchInCurrentViewport(2, 1);

    expect(controller.getMatchedIds()).toEqual([]);
    expect(progressPayloads).toEqual([{ visited: 1, total: 1, newIds: [] }]);
  });

  it("ignores excluded non-drivable road types before matching", async () => {
    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 101,
        coordinates: [
          [6.145, 46.2],
          [6.147, 46.2],
        ],
        roadType: ROAD_TYPE.WALKWAY,
      },
      {
        id: 202,
        coordinates: [
          [6.145, 46.2],
          [6.147, 46.2],
        ],
        roadType: ROAD_TYPE.STREET,
      },
    ]);

    const controller = new WalkController(wmeSdk, makeTrack());

    await controller.matchInCurrentViewport(0, 1);

    expect(controller.getMatchedIds()).toEqual([202]);
  });

  it("filters endpoint-touch false positives in per-view matching", async () => {
    const track: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [6.82258009724319, 46.5766901448369],
          [6.82258009724319, 46.57671014452353],
          [6.822360096964985, 46.57757014455274],
          [6.822345036029799, 46.577611122945996],
        ],
      ],
    };

    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 149668185,
        coordinates: [
          [6.8225757699372, 46.576710574752994],
          [6.8224737820625, 46.57706539278598],
          [6.822345036029799, 46.577611122945996],
        ],
      },
      {
        id: 194838371,
        coordinates: [
          [6.822919028759101, 46.575472419282],
          [6.8228385624886, 46.57569919961698],
          [6.8226716530813, 46.57637871897299],
          [6.8225757699372, 46.576710574752994],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, track);
    await controller.matchInCurrentViewport(0, 1.9);

    expect(controller.getMatchedIds()).toEqual([149668185]);
  });

  it("keeps main-track segment and drops wrong branch near boundary", async () => {
    const track: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [6.820005270332357, 46.59337350549077],
          [6.820710095111281, 46.58856014162302],
          [6.82222009357065, 46.59973013959825],
          [6.822660094127059, 46.6025801403448],
          [6.821810093708336, 46.60504013998434],
          [6.8203801000490785, 46.60929014859721],
          [6.820270100142807, 46.60976014845073],
          [6.8202500314021295, 46.60985380233161],
          [6.8202500314021295, 46.66985380233161],
        ],
      ],
    };

    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 150196572,
        coordinates: [
          [6.8203808792531575, 46.60926461449832],
          [6.8203258939684055, 46.60928027657142],
          [6.82027761420613, 46.60934661000959],
          [6.8202239700258325, 46.60945163778731],
          [6.820124728292267, 46.60955850794884],
        ],
      },
      {
        id: 148830201,
        coordinates: [
          [6.82022012448004, 46.6100182683855],
          [6.8203808792531575, 46.60926461449832],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, track);
    await controller.matchInCurrentViewport(0, 3.8);

    expect(controller.getMatchedIds()).toEqual([148830201]);
  });

  it("matches boundary continuation on the next slice", async () => {
    const track: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [6.82, 46.6],
          [6.82, 46.609],
          [6.82, 46.618],
        ],
      ],
    };

    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 148830201,
        coordinates: [
          [6.82, 46.609],
          [6.82, 46.6092],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, track);
    await controller.matchInCurrentViewport(1, 1.4);

    expect(controller.getMatchedIds()).toEqual([148830201]);
  });

  it("matches short segment fully close to sliced track", async () => {
    const track: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [6.818242898333653, 46.616162844189674],
          [6.818260099738836, 46.61621014820412],
          [6.818370099645108, 46.616540148388594],
          [6.818390099797398, 46.61662014806643],
          [6.818410099949688, 46.61676014820114],
        ],
      ],
    };

    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 148830200,
        coordinates: [
          [6.818399618395936, 46.61669840551736],
          [6.8183471665368, 46.61650373080808],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, track);
    await controller.matchInCurrentViewport(0, 0.4);

    expect(controller.getMatchedIds()).toEqual([148830200]);
  });

  it("keeps end-boundary continuation on last slice", async () => {
    const track: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [6.817460100632161, 46.61894014943391],
          [6.817460100632161, 46.61913014994934],
          [6.817470100708306, 46.619430149905384],
          [6.817460101097822, 46.61961014987901],
          [6.817473283237659, 46.61962596847137],
        ],
      ],
    };

    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 316356276,
        coordinates: [
          [6.8179, 46.62],
          [6.8177, 46.6198],
          [6.81746, 46.6192],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, track);
    await controller.matchInCurrentViewport(0, 10);

    expect(controller.getMatchedIds()).toEqual([316356276]);
  });

  it("keeps a segment that follows enough of a short boundary slice", async () => {
    const wmeSdk = makeWmeSdkForSegments(
      ROW_108_4_SEGMENTS.map((segment) => ({
        id: segment.id,
        coordinates: segment.geometry.coordinates,
      })),
    );

    const controller = new WalkController(wmeSdk, ROW_108_4_TRACK);
    await controller.matchInCurrentViewport(0, 1);

    for (const id of ROW_108_4_EXPECTED_IDS) {
      expect(controller.getMatchedIds(), `expected ${id} to be matched`).toContain(id);
    }
  });

  it("drops a short branch that only touches the start of a slice", async () => {
    const track: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [6.79204949936424, 46.56237854783914],
          [6.792250127531588, 46.5623701880686, 717.1699829101562],
          [6.792440127115697, 46.562360187992454, 715.9399719238281],
          [6.792740127071738, 46.56235018745065, 714.1499938964844],
          [6.79302012687549, 46.56235018745065, 712.4399719238281],
          [6.793240126688033, 46.562350186984986, 711.0799865722656],
          [6.793520126491785, 46.56236018659547, 709.3699951171875],
          [6.793600126169622, 46.562370186671615, 708.8499755859375],
          [6.793860126286745, 46.56239018635824, 707.219970703125],
          [6.7942401259206235, 46.562440185807645, 704.8899841308594],
          [6.794550125487149, 46.56250018533319, 702.9599914550781],
          [6.794900125358254, 46.56258018501103, 700.6399841308594],
          [6.795250124763697, 46.562680184375495, 698.239990234375],
          [6.796470123808831, 46.5630401824601, 689.75],
          [6.7966701234690845, 46.56310018245131, 688.3199768066406],
          [6.797040123492479, 46.56321018189192, 686.0299987792969],
          [6.798230122309178, 46.56358018051833, 678.2699890136719],
          [6.798900121822953, 46.56378017924726, 673.4299926757812],
          [6.79930012114346, 46.563900178764015, 670.489990234375],
          [6.801680119242519, 46.564620175398886, 653.2699890136719],
          [6.801870118826628, 46.56468017492443, 651.9499816894531],
          [6.802450118586421, 46.5648601744324, 648.1799926757812],
          [6.803130118176341, 46.56506017362699, 645.0599975585938],
          [6.803380117751658, 46.56514017377049, 644.3099975585938],
          [6.803930117748678, 46.565310173202306, 643.0199890136719],
          [6.804770117625594, 46.56556017277762, 641.0899963378906],
          [6.805250117555261, 46.56571017252281, 640.0199890136719],
          [6.805710117332637, 46.56585017265752, 639.0399780273438],
          [6.8058601170778275, 46.56589017249644, 638.739990234375],
          [6.8063001171685755, 46.56603017216548, 637.7899780273438],
          [6.806350117083639, 46.56604017224163, 637.6699829101562],
          [6.807130116969347, 46.56630017189309, 634.8899841308594],
          [6.8079201159998775, 46.56658017076552, 630.5499877929688],
          [6.808480115607381, 46.56678016996011, 627.3899841308594],
          [6.809050115291029, 46.56699016969651, 624.3299865722656],
          [6.809300115332007, 46.56708016945049, 622.989990234375],
          [6.809890114702284, 46.567300168797374, 619.739990234375],
          [6.810100114438683, 46.56738016847521, 618.6199951171875],
          [6.811620113439858, 46.56794016622007, 608.8199768066406],
          [6.812360113020986, 46.568210165947676, 606.2099914550781],
          [6.812540112994611, 46.568270165938884, 605.9399719238281],
          [6.812850113026798, 46.5683901659213, 605.4499816894531],
          [6.8132901126518846, 46.568550165742636, 604.7799987792969],
          [6.81355682558649, 46.56864601562467],
        ],
      ],
    };

    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 149600570,
        coordinates: [
          [6.7920618095652, 46.562366913857],
          [6.7919535934924, 46.562190317643],
        ],
      },
      {
        id: 149603216,
        coordinates: [
          [6.7920618095652, 46.562366913857],
          [6.792419701999, 46.562354319508],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, track);
    await controller.matchInCurrentViewport(0, 1.8);

    expect(controller.getMatchedIds()).toContain(149603216);
    expect(controller.getMatchedIds()).not.toContain(149600570);
  });
});
