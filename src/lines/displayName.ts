// Pure helper computing the human-readable name of a line.
// Priority: slowUp "title — date" > properties.name > "Tracé de X km".
// No SDK, no DOM. The fallback label goes through i18next.

import i18next from "i18next";
import type { SlowupDetails } from "./types";
import { parseSlowupDateUTC } from "./slowupDate";

export interface DisplayNameInput {
  lengthKm: number;
  properties: Record<string, unknown> | undefined;
  slowupDetails?: SlowupDetails;
}

function formatSlowupDate(date: unknown): string | null {
  if (typeof date !== "string") {
    return null;
  }

  const parsed = parseSlowupDateUTC(date);
  if (parsed === null) {
    // Regex mismatch or impossible date — return the raw string so the
    // caller can still display something meaningful.
    return date;
  }

  const year = String(parsed.getUTCFullYear()).padStart(4, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${day}.${month}.${year}`;
}

export function computeDisplayName(input: DisplayNameInput): string {
  const { lengthKm, properties, slowupDetails } = input;

  if (slowupDetails) {
    const formattedDate = formatSlowupDate(slowupDetails.date);
    if (formattedDate === null || formattedDate === "") {
      return slowupDetails.title;
    }

    return `${slowupDetails.title} — ${formattedDate}`;
  }

  const name = properties?.["name"];
  if (typeof name === "string" && name.trim() !== "") {
    return name;
  }

  return i18next.t("panel.lines.fallbackName", { km: lengthKm.toFixed(1) });
}
