import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { kmzToKml } from "../geojson/kmzToKml";

const KML = `<?xml version="1.0" encoding="utf-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Trace</name>
<LineString><coordinates>6.62,46.50 6.63,46.51</coordinates></LineString>
</Placemark></Document></kml>`;

/** Build a minimal ZIP archive (no CRC — the reader does not check it). */
function makeZip(files: { name: string; content: string; deflate: boolean }[]): ArrayBuffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const raw = Buffer.from(f.content);
    const data = f.deflate ? deflateRawSync(raw) : raw;
    const method = f.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const buf = Buffer.concat([...locals, cd, eocd]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("kmzToKml", () => {
  it("extracts a deflated doc.kml", async () => {
    const zip = makeZip([{ name: "doc.kml", content: KML, deflate: true }]);
    expect(await kmzToKml(zip)).toBe(KML);
  });

  it("extracts a stored (uncompressed) entry", async () => {
    const zip = makeZip([{ name: "doc.kml", content: KML, deflate: false }]);
    expect(await kmzToKml(zip)).toBe(KML);
  });

  it("prefers doc.kml over other .kml entries", async () => {
    const zip = makeZip([
      { name: "files/icon.png", content: "png", deflate: false },
      { name: "other.kml", content: "<kml/>", deflate: true },
      { name: "doc.kml", content: KML, deflate: true },
    ]);
    expect(await kmzToKml(zip)).toBe(KML);
  });

  it("falls back to the first .kml entry", async () => {
    const zip = makeZip([{ name: "Etape 1.KML", content: KML, deflate: true }]);
    expect(await kmzToKml(zip)).toBe(KML);
  });

  it("rejects an archive without .kml", async () => {
    const zip = makeZip([{ name: "readme.txt", content: "hi", deflate: false }]);
    await expect(kmzToKml(zip)).rejects.toThrow("no .kml");
  });

  it("rejects non-ZIP data", async () => {
    await expect(kmzToKml(new TextEncoder().encode(KML).buffer)).rejects.toThrow("not a ZIP");
  });
});
