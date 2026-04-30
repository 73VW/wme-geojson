import { describe, expect, it } from "vitest";
import { wktToGeoJson } from "../utils/wktToGeoJson";

describe("wktToGeoJson", () => {
  it("parses LINESTRING into GeoJSON LineString", () => {
    const result = wktToGeoJson("LINESTRING(7.1 46.2, 7.2 46.3)");

    expect(result).toEqual({
      type: "LineString",
      coordinates: [
        [7.1, 46.2],
        [7.2, 46.3],
      ],
    });
  });

  it("parses MULTILINESTRING into GeoJSON MultiLineString", () => {
    const result = wktToGeoJson("MULTILINESTRING((7.1 46.2, 7.2 46.3), (7.2 46.3, 7.3 46.4))");

    expect(result).toEqual({
      type: "MultiLineString",
      coordinates: [
        [
          [7.1, 46.2],
          [7.2, 46.3],
        ],
        [
          [7.2, 46.3],
          [7.3, 46.4],
        ],
      ],
    });
  });

  it("keeps Z values when present", () => {
    const result = wktToGeoJson("LINESTRING Z (7.1 46.2 100, 7.2 46.3 110)");

    expect(result).toEqual({
      type: "LineString",
      coordinates: [
        [7.1, 46.2, 100],
        [7.2, 46.3, 110],
      ],
    });
  });

  it("throws on unsupported geometry type", () => {
    expect(() => wktToGeoJson("POINT(7.1 46.2)")).toThrow("Unsupported WKT geometry type");
  });
});
