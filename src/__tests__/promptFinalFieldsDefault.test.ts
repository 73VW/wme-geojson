import { beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultMteId } from "../ui/promptFinalFields";
import { mteStore } from "../mte/mteStore";

beforeEach(() => {
  window.localStorage.clear();
});

describe("resolveDefaultMteId", () => {
  it("uses explicit default when provided", () => {
    mteStore.set(19, "FROM_STORE");
    expect(resolveDefaultMteId("EXPLICIT", 19)).toBe("EXPLICIT");
  });

  it("falls back to mteStore when no explicit default and refid is known", () => {
    mteStore.set(19, "FROM_STORE");
    expect(resolveDefaultMteId(undefined, 19)).toBe("FROM_STORE");
  });

  it("returns empty string when nothing matches", () => {
    expect(resolveDefaultMteId(undefined, 19)).toBe("");
  });

  it("returns empty string when refid is undefined", () => {
    mteStore.set(19, "FROM_STORE");
    expect(resolveDefaultMteId(undefined, undefined)).toBe("");
  });

  it("falls back to mteStore for a non-slowup line id", () => {
    mteStore.set("line#0", "FROM_STORE");
    expect(resolveDefaultMteId(undefined, "line#0")).toBe("FROM_STORE");
  });
});
