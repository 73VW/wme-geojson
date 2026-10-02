// Async modal collecting the closure time window for CSV-less (synthetic)
// matching. Structure mirrors promptFinalFields.ts: native <dialog>, a
// settle()/cleanup() pair, all strings via i18next.

import i18next from "i18next";

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

/**
 * Show the closure-window modal. Resolves with the chosen windows (one per
 * schedule line, at least one), or null if the user cancels (Cancel button,
 * Escape, or backdrop).
 */
export async function promptClosureWindow(
  defaults: ClosureWindowDefaults,
  mode: "download" | "apply" = "download",
): Promise<ClosureWindow[] | null> {
  return new Promise<ClosureWindow[] | null>((resolve) => {
    let settled = false;
    function settle(result: ClosureWindow[] | null): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    const errorBanner = el("p");
    errorBanner.style.margin = "0";
    errorBanner.style.color = "#c00";
    errorBanner.style.fontSize = "12px";
    errorBanner.style.display = "none";
    function showError(msg: string): void {
      errorBanner.textContent = msg;
      errorBanner.style.display = "block";
    }

    const dialog = el("dialog");
    dialog.style.border = "none";
    dialog.style.borderRadius = "8px";
    dialog.style.padding = "28px 32px";
    dialog.style.maxWidth = "520px";
    dialog.style.width = "90vw";
    dialog.style.boxShadow = "0 6px 32px rgba(0,0,0,0.25)";

    const title = el("h3");
    title.textContent = i18next.t("panel.modal.closureWindow.title");
    title.style.margin = "0 0 16px 0";
    title.style.fontSize = "16px";
    title.style.fontWeight = "700";

    const form = el("form");
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "12px";
    form.method = "dialog";

    const lines: { start: HTMLInputElement; end: HTMLInputElement }[] = [];
    const linesBox = el("div");
    linesBox.style.display = "flex";
    linesBox.style.flexDirection = "column";
    linesBox.style.gap = "8px";

    function styleInput(input: HTMLInputElement, label: string): void {
      input.type = "datetime-local";
      input.setAttribute("aria-label", label);
      input.style.flex = "1";
      input.style.minWidth = "0";
      input.style.padding = "6px 8px";
      input.style.fontSize = "13px";
      input.style.border = "1px solid #ccc";
      input.style.borderRadius = "4px";
    }

    function refreshRemoveButtons(): void {
      linesBox.querySelectorAll("button").forEach((btn) => {
        btn.disabled = lines.length === 1;
      });
    }

    function addLine(date: string): HTMLInputElement {
      const start = el("input");
      styleInput(start, i18next.t("panel.modal.closureWindow.start"));
      start.value = `${date}T${defaults.startTime}`;
      const end = el("input");
      styleInput(end, i18next.t("panel.modal.closureWindow.end"));
      end.value = `${date}T${defaults.endTime}`;
      // Picking a start date carries it over to the end, keeping the end time.
      start.addEventListener("change", () => {
        const startDate = start.value.slice(0, 10);
        if (startDate) end.value = `${startDate}T${end.value.slice(11, 16) || defaults.endTime}`;
      });
      const line = { start, end };

      const removeBtn = el("button");
      removeBtn.type = "button";
      removeBtn.textContent = "✕";
      removeBtn.title = i18next.t("panel.modal.closureWindow.removeLine");
      removeBtn.style.cursor = "pointer";
      removeBtn.addEventListener("click", () => {
        lines.splice(lines.indexOf(line), 1);
        row.remove();
        refreshRemoveButtons();
      });

      const row = el("div");
      row.style.display = "flex";
      row.style.gap = "6px";
      row.style.alignItems = "center";
      row.append(start, end, removeBtn);
      linesBox.appendChild(row);
      lines.push(line);
      refreshRemoveButtons();
      return start;
    }

    const header = el("div");
    header.style.display = "flex";
    header.style.gap = "6px";
    header.style.fontSize = "13px";
    header.style.fontWeight = "600";
    header.style.color = "#333";
    for (const key of ["start", "end"]) {
      const span = el("span");
      span.style.flex = "1";
      span.textContent = i18next.t(`panel.modal.closureWindow.${key}`);
      header.appendChild(span);
    }
    const spacer = el("span");
    spacer.style.width = "24px";
    header.appendChild(spacer);

    const addBtn = el("button");
    addBtn.type = "button";
    addBtn.textContent = i18next.t("panel.modal.closureWindow.addLine");
    addBtn.style.alignSelf = "flex-start";
    addBtn.style.cursor = "pointer";
    addBtn.addEventListener("click", () => {
      const prevDate = lines[lines.length - 1]?.start.value.slice(0, 10) || defaults.date;
      addLine(prevDate).focus();
    });

    const firstStart = addLine(defaults.date);
    form.appendChild(header);
    form.appendChild(linesBox);
    form.appendChild(addBtn);
    form.appendChild(errorBanner);

    const buttonRow = el("div");
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "flex-end";
    buttonRow.style.gap = "10px";
    buttonRow.style.marginTop = "8px";

    const cancelBtn = el("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = i18next.t("panel.modal.closureWindow.cancel");
    cancelBtn.style.padding = "7px 16px";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.addEventListener("click", () => settle(null));

    const okBtn = el("button");
    okBtn.type = "submit";
    okBtn.textContent = i18next.t(
      mode === "apply" ? "panel.modal.closureWindow.apply" : "panel.modal.closureWindow.download",
    );
    okBtn.style.padding = "7px 16px";
    okBtn.style.cursor = "pointer";
    okBtn.style.fontWeight = "bold";

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(okBtn);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const windows: ClosureWindow[] = [];
      for (const line of lines) {
        const start = line.start.value;
        const end = line.end.value;
        if (start === "" || end === "") {
          showError(i18next.t("panel.modal.closureWindow.errorRequired"));
          return;
        }
        // datetime-local values are "YYYY-MM-DDTHH:MM" — lexicographic order
        // equals chronological order, so a plain string compare is correct here.
        if (!(start < end)) {
          showError(i18next.t("panel.modal.closureWindow.errorOrder"));
          return;
        }
        windows.push({ startISO: start, endISO: end });
      }
      settle(windows);
    });

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      settle(null);
    });

    dialog.appendChild(title);
    dialog.appendChild(form);
    form.appendChild(buttonRow);

    document.body.appendChild(dialog);
    dialog.showModal();
    firstStart.focus();

    function cleanup(): void {
      if (dialog.parentNode) {
        dialog.close();
        dialog.parentNode.removeChild(dialog);
      }
    }
  });
}
