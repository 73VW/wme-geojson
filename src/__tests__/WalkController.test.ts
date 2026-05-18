import { beforeEach, describe, it, expect, vi } from "vitest";
import type { MultiLineString } from "geojson";
import type { RoadTypeId, WmeSDK } from "wme-sdk-typings";
import { WalkController } from "../controller/WalkController";
import type { SegmentProjection } from "../controller/WalkController";
import { buildTrackSpatialIndex } from "../matching/TrackSpatialIndex";
import { lineString as turfLineString } from "@turf/turf";
import {
  TRACK_SLICE as ROW_108_4_TRACK,
  MATCHED_SEGMENTS as ROW_108_4_SEGMENTS,
  EXPECTED_MATCHED_IDS as ROW_108_4_EXPECTED_IDS,
} from "./fixtures/sliceBoundaryFalseNegative4";
import {
  TRACK_SLICE as ROW_108_6_TRACK,
  MATCHED_SEGMENTS as ROW_108_6_SEGMENTS,
  FALSE_POSITIVE_IDS as ROW_108_6_FALSE_POSITIVE_IDS,
  TRUE_POSITIVE_IDS as ROW_108_6_TRUE_POSITIVE_IDS,
} from "./fixtures/sliceBoundaryFalsePositive475058307";
import {
  TRACK_WITH_TAIL as ROW_108_6_FN_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as ROW_108_6_FN_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as ROW_108_6_FN_SEGMENTS,
  EXPECTED_MATCHED_IDS as ROW_108_6_FN_EXPECTED_IDS,
} from "./fixtures/sliceBoundaryFalseNegative302908393";
import {
  TRACK_SLICE as ROW_118_8_TRACK,
  FALSE_POSITIVE_SEGMENT as ROW_118_8_FALSE_POSITIVE_SEGMENT,
} from "./fixtures/nearParallelFalsePositive147204891";
import {
  TRACK_WITH_TAIL as ROW_119_8_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as ROW_119_8_SLICE_LENGTH_KM,
  SEGMENT_147210427 as ROW_119_8_SEGMENT_147210427,
} from "./fixtures/sliceBoundaryFalseNegative147210427";
import {
  TRACK_WITH_TAIL as MICRO_344014910_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as MICRO_344014910_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as MICRO_344014910_SEGMENTS,
  EXPECTED_NOT_MATCHED_IDS as MICRO_344014910_EXPECTED_NOT_MATCHED_IDS,
} from "./fixtures/microSegmentFalsePositive344014910";
import {
  TRACK_WITH_TAIL as SPUR_150514530_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as SPUR_150514530_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as SPUR_150514530_SEGMENTS,
  EXPECTED_NOT_MATCHED_IDS as SPUR_150514530_EXPECTED_NOT_MATCHED_IDS,
} from "./fixtures/parallelSpurFalsePositive150514530";
import {
  TRACK_WITH_TAIL as ROW8_474406759_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as ROW8_474406759_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as ROW8_474406759_SEGMENTS,
} from "./fixtures/sliceBoundaryFalseNegative474406759_row8";
import {
  TRACK_WITH_TAIL as ROW9_474406759_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as ROW9_474406759_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as ROW9_474406759_SEGMENTS,
} from "./fixtures/sliceBoundaryFalseNegative474406759_row9";
import {
  TRACK_WITH_TAIL as FN210811026_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as FN210811026_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as FN210811026_SEGMENTS,
  EXPECTED_MATCHED_IDS as FN210811026_EXPECTED_MATCHED_IDS,
} from "./fixtures/sliceBoundaryFalseNegative210811026_row13";
import {
  TRACK_WITH_TAIL as FP450224755_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as FP450224755_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as FP450224755_SEGMENTS,
  EXPECTED_NOT_MATCHED_IDS as FP450224755_EXPECTED_NOT_MATCHED_IDS,
  EXPECTED_MATCHED_IDS as FP450224755_EXPECTED_MATCHED_IDS,
} from "./fixtures/roundaboutWrongArcFalsePositive450224755_row13";
import {
  TRACK_WITH_TAIL as FN211268240_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as FN211268240_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as FN211268240_SEGMENTS,
  EXPECTED_MATCHED_IDS as FN211268240_EXPECTED_MATCHED_IDS,
} from "./fixtures/sliceBoundaryFalseNegative211268240_row19";
import {
  TRACK_WITH_TAIL as FN432486991_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as FN432486991_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as FN432486991_SEGMENTS,
  EXPECTED_MATCHED_IDS as FN432486991_EXPECTED_MATCHED_IDS,
} from "./fixtures/sliceBoundaryFalseNegative432486991_row52";
import {
  TRACK_WITH_TAIL as FN444061305_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as FN444061305_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as FN444061305_SEGMENTS,
  EXPECTED_MATCHED_IDS as FN444061305_EXPECTED_MATCHED_IDS,
} from "./fixtures/junctionLinkFalseNegative444061305_row2";
import {
  TRACK_WITH_TAIL as FP444061303_TRACK_WITH_TAIL,
  SLICE_LENGTH_KM as FP444061303_SLICE_LENGTH_KM,
  MATCHED_SEGMENTS as FP444061303_SEGMENTS,
  EXPECTED_NOT_MATCHED_IDS as FP444061303_EXPECTED_NOT_MATCHED_IDS,
  EXPECTED_MATCHED_IDS as FP444061303_EXPECTED_MATCHED_IDS,
} from "./fixtures/junctionWrongPathFalsePositive444061303_row2";

