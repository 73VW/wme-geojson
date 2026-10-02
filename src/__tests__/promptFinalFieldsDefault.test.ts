import { beforeEach, describe, expect, it } from "vitest";
import { promptFinalFields, resolveDefaultMteId } from "../ui/promptFinalFields";
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

describe("promptFinalFields apply mode", () => {
  it("hides the comment field and accepts commas (no CSV involved)", async () => {
    const pending = promptFinalFields({ mode: "apply" });
    expect(document.getElementById("pff-comment")).toBeNull();
    const reason = document.getElementById("pff-reason") as HTMLInputElement;
    reason.value = "slowUp, Lac";
    reason.form!.dispatchEvent(new Event("submit", { cancelable: true }));
    await expect(pending).resolves.toMatchObject({ reason: "slowUp, Lac", comment: "" });
  });

  it("still rejects commas in download mode", () => {
    void promptFinalFields();
    const reason = document.getElementById("pff-reason") as HTMLInputElement;
    reason.value = "a, b";
    reason.form!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(document.querySelector("dialog")).not.toBeNull();
    document.querySelector("dialog")!.remove();
  });
});
