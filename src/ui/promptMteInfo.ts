// Fenêtre « Préparer le MTE » : catégorie et niveau de verrouillage toujours ;
// titre / dates / description / URL seulement hors slowUp (l'API
// SchweizMobil les fournit pour un slowUp).

import i18next from "i18next";
import {
  DEFAULT_MTE_OPTIONS,
  MTE_NAME_MAX,
  categoryOptions,
  lockLevelOptions,
  type LockLevel,
  type MteEventOptions,
} from "../mte/mteFormFiller";
import type { MajorTrafficEventCategory } from "wme-sdk-typings";
import {
  dateTimeInput,
  readValue,
  wzChipSelect,
  wzSelect,
  wzTextInput,
  wzTextarea,
} from "./components/wz";
import { wzDialog } from "./components/wzDialog";

export interface ManualMteInfo {
  title: string;
  startDate: string; // "YYYY-MM-DDTHH:mm" (datetime-local)
  endDate: string; // "YYYY-MM-DDTHH:mm" (datetime-local)
  description: string;
  urlLink: string; // "" si absente
}

export interface MteInfoResult {
  options: MteEventOptions;
  /** null quand les détails viennent de l'API slowUp. */
  manual: ManualMteInfo | null;
}

/** Renvoie un message d'erreur i18n, ou null si la saisie est valide. */
export function validateManualMteInfo(info: ManualMteInfo): string | null {
  if (!info.title || !info.startDate || !info.endDate) {
    return i18next.t("panel.mteInfo.errorRequired");
  }
  if (info.endDate < info.startDate) return i18next.t("panel.mteInfo.errorDates");
  return null;
}

export async function promptMteInfo(defaults: {
  title: string;
  userRank: number;
  askDetails: boolean;
}): Promise<MteInfoResult | null> {
  const category = wzSelect({
    label: i18next.t("panel.mteInfo.category"),
    value: DEFAULT_MTE_OPTIONS.category,
    options: categoryOptions(),
  });
  const lockLevel = wzChipSelect({
    label: i18next.t("panel.mteInfo.lockLevel"),
    value: String(DEFAULT_MTE_OPTIONS.lockLevel),
    options: lockLevelOptions(defaults.userRank).map((option) => ({
      value: String(option.value),
      label: String(option.value),
      disabled: option.disabled,
    })),
  });

  // Limite WME du nom d'un MTE ; maxLength ne tronque pas la valeur par défaut.
  const title = wzTextInput({
    label: i18next.t("panel.mteInfo.titleLabel"),
    value: defaults.title.slice(0, MTE_NAME_MAX),
    maxLength: MTE_NAME_MAX,
  });
  const start = dateTimeInput({ label: i18next.t("panel.mteInfo.startDate") });
  const end = dateTimeInput({ label: i18next.t("panel.mteInfo.endDate") });
  // Une fermeture d'un jour est le cas courant : on recopie le début.
  start.input.addEventListener("change", () => {
    if (!end.input.value || end.input.value < start.input.value) {
      end.input.value = start.input.value;
    }
  });
  const description = wzTextarea({ label: i18next.t("panel.mteInfo.description") });
  const url = wzTextInput({ label: i18next.t("panel.mteInfo.url"), type: "url" });

  const body = defaults.askDetails
    ? [category, start.root, end.root, title, description, url, lockLevel.root]
    : [category, lockLevel.root];

  let result: MteInfoResult | null = null;
  const confirmed = await wzDialog({
    title: i18next.t("panel.mteInfo.title"),
    body,
    primaryLabel: i18next.t("panel.mteInfo.ok"),
    cancelLabel: i18next.t("panel.finalFields.cancel"),
    focus: defaults.askDetails ? start.input : undefined,
    onPrimary: () => {
      const options: MteEventOptions = {
        category: readValue(category) as MajorTrafficEventCategory,
        lockLevel: Number(lockLevel.getValue()) as LockLevel,
      };
      if (!defaults.askDetails) {
        result = { options, manual: null };
        return null;
      }
      const manual: ManualMteInfo = {
        title: readValue(title).trim(),
        startDate: start.input.value,
        endDate: end.input.value,
        description: readValue(description).trim(),
        urlLink: readValue(url).trim(),
      };
      const error = validateManualMteInfo(manual);
      if (error) return error;
      result = { options, manual };
      return null;
    },
  });
  return confirmed ? result : null;
}