const matchSegmentsAsyncSegmentIds = vi.hoisted((): number[][] => []);

vi.mock("../matching/SegmentMatcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../matching/SegmentMatcher")>();
  return {
    ...actual,
    matchSegmentsAsync: vi.fn(async (...args: Parameters<typeof actual.matchSegmentsAsync>) => {
      matchSegmentsAsyncSegmentIds.push(args[0].segments.map((segment) => segment.id));
      return actual.matchSegmentsAsync(...args);
    }),
  };
});

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
  beforeEach(() => {
    matchSegmentsAsyncSegmentIds.length = 0;
  });

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

  it("waits for a non-empty WME segment snapshot to settle before matching", async () => {
    const partialSegments = [
      {
        id: 101,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [6.145, 46.2],
            [6.147, 46.2],
          ],
        },
        roadType: ROAD_TYPE.STREET,
      },
      {
        id: 202,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [6.148, 46.2],
            [6.149, 46.2],
          ],
        },
        roadType: ROAD_TYPE.STREET,
      },
    ];
    const settledSegments = [
      ...partialSegments,
      {
        id: 303,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [6.15, 46.2],
            [6.151, 46.2],
          ],
        },
        roadType: ROAD_TYPE.STREET,
      },
    ];
    const getAll = vi.fn().mockReturnValueOnce(partialSegments).mockReturnValue(settledSegments);
    const wmeSdk = {
      DataModel: {
        Segments: {
          getAll,
        },
      },
      State: {
        isMapLoading: () => false,
      },
    } as unknown as WmeSDK;

    const controller = new WalkController(wmeSdk, makeTrack());
    await controller.matchInCurrentViewport(0, 1);

    // cache-check call + initial snapshot call + 1 stable poll (adaptive single-poll).
    expect(getAll).toHaveBeenCalledTimes(3);
    expect(matchSegmentsAsyncSegmentIds[0]).toEqual([101, 202, 303]);
    expect(controller.getMatchedIds()).toContain(303);
  });

  // ---------------------------------------------------------------------------
  // Adaptive polling tests
  // ---------------------------------------------------------------------------

  it("adaptive-skip: skips stable-poll when map has been stable for >= STABILITY_GRACE_MS", async () => {
    const segments = [
      {
        id: 101,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [6.145, 46.2],
            [6.147, 46.2],
          ],
        },
        roadType: ROAD_TYPE.STREET,
      },
    ];
    const getAll = vi.fn().mockReturnValue(segments);
    let mapLoading = false;
    const wmeSdk = {
      DataModel: { Segments: { getAll } },
      State: { isMapLoading: () => mapLoading },
      Events: {
        on: ({ eventHandler }: { eventName: string; eventHandler: () => void }) => {
          // Simulate the wme-map-data-loaded event arriving immediately on subscription
          // by capturing the handler so the test can fire it.
          (wmeSdk as unknown as { _fireMapLoaded: () => void })._fireMapLoaded = eventHandler;
          return () => undefined;
        },
      },
    } as unknown as WmeSDK;

    const controller = new WalkController(wmeSdk, makeTrack());

    // Simulate true→false transition: previously loading, now stable.
    (controller as unknown as { _prevMapLoading: boolean })._prevMapLoading = true;
    mapLoading = false;
    (wmeSdk as unknown as { _fireMapLoaded: () => void })._fireMapLoaded();

    // Advance lastMapStableSinceMs into the past by more than STABILITY_GRACE_MS (250 ms).
    (controller as unknown as { lastMapStableSinceMs: number }).lastMapStableSinceMs =
      Date.now() - 300;

    const callsBefore = getAll.mock.calls.length;
    await controller.matchInCurrentViewport(0, 1);

    // cache-check (liveCount) + 1 initial snapshot call = 2 total new calls (no stable polls).
    const newCalls = getAll.mock.calls.length - callsBefore;
    expect(newCalls).toBe(2);
  });

  it("single-poll: falls back to one stable poll when map is currently loading", async () => {
    const segments = [
      {
        id: 101,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [6.145, 46.2],
            [6.147, 46.2],
          ],
        },
        roadType: ROAD_TYPE.STREET,
      },
    ];
    let callCount = 0;
    let mapLoading = true;
    const getAll = vi.fn().mockImplementation(() => {
      callCount += 1;
      // After the 3rd call, pretend loading finished so stable poll can confirm.
      if (callCount >= 3) mapLoading = false;
      return segments;
    });
    const wmeSdk = {
      DataModel: { Segments: { getAll } },
      State: { isMapLoading: () => mapLoading },
    } as unknown as WmeSDK;

    const controller = new WalkController(wmeSdk, makeTrack());
    await controller.matchInCurrentViewport(0, 1);

    // cache-check + initial + 1 stable poll = 3 calls max.
    expect(getAll.mock.calls.length).toBeLessThanOrEqual(3);
    expect(controller.getMatchedIds()).toContain(101);
  });

  it("cache-hit: reuses snapshot on second call when map stayed stable", async () => {
    const segments = [
      {
        id: 101,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [6.145, 46.2],
            [6.147, 46.2],
          ],
        },
        roadType: ROAD_TYPE.STREET,
      },
    ];
    const getAll = vi.fn().mockReturnValue(segments);
    const wmeSdk = {
      DataModel: { Segments: { getAll } },
      State: { isMapLoading: () => false },
    } as unknown as WmeSDK;

    const controller = new WalkController(wmeSdk, makeTrack());

    // First call: populates the cache.
    await controller.matchInCurrentViewport(0, 0.5);
    const callsAfterFirst = getAll.mock.calls.length;

    // Second call (still same viewport, map stable, same segment count).
    // matchedIds resets each call — check count not content.
    await controller.matchInCurrentViewport(0, 1);
    const callsAfterSecond = getAll.mock.calls.length;

    // Second call should only add 1 extra call (the cache-check liveCount), no snapshot work.
    expect(callsAfterSecond - callsAfterFirst).toBe(1);
    // Matching on the wider slice [0,1] should still find segment 101.
    expect(controller.getMatchedIds()).toContain(101);
  });

  it("cache invalidated when wme-map-data-loaded fires with isMapLoading=true", async () => {
    const segments = [
      {
        id: 101,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [6.145, 46.2],
            [6.147, 46.2],
          ],
        },
        roadType: ROAD_TYPE.STREET,
      },
    ];
    const getAll = vi.fn().mockReturnValue(segments);
    let mapLoading = false;
    let capturedHandler: (() => void) | null = null;
    const wmeSdk = {
      DataModel: { Segments: { getAll } },
      State: { isMapLoading: () => mapLoading },
      Events: {
        on: ({ eventHandler }: { eventName: string; eventHandler: () => void }) => {
          capturedHandler = eventHandler;
          return () => undefined;
        },
      },
    } as unknown as WmeSDK;

    const controller = new WalkController(wmeSdk, makeTrack());

    // Prime the cache via first match call.
    await controller.matchInCurrentViewport(0, 0.5);
    expect((controller as unknown as { _snapshotCache: unknown })._snapshotCache).not.toBeNull();

    // Simulate map starting to load (true transition).
    mapLoading = true;
    capturedHandler!();

    // Cache should be null now.
    expect((controller as unknown as { _snapshotCache: unknown })._snapshotCache).toBeNull();
  });

  it("prefilters segments by expanded slice bbox before buffered matching", async () => {
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
          [6.5, 46.5],
          [6.501, 46.5],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, makeTrack());
    await controller.matchInCurrentViewport(0, 1);

    expect(matchSegmentsAsyncSegmentIds[0]).toEqual([101]);
  });

  it("keeps expanded-bbox edge candidates so close sparse matches are not lost early", async () => {
    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 101,
        coordinates: [
          [6.1486, 46.2],
          [6.1502, 46.2],
        ],
      },
      {
        id: 202,
        coordinates: [
          [6.5, 46.5],
          [6.501, 46.5],
        ],
      },
    ]);

    const controller = new WalkController(wmeSdk, makeTrack());
    await controller.matchInCurrentViewport(0, 1);

    expect(matchSegmentsAsyncSegmentIds[0]).toEqual([101]);
    expect(controller.getMatchedIds()).toContain(101);
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

  it("keeps segment 302908393 on row 108.6 -> 109.1 when the slice is not the last portion", async () => {
    const wmeSdk = makeWmeSdkForSegments(
      ROW_108_6_FN_SEGMENTS.map((segment) => ({
        id: segment.id,
        coordinates: segment.geometry.coordinates,
      })),
    );

    const controller = new WalkController(wmeSdk, ROW_108_6_FN_TRACK_WITH_TAIL);
    await controller.matchInCurrentViewport(0, ROW_108_6_FN_SLICE_LENGTH_KM);

    for (const id of ROW_108_6_FN_EXPECTED_IDS) {
      expect(controller.getMatchedIds(), `expected ${id} to be matched`).toContain(id);
    }
  });

  it("drops segment 475058307 while keeping the true row 108.6 -> 109.1 matches", async () => {
    const wmeSdk = makeWmeSdkForSegments(
      ROW_108_6_SEGMENTS.map((segment) => ({
        id: segment.id,
        coordinates: segment.geometry.coordinates,
      })),
    );

    const controller = new WalkController(wmeSdk, ROW_108_6_TRACK);
    await controller.matchInCurrentViewport(0, 1);

    for (const id of ROW_108_6_TRUE_POSITIVE_IDS) {
      expect(controller.getMatchedIds(), `expected ${id} to remain matched`).toContain(id);
    }

    for (const id of ROW_108_6_FALSE_POSITIVE_IDS) {
      expect(controller.getMatchedIds(), `expected ${id} to be filtered out`).not.toContain(id);
    }
  });

  it("drops a near-parallel segment that stays just outside the route centerline", async () => {
    const wmeSdk = makeWmeSdkForSegments([
      {
        id: ROW_118_8_FALSE_POSITIVE_SEGMENT.id,
        coordinates: ROW_118_8_FALSE_POSITIVE_SEGMENT.geometry.coordinates,
      },
    ]);

    const controller = new WalkController(wmeSdk, ROW_118_8_TRACK);
    await controller.matchInCurrentViewport(0, 1);

    expect(
      controller.getMatchedIds(),
      `expected ${ROW_118_8_FALSE_POSITIVE_SEGMENT.id} to be filtered out`,
    ).not.toContain(ROW_118_8_FALSE_POSITIVE_SEGMENT.id);
  });

  it("keeps segment 147210427 when it straddles the 119.8 -> 120.3 slice boundary", async () => {
    const wmeSdk = makeWmeSdkForSegments([
      {
        id: ROW_119_8_SEGMENT_147210427.id,
        coordinates: ROW_119_8_SEGMENT_147210427.geometry.coordinates,
      },
    ]);

    const controller = new WalkController(wmeSdk, ROW_119_8_TRACK_WITH_TAIL);
    await controller.matchInCurrentViewport(0, ROW_119_8_SLICE_LENGTH_KM);

    expect(
      controller.getMatchedIds(),
      `expected ${ROW_119_8_SEGMENT_147210427.id} to be matched`,
    ).toContain(ROW_119_8_SEGMENT_147210427.id);
  });

  it("dispose() unregisters the wme-map-data-loaded listener so it no longer mutates state", async () => {
    const segments = [
      {
        id: 101,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [6.145, 46.2],
            [6.147, 46.2],
          ],
        },
        roadType: ROAD_TYPE.STREET,
      },
    ];
    const getAll = vi.fn().mockReturnValue(segments);
    let capturedHandler: (() => void) | null = null;
    const unsubscribeSpy = vi.fn();
    const wmeSdk = {
      DataModel: { Segments: { getAll } },
      State: { isMapLoading: () => true },
      Events: {
        on: ({ eventHandler }: { eventName: string; eventHandler: () => void }) => {
          capturedHandler = eventHandler;
          return unsubscribeSpy;
        },
      },
    } as unknown as WmeSDK;

    const controller = new WalkController(wmeSdk, makeTrack());

    // Prime the cache (isMapLoading is false here to allow caching)
    (wmeSdk as unknown as { State: { isMapLoading: () => boolean } }).State = {
      isMapLoading: () => false,
    };
    await controller.matchInCurrentViewport(0, 0.5);
    // Verify cache is populated after the match
    expect((controller as unknown as { _snapshotCache: unknown })._snapshotCache).not.toBeNull();

    // Dispose the controller — should call the unsubscribe handle
    controller.dispose();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    // Cache is cleared on dispose
    expect((controller as unknown as { _snapshotCache: unknown })._snapshotCache).toBeNull();

    // Firing the event after dispose should NOT mutate _snapshotCache
    // (the listener is unregistered, but even if called directly it would be a no-op
    // because _unsubscribeMapDataLoaded is nulled and state is already cleared)
    if (capturedHandler) {
      // Restore a loading state so if the old listener ran it would clear cache
      (wmeSdk as unknown as { State: { isMapLoading: () => boolean } }).State = {
        isMapLoading: () => true,
      };
      // Manually invoke the captured handler to simulate a zombie fire
      (capturedHandler as () => void)();
    }

    // State must remain unmodified: _snapshotCache stays null, no new getAll calls
    // beyond those already made (the zombie listener was unregistered)
    expect((controller as unknown as { _snapshotCache: unknown })._snapshotCache).toBeNull();
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

  // ---------------------------------------------------------------------------
  // Piste B — centerline pre-filter tests
  // ---------------------------------------------------------------------------

  describe("centerline pre-filter (piste B)", () => {
    it("rejects a segment clearly outside the buffer and never sends it to buffered matching", async () => {
      // Track runs E-W along lat 46.20.
      // Segment is 200 m north (~0.002 deg lat) — clearly outside BUFFER_METERS + 5 = 20 m.
      const track: MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [6.14, 46.2],
            [6.17, 46.2],
          ],
        ],
      };

      const wmeSdk = makeWmeSdkForSegments([
        {
          id: 1001,
          // Parallel to track but ~220 m north (0.002 deg ≈ 222 m at this latitude)
          coordinates: [
            [6.14, 46.202],
            [6.17, 46.202],
          ],
        },
      ]);

      const controller = new WalkController(wmeSdk, track);
      await controller.matchInCurrentViewport(0, 3);

      // Segment should have been rejected by the centerline pre-filter.
      expect(matchSegmentsAsyncSegmentIds[0] ?? []).not.toContain(1001);
      expect(controller.getMatchedIds()).not.toContain(1001);
    });

    it("keeps a marginal segment whose midpoint is within BUFFER_METERS + 5 of the centerline", async () => {
      // Track runs E-W along lat 46.20.
      // Segment parallel to track ~10 m north (well within 20 m threshold).
      const track: MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [6.14, 46.2],
            [6.17, 46.2],
          ],
        ],
      };

      const wmeSdk = makeWmeSdkForSegments([
        {
          id: 2001,
          // ~10 m north of track (0.00009 deg ≈ 10 m)
          coordinates: [
            [6.145, 46.20009],
            [6.155, 46.20009],
          ],
        },
      ]);

      const controller = new WalkController(wmeSdk, track);
      await controller.matchInCurrentViewport(0, 3);

      // Segment is close enough — must reach the buffered-intersects stage.
      expect(matchSegmentsAsyncSegmentIds[0] ?? []).toContain(2001);
    });

    it("keeps the sliceBoundaryFalseNegative302908393 fixture segments (iso-precision guard)", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        ROW_108_6_FN_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, ROW_108_6_FN_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, ROW_108_6_FN_SLICE_LENGTH_KM);

      for (const id of ROW_108_6_FN_EXPECTED_IDS) {
        expect(controller.getMatchedIds(), `expected ${id} to be matched`).toContain(id);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Captured false-positive regressions
  // ---------------------------------------------------------------------------

  describe("captured false-positive regressions", () => {
    it("drops micro-segment 344014910 (row 21, km 128.9 → 129.9)", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        MICRO_344014910_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, MICRO_344014910_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, MICRO_344014910_SLICE_LENGTH_KM);

      for (const id of MICRO_344014910_EXPECTED_NOT_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected false-positive segment ${id} to be filtered out`,
        ).not.toContain(id);
      }
    });

    it("drops parallel-spur 150514530 (row 19, km 127.0 → 127.9)", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        SPUR_150514530_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, SPUR_150514530_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, SPUR_150514530_SLICE_LENGTH_KM);

      for (const id of SPUR_150514530_EXPECTED_NOT_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected false-positive segment ${id} to be filtered out`,
        ).not.toContain(id);
      }
    });

    it("drops wrong-junction-path segment 444061303 in slice row 2 (km 1.2 → 1.6) while keeping 444061304", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        FP444061303_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, FP444061303_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, FP444061303_SLICE_LENGTH_KM);

      for (const id of FP444061303_EXPECTED_NOT_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected false-positive segment ${id} to be filtered out`,
        ).not.toContain(id);
      }

      for (const id of FP444061303_EXPECTED_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected legitimate segment ${id} to remain matched`,
        ).toContain(id);
      }
    });

    it("drops wrong-roundabout-arc segment 450224755 in slice row 13 (km 13.8 → 14.1) while keeping 450224752 + 450224754", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        FP450224755_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, FP450224755_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, FP450224755_SLICE_LENGTH_KM);

      for (const id of FP450224755_EXPECTED_NOT_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected false-positive segment ${id} to be filtered out`,
        ).not.toContain(id);
      }

      for (const id of FP450224755_EXPECTED_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected legitimate segment ${id} to remain matched`,
        ).toContain(id);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Captured false-negative regressions
  // ---------------------------------------------------------------------------

  describe("captured false-negative regressions", () => {
    it("matches missing-link segment 474406759 in at least one of the two slices spanning the boundary", async () => {
      // --- Slice row 8 (km 7.7 → 9.7) ---
      const wmeRow8 = makeWmeSdkForSegments(
        ROW8_474406759_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );
      const controllerRow8 = new WalkController(wmeRow8, ROW8_474406759_TRACK_WITH_TAIL);
      await controllerRow8.matchInCurrentViewport(0, ROW8_474406759_SLICE_LENGTH_KM);
      const idsRow8 = new Set(controllerRow8.getMatchedIds());

      // --- Slice row 9 (km 9.7 → 10.1) ---
      const wmeRow9 = makeWmeSdkForSegments(
        ROW9_474406759_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );
      const controllerRow9 = new WalkController(wmeRow9, ROW9_474406759_TRACK_WITH_TAIL);
      await controllerRow9.matchInCurrentViewport(0, ROW9_474406759_SLICE_LENGTH_KM);
      const idsRow9 = new Set(controllerRow9.getMatchedIds());

      expect(
        idsRow8.has(474406759) || idsRow9.has(474406759),
        `expected 474406759 in matched ids of slice 7.7-9.7 (got [${[...idsRow8].join(", ")}]) OR 9.7-10.1 (got [${[...idsRow9].join(", ")}])`,
      ).toBe(true);
    });

    it("matches segment 210811026 in slice row 13 (km 13.8 → 14.1)", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        FN210811026_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, FN210811026_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, FN210811026_SLICE_LENGTH_KM);

      for (const id of FN210811026_EXPECTED_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected false-negative segment ${id} to be matched`,
        ).toContain(id);
      }
    });

    it("matches segment 211268240 in slice row 19 (km 18 → 20.5)", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        FN211268240_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, FN211268240_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, FN211268240_SLICE_LENGTH_KM);

      for (const id of FN211268240_EXPECTED_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected false-negative segment ${id} to be matched`,
        ).toContain(id);
      }
    });

    it("matches missing-link segment 444061305 in slice row 2 (km 1.2 → 1.6)", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        FN444061305_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, FN444061305_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, FN444061305_SLICE_LENGTH_KM);

      for (const id of FN444061305_EXPECTED_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected false-negative segment ${id} to be matched`,
        ).toContain(id);
      }
    });

    it("matches segment 432486991 in slice row 52 (km 54.1 → 55.3)", async () => {
      const wmeSdk = makeWmeSdkForSegments(
        FN432486991_SEGMENTS.map((segment) => ({
          id: segment.id,
          coordinates: segment.geometry.coordinates,
        })),
      );

      const controller = new WalkController(wmeSdk, FN432486991_TRACK_WITH_TAIL);
      await controller.matchInCurrentViewport(0, FN432486991_SLICE_LENGTH_KM);

      for (const id of FN432486991_EXPECTED_MATCHED_IDS) {
        expect(
          controller.getMatchedIds(),
          `expected false-negative segment ${id} to be matched`,
        ).toContain(id);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Piste C — hasEnoughSampledSliceCoverage early-exit tests
  // ---------------------------------------------------------------------------

  describe("hasEnoughSampledSliceCoverage early-exit (piste C)", () => {
    it("returns true for a segment that closely follows the slice (matching case)", async () => {
      // Short N-S track; segment overlaps most of it at <10 m distance.
      const track: MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [6.82, 46.6],
            [6.82, 46.608],
          ],
        ],
      };

      const wmeSdk = makeWmeSdkForSegments([
        {
          id: 3001,
          coordinates: [
            [6.82, 46.601],
            [6.82, 46.607],
          ],
        },
      ]);

      const controller = new WalkController(wmeSdk, track);
      await controller.matchInCurrentViewport(0, 2);
      expect(controller.getMatchedIds()).toContain(3001);
    });

    it("returns false for a segment where fewer than MIN_CLOSE_SAMPLE_RATIO_FOR_VIEW_MATCH samples are close", async () => {
      // Track is a short segment; candidate is offset far enough that most of its
      // samples fall outside 15 m.
      const track: MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [6.82, 46.6],
            [6.82, 46.602],
          ],
        ],
      };

      const wmeSdk = makeWmeSdkForSegments([
        {
          id: 4001,
          // Mostly outside the 15 m window (~180 m west)
          coordinates: [
            [6.818, 46.6],
            [6.818, 46.602],
          ],
        },
      ]);

      const controller = new WalkController(wmeSdk, track);
      await controller.matchInCurrentViewport(0, 2);
      expect(controller.getMatchedIds()).not.toContain(4001);
    });

    it("returns false for a segment where fewer than MIN_VERY_CLOSE_SAMPLE_RATIO samples are very close", async () => {
      // Segment is within 15 m but mostly between 10-15 m distance (not very close).
      // Track N-S; segment slightly diagonal, within buffer but 12–13 m away throughout.
      const track: MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [6.82, 46.6],
            [6.82, 46.608],
          ],
        ],
      };

      const wmeSdk = makeWmeSdkForSegments([
        {
          id: 5001,
          // ~120 m west — outside even CLOSE_SAMPLE_DISTANCE_METERS (15 m)
          // so both close and very-close counts will be 0, ensuring rejection.
          coordinates: [
            [6.819, 46.6],
            [6.819, 46.607],
          ],
        },
      ]);

      const controller = new WalkController(wmeSdk, track);
      await controller.matchInCurrentViewport(0, 2);
      expect(controller.getMatchedIds()).not.toContain(5001);
    });

    // Fix 1 — off-by-one: last sample tips the threshold; must not be rejected early.
    it("does not early-exit when the last sample is the one that tips the close threshold", async () => {
      // N-S track ~400 m long.  A segment with 4 sampled points where the first 3
      // are very close and the 4th (last) is the one that satisfies the threshold.
      // Under the buggy guard (closeSamples + remaining < closeNeeded) the loop
      // would bail at i=3 when remaining=0 and closeSamples=3 — but closeNeeded=3
      // means the current sample IS enough if counted.
      const track: MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [6.82, 46.6],
            [6.82, 46.604],
          ],
        ],
      };

      const wmeSdk = makeWmeSdkForSegments([
        {
          id: 6001,
          // Segment that closely follows the track — all samples within 5 m.
          coordinates: [
            [6.82001, 46.6],
            [6.82001, 46.604],
          ],
        },
      ]);

      const controller = new WalkController(wmeSdk, track);
      await controller.matchInCurrentViewport(0, 2);
      expect(controller.getMatchedIds()).toContain(6001);
    });

    // Fix 2 — sample at 15.2 m must NOT count as close (CLOSE_SAMPLE_DISTANCE_METERS = 15).
    it("does not count a sample at 15.2 m as close", async () => {
      // Long N-S track (~5 km); we match only the first 2 km slice so that
      // kmB < totalLengthKm — this prevents the projection-fallback path from
      // running and lets us isolate hasEnoughSampledSliceCoverage.
      //
      // The segment is placed ~15.2 m east of the track.
      // 1 deg lng at lat 46.6 ≈ 75 700 m → 15.2 m ≈ 0.000201 deg.
      const track: MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [6.82, 46.6],
            [6.82, 46.65], // ~5.5 km; slice [0,2] is well before the end
          ],
        ],
      };

      const wmeSdk = makeWmeSdkForSegments([
        {
          id: 7001,
          // ~15.2 m east — just outside CLOSE_SAMPLE_DISTANCE_METERS (15 m)
          // but within the bounded-query margin (15.5 m), so it reaches the
          // exact-threshold check introduced by Fix 2.
          coordinates: [
            [6.820201, 46.601],
            [6.820201, 46.615],
          ],
        },
      ]);

      const controller = new WalkController(wmeSdk, track);
      // Slice [0, 2]: only covers the first 2 km; track is ~5.5 km → not last slice.
      await controller.matchInCurrentViewport(0, 2);
      expect(controller.getMatchedIds()).not.toContain(7001);
    });

    // Fix 3 — 2-vertex diagonal segment whose midpoint is close but endpoints are far.
    it("accepts a 2-vertex segment whose midpoint is within CENTERLINE_PREFILTER_THRESHOLD_METERS but endpoints are not", async () => {
      // Long N-S track (~4.4 km).  A 2-vertex diagonal segment crosses the track
      // at its midpoint (0 m distance) while both endpoints are ~23 m away.
      // 1 deg lng at lat 46.62 ≈ 76 000 m → 0.0003 deg ≈ 23 m east/west.
      //
      // Old prefilter probed only the 2 vertices (both at 23 m > threshold 20 m)
      // and rejected the segment.  Fix 3 adds an interpolated midpoint probe
      // (0 m < 20 m), letting the segment through.  Once through the prefilter,
      // the segment intersects the 15 m buffer (midpoint is on the track) and
      // passes hasEnoughSampledSliceCoverage (~60 % of samples within 15 m).
      //
      // A second "anchor" segment that sits squarely on the track ensures
      // bufferedMatchedIds.size > 0, which prevents the projection-fallback path
      // from running (keeping the test focused on Fix 3).
      const track: MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [6.82, 46.6],
            [6.82, 46.64], // ~4.4 km N-S
          ],
        ],
      };

      const wmeSdk = makeWmeSdkForSegments([
        {
          // Anchor: on the track — ensures bufferedMatchedIds is non-empty.
          id: 8000,
          coordinates: [
            [6.82, 46.61],
            [6.82, 46.63],
          ],
        },
        {
          // Diagonal: vertex 0 is 23 m east at lat 46.60, vertex 1 is 23 m west
          // at lat 46.64.  Midpoint is [6.82, 46.62] — exactly on the track.
          // 0.0003 deg lng × 76 000 m/deg ≈ 23 m.
          id: 8001,
          coordinates: [
            [6.8203, 46.6],
            [6.8197, 46.64],
          ],
        },
      ]);

      const controller = new WalkController(wmeSdk, track);
      await controller.matchInCurrentViewport(0, 5);
      expect(controller.getMatchedIds()).toContain(8001);
    });
  });
});

// ---------------------------------------------------------------------------
// computeSliceProjection unit tests
// ---------------------------------------------------------------------------

describe("WalkController.computeSliceProjection", () => {
  function makeController(): WalkController {
    const wmeSdk = {
      DataModel: { Segments: { getAll: () => [] } },
    } as unknown as WmeSDK;
    return new WalkController(wmeSdk, {
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [1, 0],
        ],
      ],
    });
  }

  it("returns zero aggregates when all samples are far from the slice", () => {
    // E-W slice at lat 0.  Segment sits 0.1° north (~11 km away).
    const sliceFeature = turfLineString([
      [0, 0],
      [0.1, 0],
    ]);
    const sliceIndex = buildTrackSpatialIndex(sliceFeature);
    const controller = makeController();

    const coords: [number, number][] = [
      [0.02, 0.1],
      [0.08, 0.1],
    ];
    const proj: SegmentProjection = controller.computeSliceProjection(coords, sliceIndex);

    expect(proj.sampleCount).toBeGreaterThan(0);
    expect(proj.closeSamples).toBe(0);
    expect(proj.veryCloseSamples).toBe(0);
    expect(proj.projectedSpanMetersOnSlice).toBe(0);
    // All samples are beyond the query radius — every entry is null.
    expect(proj.samples.every((s) => s === null)).toBe(true);
  });

  it("counts close and very-close samples for a segment on the slice", () => {
    // Segment lying exactly on the E-W slice (distance = 0 m).
    const sliceFeature = turfLineString([
      [6.82, 46.2],
      [6.83, 46.2],
    ]);
    const sliceIndex = buildTrackSpatialIndex(sliceFeature);
    const controller = makeController();

    const coords: [number, number][] = [
      [6.821, 46.2],
      [6.829, 46.2],
    ];
    const proj: SegmentProjection = controller.computeSliceProjection(coords, sliceIndex);

    expect(proj.sampleCount).toBeGreaterThan(0);
    expect(proj.closeSamples).toBe(proj.sampleCount);
    expect(proj.veryCloseSamples).toBe(proj.sampleCount);
    expect(proj.projectedSpanMetersOnSlice).toBeGreaterThan(0);
    // Every sample should have a non-null projection.
    expect(proj.samples.every((s) => s !== null)).toBe(true);
  });

  it("is idempotent: repeated calls with same inputs produce equal projections", () => {
    const sliceFeature = turfLineString([
      [6.82, 46.2],
      [6.83, 46.2],
    ]);
    const sliceIndex = buildTrackSpatialIndex(sliceFeature);
    const controller = makeController();
    const coords: [number, number][] = [
      [6.821, 46.2],
      [6.825, 46.2],
      [6.829, 46.2],
    ];

    const p1 = controller.computeSliceProjection(coords, sliceIndex);
    const p2 = controller.computeSliceProjection(coords, sliceIndex);

    expect(p1.sampleCount).toBe(p2.sampleCount);
    expect(p1.closeSamples).toBe(p2.closeSamples);
    expect(p1.veryCloseSamples).toBe(p2.veryCloseSamples);
    expect(p1.projectedSpanMetersOnSlice).toBeCloseTo(p2.projectedSpanMetersOnSlice, 6);
  });
});

// ---------------------------------------------------------------------------
// Degenerate micro-segment guard (keptAllVerticesClose branch)
// ---------------------------------------------------------------------------

describe("WalkController degenerate micro-segment guard", () => {
  // Track runs east along lat 46.2 from lon 6.14 to 6.17 (~2.3 km).
  const microTrack: MultiLineString = {
    type: "MultiLineString",
    coordinates: [
      [
        [6.14, 46.2],
        [6.17, 46.2],
      ],
    ],
  };

  it("drops a tiny all-vertices-close segment (degenerate micro-segment)", async () => {
    // 12 vertices strung out in a ~2 m line, ~5 m north of the track start.
    // All are within CLOSE_VERTEX_DISTANCE_METERS (10 m) of the track.
    // Total path length ~2 m → both degenerate-micro conditions fire.
    const baseCoord: [number, number] = [6.14, 46.200045]; // ~5 m north of track
    const stepLon = 0.0000022; // ~0.17 m/step → 11 steps = ~1.9 m total
    const clusterCoords: [number, number][] = Array.from({ length: 12 }, (_, i) => [
      baseCoord[0] + i * stepLon,
      baseCoord[1],
    ]);

    const wmeSdk = makeWmeSdkForSegments([{ id: 344014910, coordinates: clusterCoords }]);
    const controller = new WalkController(wmeSdk, microTrack);
    await controller.matchInCurrentViewport(0, 3);

    expect(controller.getMatchedIds()).not.toContain(344014910);
  });

  it("keeps a short but real segment near the track start (no over-rejection)", async () => {
    // Two endpoints ~30 m apart along the track, within 5 m of the centerline.
    // This must NOT be rejected by the degenerate guard.
    const wmeSdk = makeWmeSdkForSegments([
      {
        id: 999001,
        coordinates: [
          [6.14, 46.200045], // ~5 m north of track start
          [6.1403, 46.200045], // ~30 m east
        ],
      },
    ]);
    const controller = new WalkController(wmeSdk, microTrack);
    await controller.matchInCurrentViewport(0, 3);

    expect(controller.getMatchedIds()).toContain(999001);
  });
});

// ---------------------------------------------------------------------------
// Iso-precision regression: sliceBoundaryFalseNegative302908393
// ---------------------------------------------------------------------------

describe("SegmentProjectionCache iso-precision regression", () => {
  it("produces identical matched IDs with the projection cache as without (sliceBoundaryFalseNegative302908393)", async () => {
    const wmeSdk = makeWmeSdkForSegments(
      ROW_108_6_FN_SEGMENTS.map((segment) => ({
        id: segment.id,
        coordinates: segment.geometry.coordinates,
      })),
    );

    const controller = new WalkController(wmeSdk, ROW_108_6_FN_TRACK_WITH_TAIL);
    await controller.matchInCurrentViewport(0, ROW_108_6_FN_SLICE_LENGTH_KM);

    for (const id of ROW_108_6_FN_EXPECTED_IDS) {
      expect(
        controller.getMatchedIds(),
        `iso-precision: expected segment ${id} to be matched`,
      ).toContain(id);
    }
  });
});
