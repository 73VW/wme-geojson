// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LineRowView, lineSubtitle } from "../ui/views/LineRowView";
import type { LineEntry } from "../lines/types";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

function entry(overrides: Partial<LineEntry> = {}): LineEntry {
  return {
    id: "l1",
    track: {
      trackId: "l1",
      geometry: { type: "MultiLineString", coordinates: [] },
      rawProperties: {},
    },
    lengthKm: 30.85,
    displayName: "SS7+11 Les Cols",
    color: "#ff00aa",
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
    ...overrides,
  };
}
const slowup = entry({
  displayName: "slowUp Valais — 25.10.2026",
  slowupDetails: { refid: 1, title: "slowUp Valais", date: "2026-10-25" },
  slowupFetchStatus: "ok",
});
const notStarted = { kind: "notStarted" } as const;
const props = (e: LineEntry, progress: Parameters<typeof lineSubtitle>[1] = notStarted) => ({
  entry: e,
  progress,
  onSelect: vi.fn(),
  onCenter: vi.fn(),
});

describe("lineSubtitle", () => {
  it("joins the slowUp date and the progress", () => {
    expect(lineSubtitle(slowup, { kind: "done" })).toBe("25.10.2026 · ✓ Terminé");
    expect(lineSubtitle(entry(), { kind: "inProgress", percent: 40 })).toBe("40 % validé");
    expect(lineSubtitle(slowup, notStarted)).toBe("25.10.2026");
    expect(lineSubtitle(entry(), notStarted)).toBe("");
  });
});

describe("LineRowView", () => {
  it("is a clickable WME list item with the title in item-key and the subtitle", () => {
    const row = new LineRowView(props(slowup, { kind: "done" }));
    expect(row.root.tagName).toBe("WZ-LIST-ITEM");
    expect(row.root.hasAttribute("clickable")).toBe(true);
    expect(row.root.getAttribute("subtitle")).toBe("25.10.2026 · ✓ Terminé");
    expect(row.root.querySelector('[slot="item-key"]')?.textContent).toContain("slowUp Valais");
    expect(row.root.querySelector<HTMLElement>(".wmegj-line-pill")?.style.backgroundColor).not.toBe(
      "",
    );
  });

  it("selects on click, but the recenter action does not select", () => {
    const p = props(entry());
    const row = new LineRowView(p);
    row.root.querySelector<HTMLElement>('[slot="actions"] .wmegj-icon-only')!.click();
    expect(p.onCenter).toHaveBeenCalledWith("l1");
    expect(p.onSelect).not.toHaveBeenCalled();
    row.root.click();
    expect(p.onSelect).toHaveBeenCalledWith("l1");
  });

  it("is not clickable while its slowUp details are loading", () => {
    const p = props(entry({ slowupFetchStatus: "loading" }));
    const row = new LineRowView(p);
    expect(row.root.hasAttribute("clickable")).toBe(false);
    row.root.click();
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(row.root.querySelector(".wmegj-spinner")).not.toBeNull();
  });
});
