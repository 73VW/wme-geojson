// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LinesListView, sourceName, type LinesListProps } from "../ui/views/LinesListView";
import { SLOWUPS_GEOJSON_URL } from "../lines/slowupClient";
import type { LineEntry } from "../lines/types";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

function props(): LinesListProps {
  return {
    onLoadUrl: vi.fn(),
    onLoadFile: vi.fn(),
    onClearSource: vi.fn(),
    onSelect: vi.fn(),
    onCenterAll: vi.fn(),
    onCenterLine: vi.fn(),
  };
}

function entry(id: string): LineEntry {
  return {
    id,
    track: {
      trackId: id,
      geometry: { type: "MultiLineString", coordinates: [] },
      rawProperties: {},
    },
    lengthKm: 1,
    displayName: id,
    color: "#000000",
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
  };
}

const notStarted = () => ({ kind: "notStarted" }) as const;

describe("LinesListView", () => {
  it("loads the slowUps with one click", () => {
    const p = props();
    const view = new LinesListView(p);
    view.root.querySelector<HTMLButtonElement>(".wmegj-button--primary")!.click();
    expect(p.onLoadUrl).toHaveBeenCalledWith(SLOWUPS_GEOJSON_URL);
  });

  it("loads another URL from its field, by button or Enter, ignoring blanks", () => {
    const p = props();
    const view = new LinesListView(p);
    const input = view.root.querySelector<HTMLInputElement>("input[type=url]")!;
    const loadBtn = view.root.querySelector<HTMLButtonElement>(".wmegj-url-load")!;

    loadBtn.click();
    expect(p.onLoadUrl).not.toHaveBeenCalled();

    input.value = "  https://example.org/a.geojson ";
    input.dispatchEvent(new Event("input"));
    loadBtn.click();
    expect(p.onLoadUrl).toHaveBeenLastCalledWith("https://example.org/a.geojson");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(p.onLoadUrl).toHaveBeenCalledTimes(2);
  });

  it("offers WME's file input for GeoJSON, GPX, KML and KMZ", () => {
    const view = new LinesListView(props());
    const file = view.root.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(file.accept).toBe(".geojson,.gpx,.kml,.kmz");
  });

  it("shows one card for the loaded source, with its line count and a remove button", () => {
    const p = props();
    const view = new LinesListView(p);
    const card = () => view.root.querySelector<HTMLElement>(".wmegj-source-card")!;
    expect(card().hidden).toBe(true);

    view.setSource({ kind: "url", url: "https://example.org/tracks/a.geojson" });
    view.setEntries([entry("a"), entry("b")], notStarted);
    expect(card().hidden).toBe(false);
    expect(card().textContent).toContain("example.org");
    expect(card().textContent).toContain("2 lignes");
    expect(view.root.textContent).not.toContain("FeatureCollection");

    card().querySelector<HTMLButtonElement>(".wmegj-source-clear")!.click();
    expect(p.onClearSource).toHaveBeenCalled();
    card().querySelector<HTMLButtonElement>(".wmegj-source-center")!.click();
    expect(p.onCenterAll).toHaveBeenCalled();

    view.setSource(null);
    expect(card().hidden).toBe(true);
  });

  it("names each kind of source", () => {
    expect(sourceName({ kind: "slowups" })).toBe("slowUps");
    expect(sourceName({ kind: "file", name: "rallye.kmz" })).toBe("rallye.kmz");
    expect(sourceName({ kind: "url", url: "https://example.org/x" })).toBe("example.org");
    expect(sourceName({ kind: "url", url: "not a url" })).toBe("not a url");
  });

  it("renders one row per line with its progress", () => {
    const view = new LinesListView(props());
    view.setSource({ kind: "slowups" });
    view.setEntries([entry("a"), entry("b")], (id) =>
      id === "a" ? { kind: "done" } : { kind: "notStarted" },
    );
    expect(view.root.querySelectorAll(".wmegj-line-row")).toHaveLength(2);
    expect(view.root.querySelectorAll(".wmegj-line-progress")).toHaveLength(1);
  });

  it("shows load errors and clears them", () => {
    const view = new LinesListView(props());
    view.showError("HTTP 404");
    const error = view.root.querySelector<HTMLElement>(".wmegj-load-error")!;
    expect(error.textContent).toContain("HTTP 404");
    view.clearError();
    expect(error.textContent).toBe("");
  });
});
