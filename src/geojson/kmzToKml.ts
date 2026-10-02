/**
 * Extract the KML document from a KMZ archive (a ZIP file).
 *
 * Reads the ZIP central directory, picks `doc.kml` at the root (the KMZ
 * convention) or else the first `.kml` entry, and inflates it with the
 * native DecompressionStream — no third-party ZIP library needed.
 */
export async function kmzToKml(buffer: ArrayBuffer): Promise<string> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) {
    throw new Error("Invalid KMZ file: not a ZIP archive");
  }
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const kmlEntries: { name: string; method: number; size: number; localOffset: number }[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid KMZ file: corrupt central directory");
    }
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (name.toLowerCase().endsWith(".kml")) {
      kmlEntries.push({ name, method, size, localOffset });
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }

  const entry = kmlEntries.find((e) => e.name.toLowerCase() === "doc.kml") ?? kmlEntries[0];
  if (!entry) {
    throw new Error("KMZ archive contains no .kml file");
  }

  const local = entry.localOffset;
  if (view.getUint32(local, true) !== 0x04034b50) {
    throw new Error("Invalid KMZ file: corrupt local header");
  }
  const dataStart =
    local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const data = bytes.subarray(dataStart, dataStart + entry.size);

  if (entry.method === 0) {
    return new TextDecoder().decode(data);
  }
  if (entry.method === 8) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }
  throw new Error(`Unsupported KMZ compression method: ${entry.method}`);
}

/** Scan backwards for the End Of Central Directory signature. */
function findEndOfCentralDirectory(view: DataView): number {
  // EOCD is 22 bytes + an optional comment of up to 65535 bytes.
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}
