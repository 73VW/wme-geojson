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

type WmeSdkWithDataModel = WmeSDK & {
  DataModel?: { MajorTrafficEvents?: MajorTrafficEventsApi };
};

export function createMteSdk(sdk: WmeSDK): MteSdk {
  const sdkWithDataModel = sdk as WmeSdkWithDataModel;
  return {
    listMtes(): MteRef[] {
      // Logs volontairement verbeux pour le diagnostic du refresh.
      const mteModule = sdkWithDataModel.DataModel?.MajorTrafficEvents;
      console.log("[mteSdk] ── refresh ──────────────────");
      console.log("[mteSdk] sdk.DataModel present?", !!sdkWithDataModel.DataModel);
      console.log("[mteSdk] sdk.DataModel.MajorTrafficEvents present?", !!mteModule);
      console.log(
        "[mteSdk] sdk.DataModel.MajorTrafficEvents.getAll present?",
        typeof mteModule?.getAll === "function",
      );

      if (!mteModule || typeof mteModule.getAll !== "function") {
        console.warn(
          "[mteSdk] DataModel.MajorTrafficEvents.getAll() unavailable on the SDK instance.",
        );
        return [];
      }

      let raw: SdkMajorTrafficEvent[];
      try {
        raw = mteModule.getAll() ?? [];
      } catch (err) {
        console.warn("[mteSdk] getAll() threw:", err);
        return [];
      }

      console.log(`[mteSdk] getAll() returned ${raw.length} MTE(s):`, raw);
      // Dump détaillé : utile si la console affiche [object Object] pour `raw`.
      for (const m of raw) {
        console.log(
          `[mteSdk]   • id=${m?.id} names=${JSON.stringify(m?.names)} start=${m?.startDate} end=${m?.endDate}`,
        );
      }

      const normalized = raw.map(normalize).filter((m): m is MteRef => m !== null);
      console.log(`[mteSdk] normalized → ${normalized.length} MTE(s):`, normalized);
      return normalized;
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
