// Pure helper computing the human-readable name of a line.
// Priority: slowUp "title — date" > properties.name > "Tracé de X km".
// No SDK, no DOM. The fallback label goes through i18next.

import i18next from "i18next";
import type { SlowupDetails } from "./types";

export interface DisplayNameInput {
  lengthKm: number;
  properties: Record<string, unknown> | undefined;
  slowupDetails?: SlowupDetails;
}

export function computeDisplayName(input: DisplayNameInput): string {
  const { lengthKm, properties, slowupDetails } = input;

  if (slowupDetails) {
    return `${slowupDetails.title} — ${slowupDetails.date}`;
  }

  const name = properties?.["name"];
  if (typeof name === "string" && name.trim() !== "") {
    return name;
  }

  return i18next.t("panel.lines.fallbackName", { km: lengthKm.toFixed(1) });
}
