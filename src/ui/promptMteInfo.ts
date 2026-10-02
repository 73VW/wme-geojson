// Fenêtre de saisie des infos MTE pour une fermeture qui n'est pas un slowup
// (pas d'API SchweizMobil pour fournir titre / dates / description / URL).

import i18next from "i18next";
import { el, labeledInput } from "./promptFinalFields";
import { MTE_NAME_MAX } from "../mte/mteFormFiller";

export interface ManualMteInfo {
  title: string;
  startDate: string; // "YYYY-MM-DDTHH:mm" (datetime-local)
  endDate: string; // "YYYY-MM-DDTHH:mm" (datetime-local)
  description: string;
  urlLink: string; // "" si absente
}

/** Renvoie un message d'erreur i18n, ou null si la saisie est valide. */
export function validateManualMteInfo(info: ManualMteInfo): string | null {
  if (!info.title || !info.startDate || !info.endDate) {
    return i18next.t("panel.mteInfo.errorRequired");
  }
  if (info.endDate < info.startDate) return i18next.t("panel.mteInfo.errorDates");
  return null;
}

export function promptMteInfo(defaults: { title: string }): Promise<ManualMteInfo | null> {
  return new Promise((resolve) => {
    const titleInput = el("input");
    titleInput.type = "text";
    // Limite WME du nom d'un MTE ; maxLength ne tronque pas la valeur par défaut.
    titleInput.maxLength = MTE_NAME_MAX;
    titleInput.value = defaults.title.slice(0, MTE_NAME_MAX);

    const startInput = el("input");
    startInput.type = "datetime-local";

    const endInput = el("input");
    endInput.type = "datetime-local";
    // Une fermeture d'un jour est le cas courant : on recopie le début.
    startInput.addEventListener("change", () => {
      if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value;
    });

    const descriptionInput = el("textarea");
    descriptionInput.rows = 4;
    descriptionInput.style.resize = "vertical";
    descriptionInput.style.fontFamily = "inherit";

    const urlInput = el("input");
    urlInput.type = "url";

    const errorBanner = el("p");
    errorBanner.style.margin = "0";
    errorBanner.style.color = "#c00";
    errorBanner.style.fontSize = "12px";
    errorBanner.style.display = "none";

    const dialog = el("dialog");
    dialog.style.border = "none";
    dialog.style.borderRadius = "8px";
    dialog.style.padding = "28px 32px";
    dialog.style.maxWidth = "420px";
    dialog.style.width = "90vw";
    dialog.style.boxShadow = "0 6px 32px rgba(0,0,0,0.25)";

    const heading = el("h3");
    heading.textContent = i18next.t("panel.mteInfo.title");
    heading.style.margin = "0 0 16px 0";
    heading.style.fontSize = "16px";
    heading.style.fontWeight = "700";

    const form = el("form");
    form.method = "dialog";
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "12px";
    form.appendChild(labeledInput(i18next.t("panel.mteInfo.titleLabel"), titleInput, "pmi-title"));
    form.appendChild(labeledInput(i18next.t("panel.mteInfo.startDate"), startInput, "pmi-start"));
    form.appendChild(labeledInput(i18next.t("panel.mteInfo.endDate"), endInput, "pmi-end"));
    form.appendChild(
      labeledInput(i18next.t("panel.mteInfo.description"), descriptionInput, "pmi-description"),
    );
    form.appendChild(labeledInput(i18next.t("panel.mteInfo.url"), urlInput, "pmi-url"));
    form.appendChild(errorBanner);

    const buttonRow = el("div");
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "flex-end";
    buttonRow.style.gap = "10px";
    buttonRow.style.marginTop = "8px";

    const cancelBtn = el("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = i18next.t("panel.finalFields.cancel");
    cancelBtn.style.padding = "7px 16px";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.addEventListener("click", () => settle(null));

    const okBtn = el("button");
    okBtn.type = "submit";
    okBtn.textContent = i18next.t("panel.mteInfo.ok");
    okBtn.style.padding = "7px 16px";
    okBtn.style.cursor = "pointer";
    okBtn.style.fontWeight = "bold";

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(okBtn);
    form.appendChild(buttonRow);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const info: ManualMteInfo = {
        title: titleInput.value.trim(),
        startDate: startInput.value,
        endDate: endInput.value,
        description: descriptionInput.value.trim(),
        urlLink: urlInput.value.trim(),
      };
      const error = validateManualMteInfo(info);
      if (error) {
        errorBanner.textContent = error;
        errorBanner.style.display = "block";
        return;
      }
      settle(info);
    });

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      settle(null);
    });

    dialog.appendChild(heading);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    dialog.showModal();
    titleInput.focus();

    let settled = false;
    function settle(result: ManualMteInfo | null): void {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(result);
    }
  });
}
