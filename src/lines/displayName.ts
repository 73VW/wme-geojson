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

function formatSlowupDate(date: unknown): string | null {
  if (typeof date !== "string") {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return date;
  }

  const [, year, month, day] = match;
  const parsedYear = Number.parseInt(year, 10);
  const parsedMonth = Number.parseInt(month, 10);
  const parsedDay = Number.parseInt(day, 10);
  const parsedDate = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay));
  const isValidDate =
    parsedDate.getUTCFullYear() === parsedYear &&
    parsedDate.getUTCMonth() === parsedMonth - 1 &&
    parsedDate.getUTCDate() === parsedDay;

  if (!isValidDate) {
    return date;
  }

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
