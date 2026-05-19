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
 * Show the closure-window modal. Resolves with the chosen window, or null if
 * the user cancels (Cancel button, Escape, or backdrop).
 */
export async function promptClosureWindow(
  defaults: ClosureWindowDefaults,
): Promise<ClosureWindow | null> {
  return new Promise<ClosureWindow | null>((resolve) => {
    let settled = false;
    function settle(result: ClosureWindow | null): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    const startInput = el("input");
    startInput.type = "datetime-local";
    startInput.value = `${defaults.date}T${defaults.startTime}`;

    const endInput = el("input");
    endInput.type = "datetime-local";
    endInput.value = `${defaults.date}T${defaults.endTime}`;

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
    dialog.style.maxWidth = "420px";
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

    function field(labelText: string, input: HTMLInputElement, id: string): HTMLDivElement {
      const wrap = el("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "4px";
      const label = el("label");
      label.htmlFor = id;
      label.textContent = labelText;
      label.style.fontSize = "13px";
      label.style.fontWeight = "600";
      label.style.color = "#333";
      input.id = id;
      input.style.padding = "6px 8px";
      input.style.fontSize = "13px";
      input.style.border = "1px solid #ccc";
      input.style.borderRadius = "4px";
      wrap.appendChild(label);
      wrap.appendChild(input);
      return wrap;
    }

    form.appendChild(field(i18next.t("panel.modal.closureWindow.start"), startInput, "pcw-start"));
    form.appendChild(field(i18next.t("panel.modal.closureWindow.end"), endInput, "pcw-end"));
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
    okBtn.textContent = i18next.t("panel.modal.closureWindow.download");
    okBtn.style.padding = "7px 16px";
    okBtn.style.cursor = "pointer";
    okBtn.style.fontWeight = "bold";

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(okBtn);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const start = startInput.value;
      const end = endInput.value;
      if (start === "" || end === "") {
        showError(i18next.t("panel.modal.closureWindow.errorRequired"));
        return;
      }
      if (!(start < end)) {
        showError(i18next.t("panel.modal.closureWindow.errorOrder"));
        return;
      }
      settle({ startISO: start, endISO: end });
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
    startInput.focus();

    function cleanup(): void {
      if (dialog.parentNode) {
        dialog.close();
        dialog.parentNode.removeChild(dialog);
      }
    }
  });
}
