// src/mte/mteSdk.ts
//
// Adapter Waze SDK pour la liste des Major Traffic Events.
// Le SDK ne fournit que : id, names[] (localisés), startDate, endDate
// (+ flags isPublished/isReady, category, etc.). Aucun urlLink ni
// géométrie, donc le matching popup repose sur le nom + les dates.

import type { WmeSDK } from "wme-sdk-typings";
import type { MteRef } from "./mteResolver";

export interface MteSdk {
  listMtes(): MteRef[];
}

interface LocalizedString {
  locale: string;
  value: string;
}

interface SdkMajorTrafficEvent {
  id: string;
  names: LocalizedString[];
  startDate: string | null;
  endDate: string | null;
}

interface MajorTrafficEventsApi {
  getAll?: () => SdkMajorTrafficEvent[];
}

type WmeSdkWithMajorTrafficEvents = WmeSDK & {
  MajorTrafficEvents?: MajorTrafficEventsApi;
};

export function createMteSdk(sdk: WmeSDK): MteSdk {
  const sdkWithMte = sdk as WmeSdkWithMajorTrafficEvents;
  return {
    listMtes(): MteRef[] {
      try {
        const raw = sdkWithMte.MajorTrafficEvents?.getAll?.() ?? [];
        // Log volontaire pour diagnostic : ce que le SDK renvoie réellement.
        console.info("[mteSdk] getAll() returned", raw.length, "MTE(s):", raw);
        return raw.map(normalize).filter((m): m is MteRef => m !== null);
      } catch (err) {
        console.warn("[mteSdk] listMtes failed:", err);
        return [];
      }
    },
  };
}

function pickName(names: LocalizedString[]): string {
  if (!Array.isArray(names) || names.length === 0) return "";
  // Préférer FR, puis EN, sinon premier nom dispo.
  const fr = names.find((n) => n?.locale?.startsWith("fr"));
  if (fr?.value) return fr.value;
  const en = names.find((n) => n?.locale?.startsWith("en"));
  if (en?.value) return en.value;
  return names[0]?.value ?? "";
}

function normalize(raw: SdkMajorTrafficEvent): MteRef | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    name: pickName(raw.names),
    urlLink: null, // SDK ne l'expose pas.
    bbox: null, // SDK ne l'expose pas.
    startDate: typeof raw.startDate === "string" ? raw.startDate.slice(0, 10) : "",
    endDate: typeof raw.endDate === "string" ? raw.endDate.slice(0, 10) : "",
  };
}
