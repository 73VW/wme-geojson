import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcePersistence } from "../domain/SourcePersistence";
import type { Source } from "../domain/types";

function makeSource(id: string): Source {
  return {
    schemaVersion: 1,
    sourceId: id,
    kind: "geojson",
    hasCsv: false,
    lines: [],
    cursor: null,
  };
}

describe("SourcePersistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes and reads back a source", () => {
    const p = new SourcePersistence();
    const src = makeSource("s1");
    p.save(src);
    vi.advanceTimersByTime(250);
    const loaded = p.load("s1");
    expect(loaded?.sourceId).toBe("s1");
  });

  it("returns null when the key does not exist", () => {
    const p = new SourcePersistence();
    expect(p.load("missing")).toBeNull();
  });

  it("discards prior-schema payloads silently", () => {
    localStorage.setItem(
      "wme-geojson:source:legacy",
      JSON.stringify({ schemaVersion: 0, sourceId: "legacy" }),
    );
    const p = new SourcePersistence();
    expect(p.load("legacy")).toBeNull();
    expect(localStorage.getItem("wme-geojson:source:legacy")).toBeNull();
  });

  it("debounces multiple save() calls within the window", () => {
    const p = new SourcePersistence({ debounceMs: 200 });
    const setSpy = vi.spyOn(localStorage, "setItem");
    p.save(makeSource("s2"));
    p.save(makeSource("s2"));
    p.save(makeSource("s2"));
    vi.advanceTimersByTime(199);
    expect(setSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it("flush() forces an immediate write", () => {
    const p = new SourcePersistence({ debounceMs: 200 });
    p.save(makeSource("s3"));
    p.flush();
    expect(localStorage.getItem("wme-geojson:source:s3")).toContain('"sourceId":"s3"');
  });

  it("clear() removes the key", () => {
    const p = new SourcePersistence();
    p.save(makeSource("s4"));
    p.flush();
    expect(p.load("s4")).not.toBeNull();
    p.clear("s4");
    expect(p.load("s4")).toBeNull();
  });
});
