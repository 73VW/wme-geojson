import { describe, it, expect } from "vitest";
import i18next from "i18next";
import { computeDisplayName } from "../lines/displayName";

await i18next.init({
  lng: "fr",
  resources: {
    fr: { translation: { panel: { lines: { fallbackName: "Tracé de {{km}} km" } } } },
  },
});

describe("computeDisplayName", () => {
  it("uses slowUp title and date when slowUp details are present", () => {
    const name = computeDisplayName({
      lengthKm: 24.3,
      properties: { name: "ignored" },
      slowupDetails: { refid: 19, title: "Ticino", date: "2026-04-19" },
    });
    expect(name).toBe("Ticino — 2026-04-19");
  });

  it("uses properties.name when present and no slowUp details", () => {
    const name = computeDisplayName({
      lengthKm: 24.3,
      properties: { name: "Lausanne loop" },
    });
    expect(name).toBe("Lausanne loop");
  });

  it("falls back to track length when no name and no slowUp", () => {
    const name = computeDisplayName({ lengthKm: 24.34, properties: {} });
    expect(name).toBe("Tracé de 24.3 km");
  });

  it("falls back when properties is undefined", () => {
    const name = computeDisplayName({ lengthKm: 5, properties: undefined });
    expect(name).toBe("Tracé de 5.0 km");
  });

  it("ignores a non-string properties.name", () => {
    const name = computeDisplayName({ lengthKm: 8, properties: { name: 42 } });
    expect(name).toBe("Tracé de 8.0 km");
  });
});
