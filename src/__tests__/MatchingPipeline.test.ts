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
  it("auto-validates burst rows without selecting in WME mid-run", async () => {
    const done = vi.fn();
    const { pipeline, store, wmeSDK } = makePipeline({
      burstMode: true,
      events: { onDone: done },
    });

    pipeline.start();

    await waitUntil(() => store.getState().currentIndex === 2);

    // Mid-run, no per-leaf selection happens in burst mode.
    expect(wmeSDK.Editing.setSelection.mock.calls.length).toBeLessThanOrEqual(1);
    expect(store.getState().csvRows[0].segments).toEqual([101]);
    expect(store.getState().csvRows[1].segments).toEqual([202]);

    // Once the run completes, the pipeline clears any lingering selection so
    // the panel can present post-matching controls cleanly.
    await waitUntil(() => done.mock.calls.length === 1);
    const lastCall =
      wmeSDK.Editing.setSelection.mock.calls[wmeSDK.Editing.setSelection.mock.calls.length - 1];
    expect(lastCall[0].selection.ids).toEqual([]);
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

  it("allows going back before the row where a resumed run started", async () => {
    const { pipeline, store, wmeSDK } = makePipeline({ burstMode: false });
    store.validateRow(0, [101], "2026-05-03T13:00", "2026-05-03T13:30");

    pipeline.start();
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 1);
    expect(wmeSDK.Editing.setSelection.mock.calls[0][0].selection.ids).toEqual([202]);

    pipeline.goBackOneRow();
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 2);

    expect(store.getState().currentIndex).toBe(0);
    expect(store.getState().csvRows[0].segments).toBeNull();
    expect(wmeSDK.Editing.setSelection.mock.calls[1][0].selection.ids).toEqual([101]);
  });

  it("reruns the current row while waiting for manual validation", async () => {
    const { pipeline, store, wmeSDK } = makePipeline({ burstMode: false });

    pipeline.start();
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 1);

    pipeline.rerunCurrentRow();
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 2);

    expect(store.getState().currentIndex).toBe(0);
    expect(wmeSDK.Editing.setSelection.mock.calls[0][0].selection.ids).toEqual([101]);
    expect(wmeSDK.Editing.setSelection.mock.calls[1][0].selection.ids).toEqual([101]);
  });

  it("validates each leaf slice independently when a row is split into multiple leaves", async () => {
    // [14, 17, 17] → first zoomToExtent on the whole [0,1] km row returns 14
    // (below MIN_BBOX_ZOOM=16) so the planner splits into two leaves; both
    // halves return zoom 17 and are accepted as separate leaves.
    const { pipeline, store, controller, wmeSDK } = makePipeline({
      burstMode: false,
      zoomLevels: [14, 17, 17],
      leafIds: [301, 302],
    });

    pipeline.start();

    // First leaf gate: setSelection on leaf 1's matched ids.
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 1);
    expect(wmeSDK.Editing.setSelection.mock.calls[0][0].selection.ids).toEqual([301]);
    expect(controller.matchInCurrentViewport.mock.calls.length).toBe(1);
    expect(store.getState().currentIndex).toBe(0);

    pipeline.validateCurrentRow();

    // Second leaf gate: setSelection on leaf 2's matched ids.
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 2);
    expect(wmeSDK.Editing.setSelection.mock.calls[1][0].selection.ids).toEqual([302]);
    expect(controller.matchInCurrentViewport.mock.calls.length).toBe(2);
    expect(store.getState().currentIndex).toBe(0);

    pipeline.validateCurrentRow();

    // Row complete: persisted ids are the union of per-leaf validations,
    // independent of which segments are currently loaded in the viewport.
    await waitUntil(() => store.getState().currentIndex === 1);
    expect(store.getState().csvRows[0].segments).toEqual([301, 302]);
  });

  it("reruns only the current leaf when rerun is invoked mid-row", async () => {
    const { pipeline, store, controller, wmeSDK } = makePipeline({
      burstMode: false,
      zoomLevels: [14, 17, 17],
      leafIds: [301, 302, 311],
    });

    pipeline.start();

    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 1);
    pipeline.rerunCurrentRow();

    // Leaf 1 re-executes: a second setSelection for leaf 1 (with the new id 302
    // from the next leafIds queue entry) — leaf 2 has not run yet.
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 2);
    expect(controller.matchInCurrentViewport.mock.calls.length).toBe(2);
    expect(controller.matchInCurrentViewport.mock.calls[0][0]).toBeCloseTo(0, 3);
    expect(controller.matchInCurrentViewport.mock.calls[1][0]).toBeCloseTo(0, 3);

    pipeline.validateCurrentRow();
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 3);
    pipeline.validateCurrentRow();

    await waitUntil(() => store.getState().currentIndex === 1);
    expect(store.getState().csvRows[0].segments).toEqual([302, 311]);
  });

  it("selects the current leaf on burst pause and persists on resume without a validate gate", async () => {
    const paused = vi.fn();
    const done = vi.fn();
    let pipeline: MatchingPipeline | null = null;
    let pauseRequested = false;
    const result = makePipeline({
      burstMode: true,
      zoomLevels: [14, 17, 17],
      leafIds: [301, 302],
      events: {
        onStep: (event) => {
          // Pause once, on the first leaf's match completion.
          if (!pauseRequested && event.key === "leafMatched" && event.values?.index === 1) {
            pauseRequested = true;
            pipeline?.pause();
          }
        },
        onPaused: paused,
        onDone: done,
      },
    });
    pipeline = result.pipeline;
    const { store, wmeSDK } = result;

    pipeline.start();

    // Pause finishes the leaf, sets selection, fires onPaused without
    // requesting validation.
    await waitUntil(() => paused.mock.calls.length === 1);
    expect(pipeline.isPaused()).toBe(true);
    expect(pipeline.isRunning()).toBe(false);
    expect(wmeSDK.Editing.setSelection.mock.calls.length).toBe(1);
    expect(wmeSDK.Editing.setSelection.mock.calls[0][0].selection.ids).toEqual([301]);
    // Row not yet persisted; we are mid-row on leaf 1 of 2.
    expect(store.getState().currentIndex).toBe(0);

    // Resume acts as implicit validation: continue burst, finish row, advance.
    pipeline.resume();
    await waitUntil(() => done.mock.calls.length === 1);
    expect(pipeline.isPaused()).toBe(false);
    expect(store.getState().csvRows[0].segments).toEqual([301, 302]);
  });

  it("finalizes on validate of the last leaf of the last row: clears selection and fires onDone", async () => {
    const done = vi.fn();
    const { pipeline, store, wmeSDK } = makePipeline({
      burstMode: false,
      events: { onDone: done },
    });

    pipeline.start();

    // Validate row 0 (single leaf at zoom 17).
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 1);
    pipeline.validateCurrentRow();

    // Validate row 1 — the LAST work item. After this the pipeline must
    // finalize: fire onDone, clear the WME selection, and stop running.
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 2);
    pipeline.validateCurrentRow();

    await waitUntil(() => done.mock.calls.length === 1);
    expect(pipeline.isRunning()).toBe(false);
    expect(store.getState().csvRows[0].segments).toEqual([101]);
    expect(store.getState().csvRows[1].segments).toEqual([202]);

    // Selection should be cleared on completion so the operator returns to a
    // clean WME state and the script panel can present the export controls.
    const lastSelection =
      wmeSDK.Editing.setSelection.mock.calls[wmeSDK.Editing.setSelection.mock.calls.length - 1][0]
        .selection;
    expect(lastSelection.ids).toEqual([]);
  });

  it("rewinds to the previous leaf and forgets its contribution on back from leaf 2", async () => {
    const { pipeline, store, controller, wmeSDK } = makePipeline({
      burstMode: false,
      zoomLevels: [14, 17, 17],
      leafIds: [301, 302, 311, 312],
    });

    pipeline.start();

    // Validate leaf 1 (id 301), then on leaf 2 click back.
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 1);
    pipeline.validateCurrentRow();
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 2);
    pipeline.goBackOneRow();

    // Leaf 1 re-runs (now matches id 311), then leaf 2 (id 312).
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 3);
    expect(wmeSDK.Editing.setSelection.mock.calls[2][0].selection.ids).toEqual([311]);
    pipeline.validateCurrentRow();
    await waitUntil(() => wmeSDK.Editing.setSelection.mock.calls.length === 4);
    expect(wmeSDK.Editing.setSelection.mock.calls[3][0].selection.ids).toEqual([312]);
    pipeline.validateCurrentRow();

    await waitUntil(() => store.getState().currentIndex === 1);
    // Leaf 1's first contribution (301) is forgotten; only the second pass
    // (311) and leaf 2 (312) end up persisted.
    expect(store.getState().csvRows[0].segments).toEqual([311, 312]);
    expect(controller.matchInCurrentViewport.mock.calls.length).toBe(4);
  });
});

