import { describe, expect, it, vi } from "vitest";
import type { MultiLineString } from "geojson";
import type { WmeSDK } from "wme-sdk-typings";
import { MatchingPipeline } from "../controller/MatchingPipeline";
import { SessionStore, type CsvRow } from "../state/SessionStore";
import type { NormalizedTrack } from "../geojson/types";
import type { TrackLayer } from "../layers/TrackLayer";
import type { WalkController } from "../controller/WalkController";

vi.mock("../utils/waitForMapIdle", () => ({
  waitForMapIdle: vi.fn(() => Promise.resolve()),
}));

vi.mock("../persistence/sessionStorage", () => ({
  save: vi.fn(),
  load: vi.fn(),
  clearForCurrent: vi.fn(),
  clearAll: vi.fn(),
}));

const TRACK_GEOMETRY: MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [6, 46],
      [6.04, 46],
    ],
  ],
};

const ROWS: CsvRow[] = [
  { distance: 0, startTime: "13:00", endTime: "13:30", date: "2026-05-03", segments: null },
  { distance: 1, startTime: "13:30", endTime: "14:00", date: "2026-05-03", segments: null },
  { distance: 2, startTime: "14:00", endTime: "14:30", date: "2026-05-03", segments: null },
];

describe("MatchingPipeline burst controls", () => {
  it("auto-validates burst rows without selecting in WME", async () => {
    const { pipeline, store, wmeSDK } = makePipeline({ burstMode: true });

    pipeline.start();

    await waitUntil(() => store.getState().currentIndex === 2);

    expect(wmeSDK.Editing.setSelection).not.toHaveBeenCalled();
    expect(store.getState().csvRows[0].segments).toEqual([101]);
    expect(store.getState().csvRows[1].segments).toEqual([202]);
  });

  it("pauses burst mode after the current safe row and resumes at currentIndex", async () => {
    let pipeline: MatchingPipeline | null = null;
    const paused = vi.fn();
    const done = vi.fn();
    ({ pipeline } = makePipeline({
      burstMode: true,
      events: {
        onRowMatched: (index) => {
          if (index === 0) {
            pipeline?.pause();
          }
        },
        onPaused: paused,
        onDone: done,
      },
    }));

    pipeline.start();

    await waitUntil(() => paused.mock.calls.length === 1);
    expect(pipeline.isPaused()).toBe(true);
    expect(pipeline["store"].getState().currentIndex).toBe(1);

    pipeline.resume();

    await waitUntil(() => done.mock.calls.length === 1);
    expect(pipeline.isPaused()).toBe(false);
  });

  it("keeps manual skip and back controls working while waiting for validation", async () => {
    const { pipeline, store, wmeSDK } = makePipeline({ burstMode: false });

    pipeline.start();
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 1);

    pipeline.skipCurrentRow();
    await waitUntil(() => store.getState().currentIndex === 1);
    expect(store.getState().csvRows[0].segments).toEqual([]);

    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 2);
    pipeline.goBackOneRow();
    await waitUntil(() => store.getState().currentIndex === 0);
    expect(store.getState().csvRows[0].segments).toBeNull();
  });
});

function makePipeline(options: {
  burstMode: boolean;
  events?: ConstructorParameters<typeof MatchingPipeline>[5];
}): {
  pipeline: MatchingPipeline;
  store: SessionStore;
  wmeSDK: WmeSDK & { Editing: { setSelection: ReturnType<typeof vi.fn> } };
} {
  const store = new SessionStore();
  store.setTrack("https://example.com/track.geojson", 2);
  store.setCsvRows(ROWS, "distance,start_time,end_time,date\n0,13:00,13:30,2026-05-03\n");
  store.setPhase("csv-loaded");

  let matchFound: ((id: number) => void) | null = null;
  const controller = {
    onMatchFound: (callback: (id: number) => void) => {
      matchFound = callback;
      return () => {
        matchFound = null;
      };
    },
    matchInCurrentViewport: vi.fn(async (kmA: number) => {
      matchFound?.(kmA < 1 ? 101 : 202);
    }),
  } as unknown as WalkController;

  const wmeSDK = {
    Map: {
      zoomToExtent: vi.fn(),
      setMapCenter: vi.fn(),
      getZoomLevel: vi.fn(() => 17),
    },
    DataModel: {
      Segments: {
        getAll: vi.fn(() => [{ id: 101 }, { id: 202 }]),
      },
    },
    Editing: {
      setSelection: vi.fn(),
      getSelection: vi.fn(() => null),
    },
    State: {
      isMapLoading: vi.fn(() => false),
    },
  } as unknown as WmeSDK & { Editing: { setSelection: ReturnType<typeof vi.fn> } };

  const track: NormalizedTrack = { trackId: null, geometry: TRACK_GEOMETRY };
  const trackLayer = {
    getTrackGeometry: () => TRACK_GEOMETRY,
    setHighlightedSlice: () => {},
  } as unknown as TrackLayer;

  const pipeline = new MatchingPipeline(
    wmeSDK,
    store,
    controller,
    track,
    trackLayer,
    options.events ?? {},
    { burstMode: options.burstMode },
  );

  return { pipeline, store, wmeSDK };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
