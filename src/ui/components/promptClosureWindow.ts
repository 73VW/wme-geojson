// Native WME dialog collecting the closure time windows for CSV-less
// (synthetic) matching.

import i18next from "i18next";
import { dateTimeInput, wzButton, wzLabel } from "./wz";
import { wzDialog } from "./wzDialog";

export interface ClosureWindow {
  /** "YYYY-MM-DDTHH:MM" — matches the ISO format used across SessionStore. */
  startISO: string;
  endISO: string;
}

export interface ClosureWindowDefaults {
  /** "YYYY-MM-DD" — the date both inputs open on. */
  date: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
}

/**
 * Prefill from the linked MTE ("YYYY-MM-DD HH:MM" strings): its start date
 * always, its times only when it fits in one day — a multi-day event's
 * start/end times say nothing about the daily closure window.
 */
export function closureWindowDefaults(
  mte: { startDate: string | null; endDate: string | null } | null,
  fallback: ClosureWindowDefaults,
): ClosureWindowDefaults {
  if (!mte?.startDate) return fallback;
  const date = mte.startDate.slice(0, 10);
  const isOneDay = mte.endDate?.slice(0, 10) === date;
  if (!isOneDay || !mte.endDate) return { ...fallback, date };
  return { date, startTime: mte.startDate.slice(11, 16), endTime: mte.endDate.slice(11, 16) };
}

export async function promptClosureWindow(
  defaults: ClosureWindowDefaults,
  mode: "download" | "apply" = "download",
): Promise<ClosureWindow[] | null> {
  const lines: { start: HTMLInputElement; end: HTMLInputElement }[] = [];
  const linesBox = document.createElement("div");
  linesBox.className = "wmegj-dialog-body";

  const header = document.createElement("div");
  header.className = "wmegj-row";
  const spacer = document.createElement("span");
  spacer.className = "wmegj-row-fixed";
  spacer.style.width = "32px";
  header.append(
    wzLabel(i18next.t("panel.modal.closureWindow.start")),
    wzLabel(i18next.t("panel.modal.closureWindow.end")),
    spacer,
  );

  function refreshRemoveButtons(): void {
    linesBox.querySelectorAll<HTMLButtonElement>(".wmegj-icon-only").forEach((btn) => {
      btn.disabled = lines.length === 1;
    });
  }

  function addLine(date: string): HTMLInputElement {
    const start = dateTimeInput({ value: `${date}T${defaults.startTime}` }).input;
    start.setAttribute("aria-label", i18next.t("panel.modal.closureWindow.start"));
    const end = dateTimeInput({ value: `${date}T${defaults.endTime}` }).input;
    end.setAttribute("aria-label", i18next.t("panel.modal.closureWindow.end"));
    // Picking a start date carries it over to the end, keeping the end time.
    start.addEventListener("change", () => {
      const startDate = start.value.slice(0, 10);
      if (startDate) end.value = `${startDate}T${end.value.slice(11, 16) || defaults.endTime}`;
    });
    const line = { start, end };

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "wmegj-icon-only wmegj-row-fixed";
    removeBtn.title = i18next.t("panel.modal.closureWindow.removeLine");
    const icon = document.createElement("i");
    icon.className = "w-icon w-icon-trash";
    removeBtn.appendChild(icon);
    removeBtn.addEventListener("click", () => {
      lines.splice(lines.indexOf(line), 1);
      row.remove();
      refreshRemoveButtons();
    });

    const row = document.createElement("div");
    row.className = "wmegj-row";
    row.append(start, end, removeBtn);
    linesBox.appendChild(row);
    lines.push(line);
    refreshRemoveButtons();
    return start;
  }

  const addBtn = wzButton({
    text: i18next.t("panel.modal.closureWindow.addLine"),
    variant: "text",
    onClick: () => {
      const prevDate = lines[lines.length - 1]?.start.value.slice(0, 10) || defaults.date;
      addLine(prevDate).focus();
    },
  });
  addBtn.style.alignSelf = "flex-start";

  const firstStart = addLine(defaults.date);

  let windows: ClosureWindow[] = [];
  const confirmed = await wzDialog({
    title: i18next.t("panel.modal.closureWindow.title"),
    body: [header, linesBox, addBtn],
    primaryLabel: i18next.t(
      mode === "apply" ? "panel.modal.closureWindow.apply" : "panel.modal.closureWindow.download",
    ),
    cancelLabel: i18next.t("panel.modal.closureWindow.cancel"),
    focus: firstStart,
    onPrimary: () => {
      const collected: ClosureWindow[] = [];
      for (const line of lines) {
        const start = line.start.value;
        const end = line.end.value;
        if (start === "" || end === "") return i18next.t("panel.modal.closureWindow.errorRequired");
        // "YYYY-MM-DDTHH:MM": lexicographic order is chronological order.
        if (!(start < end)) return i18next.t("panel.modal.closureWindow.errorOrder");
        collected.push({ startISO: start, endISO: end });
      }
      windows = collected;
      return null;
    },
  });
  return confirmed ? windows : null;
}