function makePipeline(options: {
  burstMode: boolean;
  events?: ConstructorParameters<typeof MatchingPipeline>[5];
  zoomLevels?: number[];
  /** Override per-leaf-call match results: nth call emits leafIds[n] (single id). */
  leafIds?: number[];
  /** Override Editing.getSelection() return value (e.g. to simulate manual corrections). */
  getSelection?: () => unknown;
}): {
  pipeline: MatchingPipeline;
  store: SessionStore;
  controller: { matchInCurrentViewport: ReturnType<typeof vi.fn> };
  wmeSDK: WmeSDK & {
    Editing: { setSelection: ReturnType<typeof vi.fn> };
    Map: { setMapCenter: ReturnType<typeof vi.fn> };
  };
} {
  const store = new SessionStore();
  store.setTrack("https://example.com/track.geojson", 2);
  store.setCsvRows(ROWS, "distance,start_time,end_time,date\n0,13:00,13:30,2026-05-03\n");
  store.setPhase("csv-loaded");

  let matchFound: ((id: number) => void) | null = null;
  const leafIdsQueue = options.leafIds ? [...options.leafIds] : null;
  const controller = {
    onMatchFound: (callback: (id: number) => void) => {
      matchFound = callback;
      return () => {
        matchFound = null;
      };
    },
    matchInCurrentViewport: vi.fn(async (kmA: number) => {
      if (leafIdsQueue) {
        const id = leafIdsQueue.shift();
        if (typeof id === "number") matchFound?.(id);
        return;
      }
      matchFound?.(kmA < 1 ? 101 : 202);
    }),
  };

  const zoomLevels = [...(options.zoomLevels ?? [17])];

  const wmeSDK = {
    Map: {
      zoomToExtent: vi.fn(),
      setMapCenter: vi.fn(),
      getZoomLevel: vi.fn(() => zoomLevels.shift() ?? 17),
    },
    DataModel: {
      Segments: {
        getAll: vi.fn(() => [{ id: 101 }, { id: 202 }]),
      },
    },
    Editing: {
      setSelection: vi.fn(),
      getSelection: vi.fn(options.getSelection ?? (() => null)),
    },
    State: {
      isMapLoading: vi.fn(() => false),
    },
  } as unknown as WmeSDK & {
    Editing: { setSelection: ReturnType<typeof vi.fn> };
    Map: { setMapCenter: ReturnType<typeof vi.fn> };
  };

  const track: NormalizedTrack = { trackId: null, geometry: TRACK_GEOMETRY };
  const trackLayer = {
    getTrackGeometry: () => TRACK_GEOMETRY,
    setHighlightedSlice: () => {},
  } as unknown as TrackLayer;

  const pipeline = new MatchingPipeline(
    wmeSDK,
    store,
    controller as unknown as WalkController,
    track,
    trackLayer,
    options.events ?? {},
    { burstMode: options.burstMode },
  );

  return { pipeline, store, controller, wmeSDK };
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
