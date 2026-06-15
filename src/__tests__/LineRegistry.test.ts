import { describe, it, expect, vi } from "vitest";
import { LineRegistry } from "../lines/LineRegistry";
import type { LineEntry } from "../lines/types";

function makeEntry(id: string): LineEntry {
  return {
    id,
    track: { trackId: id, geometry: { type: "MultiLineString", coordinates: [] } },
    lengthKm: 10,
    displayName: id,
    color: "#000000",
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
  };
}

describe("LineRegistry", () => {
  it("starts empty with no selection", () => {
    const reg = new LineRegistry();
    expect(reg.getAll()).toEqual([]);
    expect(reg.getSelected()).toBeNull();
  });

  it("setEntries replaces the list and fires onLinesChanged", () => {
    const reg = new LineRegistry();
    const cb = vi.fn();
    reg.onLinesChanged(cb);
    reg.setEntries([makeEntry("a"), makeEntry("b")]);
    expect(reg.getAll().map((e) => e.id)).toEqual(["a", "b"]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setEntries clears any prior selection", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    reg.setSelected("a");
    reg.setEntries([makeEntry("b")]);
    expect(reg.getSelected()).toBeNull();
  });

  it("setSelected fires onSelectedLineChanged with the entry", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    const cb = vi.fn();
    reg.onSelectedLineChanged(cb);
    reg.setSelected("a");
    expect(reg.getSelected()?.id).toBe("a");
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("setSelected with an unknown id throws", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    expect(() => reg.setSelected("missing")).toThrow();
  });

  it("setSelected(null) clears the selection", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    reg.setSelected("a");
    reg.setSelected(null);
    expect(reg.getSelected()).toBeNull();
  });

  it("updateEntry patches an entry and fires onEntryUpdated", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    const cb = vi.fn();
    reg.onEntryUpdated(cb);
    reg.updateEntry("a", { matchPhase: "matched" });
    expect(reg.getAll()[0].matchPhase).toBe("matched");
    expect(cb).toHaveBeenCalledWith("a");
  });

  it("updateEntry on the selected entry keeps it selected with fresh data", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    reg.setSelected("a");
    reg.updateEntry("a", { displayName: "renamed" });
    expect(reg.getSelected()?.displayName).toBe("renamed");
  });

  it("getEntryById returns the entry or null", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a"), makeEntry("b")]);
    expect(reg.getEntryById("b")?.id).toBe("b");
    expect(reg.getEntryById("missing")).toBeNull();
  });

  it("subscribers can unsubscribe", () => {
    const reg = new LineRegistry();
    const cb = vi.fn();
    const off = reg.onLinesChanged(cb);
    off();
    reg.setEntries([makeEntry("a")]);
    expect(cb).not.toHaveBeenCalled();
  });
});
