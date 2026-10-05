// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LineRowView } from "../ui/views/LineRowView";
import type { LineEntry } from "../lines/types";
import { initFrench } from "./helpers/i18nFr";

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

const notStarted = { kind: "notStarted" } as const;

describe("LineRowView", () => {
  it("shows the slowUp title with its date on a second line", () => {
    const row = new LineRowView({
      entry: entry({
        displayName: "slowUp Valais — 25.10.2026",
        slowupDetails: { refid: 1, title: "slowUp Valais", date: "2026-10-25" },
        slowupFetchStatus: "ok",
      }),
      progress: notStarted,
      onSelect: vi.fn(),
      onCenter: vi.fn(),
    });
    expect(row.root.querySelector(".wmegj-line-name")?.textContent).toBe("slowUp Valais");
    expect(row.root.querySelector(".wmegj-line-caption")?.textContent).toBe("25.10.2026");
  });

  it("shows progress only once the line has been started", () => {
    const none = new LineRowView({
      entry: entry(),
      progress: notStarted,
      onSelect: vi.fn(),
      onCenter: vi.fn(),
    });
    expect(none.root.querySelector(".wmegj-line-progress")).toBeNull();

    const half = new LineRowView({
      entry: entry(),
      progress: { kind: "inProgress", percent: 45 },
      onSelect: vi.fn(),
      onCenter: vi.fn(),
    });
    expect(half.root.querySelector(".wmegj-line-progress")?.textContent).toBe("45 %");

    const done = new LineRowView({
      entry: entry(),
      progress: { kind: "done" },
      onSelect: vi.fn(),
      onCenter: vi.fn(),
    });
    const doneEl = done.root.querySelector(".wmegj-line-progress");
    expect(doneEl?.textContent).toContain("Terminé");
    expect(doneEl?.classList.contains("is-done")).toBe(true);
  });

  it("selects on click, but recentering does not select", () => {
    const onSelect = vi.fn();
    const onCenter = vi.fn();
    const row = new LineRowView({ entry: entry(), progress: notStarted, onSelect, onCenter });
    row.root.querySelector<HTMLButtonElement>(".wmegj-icon-only")!.click();
    expect(onCenter).toHaveBeenCalledWith("l1");
    expect(onSelect).not.toHaveBeenCalled();
    row.root.click();
    expect(onSelect).toHaveBeenCalledWith("l1");
  });

  it("cannot be selected while its slowUp details are loading", () => {
    const onSelect = vi.fn();
    const row = new LineRowView({
      entry: entry({ slowupFetchStatus: "loading" }),
      progress: notStarted,
      onSelect,
      onCenter: vi.fn(),
    });
    row.root.click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(row.root.querySelector(".wmegj-spinner")).not.toBeNull();
  });
});
