// src/mte/mteSdk.ts
import type { WmeSDK } from "wme-sdk-typings";
import type { MteRef } from "./mteResolver";

export interface MteSdk {
  listMtes(): MteRef[];
}

interface MajorTrafficEventsApi {
  getMajorTrafficEvents?: () => unknown[];
}

type WmeSdkWithMajorTrafficEvents = WmeSDK & {
  MajorTrafficEvents?: MajorTrafficEventsApi;
};

export function createMteSdk(sdk: WmeSDK): MteSdk {
  const sdkWithMte = sdk as WmeSdkWithMajorTrafficEvents;
  return {
    listMtes(): MteRef[] {
      try {
        const raw = sdkWithMte.MajorTrafficEvents?.getMajorTrafficEvents?.() ?? [];
        return raw.map(normalize).filter((m): m is MteRef => m !== null);
      } catch (err) {
        console.warn("[mteSdk] listMtes failed:", err);
        return [];
      }
    },
  };
}

// Forme attendue (à ajuster Step 1 si le SDK diffère) :
//   { id, name, url, geometry: { coordinates: [[[lon,lat], ...]] }, startDate, endDate }
interface RawMte {
  id: number | string;
  name?: string;
  url?: string | null;
  urlLink?: string | null;
  geometry?: { coordinates?: number[][][] };
  startDate?: string;
  endDate?: string;
}

function normalize(raw: unknown): MteRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawMte;
  if (r.id === undefined || r.id === null) return null;

  const bbox = bboxFromGeometry(r.geometry);
  if (!bbox) return null;

  return {
    id: String(r.id),
    name: typeof r.name === "string" ? r.name : "",
    urlLink: typeof r.urlLink === "string" ? r.urlLink : typeof r.url === "string" ? r.url : null,
    bbox,
    startDate: typeof r.startDate === "string" ? r.startDate.slice(0, 10) : "",
    endDate: typeof r.endDate === "string" ? r.endDate.slice(0, 10) : "",
  };
}

function bboxFromGeometry(geom: RawMte["geometry"]): [number, number, number, number] | null {
  const ring = geom?.coordinates?.[0];
  if (!ring || ring.length === 0) return null;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const pt of ring) {
    const [lon, lat] = pt;
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}
