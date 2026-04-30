import { describe, it, expect } from "vitest";
import type { MultiLineString } from "geojson";
import type { WmeSDK } from "wme-sdk-typings";
import { WalkController } from "../controller/WalkController";

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
  segmentLines: Array<{ id: number; coordinates: number[][] }>,
): WmeSDK {
  const segments = segmentLines.map((segmentLine) => ({
    id: segmentLine.id,
    geometry: {
      type: "LineString" as const,
      coordinates: segmentLine.coordinates,
    },
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
});
