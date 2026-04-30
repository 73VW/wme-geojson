import { describe, it, expect, beforeEach, vi } from "vitest";
import { save, load, clearForCurrent, clearAll } from "../persistence/sessionStorage";
import type { SessionState } from "../state/SessionStore";

// ---------------------------------------------------------------------------
// Minimal localStorage polyfill for the Node/vitest environment
// ---------------------------------------------------------------------------

function makeFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GEOJSON_URL = "https://example.com/track.geojson";
const CSV_TEXT_A = "distance,start_time,end_time,date,segments\n0.0,08:00,09:00,2026-01-01,\n";
const CSV_TEXT_B = "distance,start_time,end_time,date,segments\n5.0,10:00,11:00,2026-01-02,\n";

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    phase: "csv-loaded",
    geojsonUrl: GEOJSON_URL,
    trackLengthKm: 10.5,
    csvRows: [
      {
        distance: 0.0,
        startTime: "08:00",
        endTime: "09:00",
        date: "2026-01-01",
        segments: null,
      },
    ],
    currentIndex: 0,
    closuresBySegment: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sessionStorage", () => {
  beforeEach(() => {
    const fakeStorage = makeFakeStorage();
    vi.stubGlobal("localStorage", fakeStorage);
  });

  it("save then load returns an equal state", () => {
    const state = makeState();
    save(state, CSV_TEXT_A);
    const loaded = load(GEOJSON_URL, CSV_TEXT_A);
    expect(loaded).toEqual(state);
  });

  it("returns null when nothing has been saved", () => {
    const loaded = load(GEOJSON_URL, CSV_TEXT_A);
    expect(loaded).toBeNull();
  });

  it("uses a different key for a different csvText", () => {
    const state = makeState();
    save(state, CSV_TEXT_A);
    // CSV_TEXT_B was never saved, so load should return null
    const loaded = load(GEOJSON_URL, CSV_TEXT_B);
    expect(loaded).toBeNull();
  });

  it("uses a different key for a different geojsonUrl", () => {
    const state = makeState();
    save(state, CSV_TEXT_A);
    const loaded = load("https://other.example.com/track.geojson", CSV_TEXT_A);
    expect(loaded).toBeNull();
  });

  it("clearForCurrent removes only the matching key", () => {
    const stateA = makeState();
    const stateB = makeState({ phase: "matching" });
    save(stateA, CSV_TEXT_A);
    save(stateB, CSV_TEXT_B);

    clearForCurrent(GEOJSON_URL, CSV_TEXT_A);

    expect(load(GEOJSON_URL, CSV_TEXT_A)).toBeNull();
    // The other key must survive
    expect(load(GEOJSON_URL, CSV_TEXT_B)).toEqual(stateB);
  });

  it("clearAll removes all wmegj:session entries", () => {
    save(makeState(), CSV_TEXT_A);
    save(makeState({ phase: "matching" }), CSV_TEXT_B);

    clearAll();

    expect(load(GEOJSON_URL, CSV_TEXT_A)).toBeNull();
    expect(load(GEOJSON_URL, CSV_TEXT_B)).toBeNull();
  });

  it("load returns null for corrupt JSON", () => {
    const state = makeState();
    save(state, CSV_TEXT_A);

    // Collect the key that was just written so we can corrupt its value.
    // We iterate up to localStorage.length after the save.
    let savedKey: string | null = null;
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const k = globalThis.localStorage.key(i);
      if (k !== null && k.startsWith("wmegj:session:")) {
        savedKey = k;
        break;
      }
    }
    expect(savedKey).not.toBeNull();
    globalThis.localStorage.setItem(savedKey!, "{{bad json");

    const loaded = load(GEOJSON_URL, CSV_TEXT_A);
    expect(loaded).toBeNull();
  });

  it("does nothing when geojsonUrl is null", () => {
    const state = makeState({ geojsonUrl: null });
    // Should not throw
    expect(() => save(state, CSV_TEXT_A)).not.toThrow();
  });
});
