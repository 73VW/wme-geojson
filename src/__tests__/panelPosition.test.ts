import { describe, expect, it } from "vitest";
import { initialPanelPosition } from "../ui/panelPosition";

const base = {
  sidebarRight: 330,
  viewport: { width: 1600, height: 900 },
  panel: { width: 360, height: 400 },
};

describe("initialPanelPosition", () => {
  it("opens next to the sidebar by default", () => {
    expect(initialPanelPosition({ ...base, stored: null })).toEqual({ left: 346, top: 72 });
  });

  it("keeps a stored position over the map", () => {
    expect(initialPanelPosition({ ...base, stored: { left: 900, top: 200 } })).toEqual({
      left: 900,
      top: 200,
    });
  });

  it("ignores a stored position over the sidebar or off-screen", () => {
    expect(initialPanelPosition({ ...base, stored: { left: 36, top: 386 } })).toEqual({
      left: 346,
      top: 72,
    });
    expect(initialPanelPosition({ ...base, stored: { left: 1500, top: 200 } })).toEqual({
      left: 346,
      top: 72,
    });
    expect(initialPanelPosition({ ...base, stored: { left: 900, top: 800 } })).toEqual({
      left: 346,
      top: 72,
    });
  });
});
