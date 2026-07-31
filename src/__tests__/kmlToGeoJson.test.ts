// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { kmlToGeoJson } from "../geojson/kmlToGeoJson";
import { buildEntriesFromText } from "../lines/featureCollectionLoader";

const KML = `<?xml version="1.0" encoding="utf-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name><![CDATA[Stage]]></name>
    <Placemark>
      <name>Sprint</name>
      <Point><coordinates>6.87,46.75,1</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Trace</name>
      <LineString>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>6.62,46.50,1
          6.63,46.51,2 6.64,46.52</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

describe("kmlToGeoJson", () => {
  it("converts the LineString placemark and ignores Points", () => {
    const raw = kmlToGeoJson(KML) as {
      type: string;
      geometry: { type: string; coordinates: number[][][] };
      properties: { name: string | null };
    };
    expect(raw.type).toBe("Feature");
    expect(raw.geometry.type).toBe("MultiLineString");
    expect(raw.geometry.coordinates).toEqual([
      [
        [6.62, 46.5],
        [6.63, 46.51],
        [6.64, 46.52],
      ],
    ]);
    expect(raw.properties.name).toBe("Trace");
  });

  it("wraps several line placemarks in a FeatureCollection", () => {
    const twoLines = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>A</name><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>
      <Placemark><name>B</name><LineString><coordinates>5,6 7,8</coordinates></LineString></Placemark>
    </Document></kml>`;
    const raw = kmlToGeoJson(twoLines) as { type: string; features: unknown[] };
    expect(raw.type).toBe("FeatureCollection");
    expect(raw.features).toHaveLength(2);
  });

  it("throws when the KML contains no LineString", () => {
    const pointsOnly = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>P</name><Point><coordinates>1,2</coordinates></Point></Placemark>
    </Document></kml>`;
    expect(() => kmlToGeoJson(pointsOnly)).toThrow("KML file contains no LineStrings");
  });

  it("preserves & and < inside a CDATA-wrapped name", () => {
    const withEntities = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name><![CDATA[A & B <Test>]]></name><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>
    </Document></kml>`;
    const raw = kmlToGeoJson(withEntities) as { properties: { name: string | null } };
    expect(raw.properties.name).toBe("A & B <Test>");
  });

  it("routes .kml files through buildEntriesFromText", () => {
    const entries = buildEntriesFromText(KML, "E01.kml");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.track.geometry.type).toBe("MultiLineString");
  });

  it("parses namespace-prefixed KML (kml: prefix)", () => {
    const prefixed = `<kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Document><kml:Placemark><kml:name>P</kml:name><kml:LineString><kml:coordinates>1,2 3,4</kml:coordinates></kml:LineString></kml:Placemark></kml:Document></kml:kml>`;
    const raw = kmlToGeoJson(prefixed) as {
      type: string;
      geometry: { type: string; coordinates: number[][][] };
      properties: { name: string | null };
    };
    expect(raw.type).toBe("Feature");
    expect(raw.geometry.coordinates).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
    ]);
    expect(raw.properties.name).toBe("P");
  });

  it("tolerates a space after the comma in coordinate tuples", () => {
    const spaced = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>P</name><LineString><coordinates>6.62, 46.50, 1 6.63, 46.51, 2</coordinates></LineString></Placemark>
    </Document></kml>`;
    const raw = kmlToGeoJson(spaced) as {
      geometry: { coordinates: number[][][] };
    };
    expect(raw.geometry.coordinates).toEqual([
      [
        [6.62, 46.5],
        [6.63, 46.51],
      ],
    ]);
  });

  it("throws when the only LineString has empty coordinates", () => {
    const emptyCoords = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>P</name><LineString><coordinates></coordinates></LineString></Placemark>
    </Document></kml>`;
    expect(() => kmlToGeoJson(emptyCoords)).toThrow("KML file contains no LineStrings");
  });
});
