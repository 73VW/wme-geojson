import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SessionStore,
  type SessionState,
  type CsvRow,
} from "../state/SessionStore";

// Mock the persistence module so we can assert auto-save calls without
// touching the real (mocked) localStorage.
vi.mock("../persistence/sessionStorage", () => ({
  save: vi.fn(),
  load: vi.fn(),
  clearForCurrent: vi.fn(),
  clearAll: vi.fn(),
}));

import * as persistence from "../persistence/sessionStorage";

const mockedSave = vi.mocked(persistence.save);

const SAMPLE_ROW: CsvRow = {
  distance: 1.5,
  startTime: "13:00",
  endTime: "13:50",
  date: "2026-04-29",
  segments: null,
};
const SAMPLE_CSV_TEXT = "distance,start_time,end_time,date,segments\n1.5,13:00,13:50,2026-04-29,\n";
const SAMPLE_URL = "https://example.com/track.geojson";

describe("SessionStore.rehydrate", () => {
  beforeEach(() => {
    mockedSave.mockClear();
  });

  it("replaces state and notifies subscribers", () => {
    const store = new SessionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const restored: SessionState = {
      phase: "matching",
      geojsonUrl: SAMPLE_URL,
      trackLengthKm: 86.2,
      csvRows: [SAMPLE_ROW, { ...SAMPLE_ROW, distance: 3.0 }],
      currentIndex: 1,
      closuresBySegment: { 999: [{ startISO: "2026-04-29T13:00", endISO: "2026-04-29T13:50", rowIndex: 0 }] },
    };

    store.rehydrate(restored, SAMPLE_CSV_TEXT);

    expect(store.getState()).toEqual(restored);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(restored);
  });

  it("lets a subsequent validateRow continue from the rehydrated currentIndex", () => {
    const store = new SessionStore();
    const restored: SessionState = {
      phase: "matching",
      geojsonUrl: SAMPLE_URL,
      trackLengthKm: 10,
      csvRows: [
        { ...SAMPLE_ROW, distance: 0 },
        { ...SAMPLE_ROW, distance: 1 },
        { ...SAMPLE_ROW, distance: 2 },
      ],
      currentIndex: 2,
      closuresBySegment: {},
    };
    store.rehydrate(restored, SAMPLE_CSV_TEXT);

    store.validateRow(2, [42], "2026-04-29T13:00", "2026-04-29T13:50");

    expect(store.getState().currentIndex).toBe(3);
    expect(store.getState().csvRows[2].segments).toEqual([42]);
  });
});

describe("SessionStore auto-save", () => {
  beforeEach(() => {
    mockedSave.mockClear();
  });

  it("calls persistence.save after validateRow when url and csvText are set", () => {
    const store = new SessionStore();
    store.setTrack(SAMPLE_URL, 10);
    store.setCsvRows([SAMPLE_ROW], SAMPLE_CSV_TEXT);
    mockedSave.mockClear();

    store.validateRow(0, [123], "2026-04-29T13:00", "2026-04-29T13:50");

    expect(mockedSave).toHaveBeenCalledTimes(1);
    const [savedState, savedCsvText] = mockedSave.mock.calls[0];
    expect(savedCsvText).toBe(SAMPLE_CSV_TEXT);
    expect(savedState.csvRows[0].segments).toEqual([123]);
  });

  it("does NOT save when geojsonUrl is null", () => {
    const store = new SessionStore();
    // No setTrack — url stays null. setCsvRows alone must not persist.
    store.setCsvRows([SAMPLE_ROW], SAMPLE_CSV_TEXT);

    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("does NOT save when csvRows is empty", () => {
    const store = new SessionStore();
    store.setTrack(SAMPLE_URL, 10);
    // setTrack alone fires mutate but no rows yet → no save.
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("swallows save errors so the store keeps working", () => {
    mockedSave.mockImplementationOnce(() => {
      throw new Error("quota exceeded");
    });
    const store = new SessionStore();
    store.setTrack(SAMPLE_URL, 10);
    expect(() => store.setCsvRows([SAMPLE_ROW], SAMPLE_CSV_TEXT)).not.toThrow();
  });
});
