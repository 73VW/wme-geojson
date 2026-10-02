// src/__tests__/mteStore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mteStore, MTE_STORE_KEY } from "../mte/mteStore";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mteStore", () => {
  it("returns undefined when no value is stored", () => {
    expect(mteStore.get(123)).toBeUndefined();
  });

  it("persists and retrieves a mteId for a refid", () => {
    mteStore.set(123, "987654");
    expect(mteStore.get(123)).toBe("987654");
  });

  it("survives a fresh read of localStorage (real persistence)", () => {
    mteStore.set(123, "987654");
    const raw = window.localStorage.getItem(MTE_STORE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ "123": "987654" });
  });

  it("clears a refid", () => {
    mteStore.set(123, "987654");
    mteStore.clear(123);
    expect(mteStore.get(123)).toBeUndefined();
  });

  it("treats set('') as clear", () => {
    mteStore.set(123, "987654");
    mteStore.set(123, "");
    expect(mteStore.get(123)).toBeUndefined();
  });

  it("handles multiple refids independently", () => {
    mteStore.set(1, "AAA");
    mteStore.set(2, "BBB");
    expect(mteStore.get(1)).toBe("AAA");
    expect(mteStore.get(2)).toBe("BBB");
    mteStore.clear(1);
    expect(mteStore.get(2)).toBe("BBB");
  });

  it("accepts string keys (non-slowup line ids) alongside refids", () => {
    mteStore.set(123, "AAA");
    mteStore.set("https://x/a.geojson#0", "BBB");
    expect(mteStore.get(123)).toBe("AAA");
    expect(mteStore.get("https://x/a.geojson#0")).toBe("BBB");
  });

  it("recovers from corrupted localStorage JSON", () => {
    window.localStorage.setItem(MTE_STORE_KEY, "not-json{");
    expect(mteStore.get(123)).toBeUndefined();
    mteStore.set(123, "X");
    expect(mteStore.get(123)).toBe("X");
  });

  it("no-ops silently when localStorage.setItem throws (quota)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => mteStore.set(123, "X")).not.toThrow();
    setItem.mockRestore();
  });
});
