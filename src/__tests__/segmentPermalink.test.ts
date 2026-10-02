import { describe, expect, it } from "vitest";
import { segmentPermalink } from "../utils/segmentPermalink";

describe("segmentPermalink", () => {
  it("points at the segment in the failing view, keeping the WME env", () => {
    const url = segmentPermalink(
      "https://www.waze.com/fr/editor?env=row&lon=1&lat=2&zoomLevel=3&segments=9",
      { lon: 6.12345, lat: 46.5, zoom: 17 },
      405039299,
    );
    expect(url).toBe(
      "https://www.waze.com/fr/editor?env=row&lon=6.12345&lat=46.5&zoomLevel=17&segments=405039299",
    );
  });

  it("omits env when the current URL has none", () => {
    expect(segmentPermalink("https://beta.waze.com/editor", { lon: 6, lat: 46, zoom: 16 }, 1)).toBe(
      "https://beta.waze.com/editor?lon=6&lat=46&zoomLevel=16&segments=1",
    );
  });
});
