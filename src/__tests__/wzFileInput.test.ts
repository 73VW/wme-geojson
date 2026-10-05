// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { fileInput } from "../ui/components/wz";

vi.spyOn(console, "warn").mockImplementation(() => {});

// WME registers wz-file-input; it rejects files by MIME type, which browsers
// leave empty for .kmz/.gpx/.geojson. fileInput() must not depend on it.
customElements.define("wz-file-input", class extends HTMLElement {});

describe("fileInput", () => {
  it("uses the browser's file picker filtered by extension, not wz-file-input", () => {
    const root = fileInput({ accept: ".geojson,.gpx,.kml,.kmz", buttonLabel: "Choisir" });
    expect(root.querySelector("wz-file-input")).toBeNull();
    expect(root.tagName).not.toBe("WZ-FILE-INPUT");
    expect(root.querySelector<HTMLInputElement>("input[type=file]")?.accept).toBe(
      ".geojson,.gpx,.kml,.kmz",
    );
    expect(root.textContent).toContain("Choisir");
  });

  it("opens the picker from its button and hands over a file without MIME type", () => {
    const onFile = vi.fn();
    const root = fileInput({ accept: ".kmz", buttonLabel: "Choisir", onFile });
    const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
    const pick = vi.spyOn(input, "click");
    root.querySelector<HTMLElement>(".wmegj-button")!.click();
    expect(pick).toHaveBeenCalled();

    const kmz = new File(["x"], "rallye.kmz", { type: "" });
    Object.defineProperty(input, "files", { value: [kmz], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(onFile).toHaveBeenCalledWith(kmz);
  });
});
