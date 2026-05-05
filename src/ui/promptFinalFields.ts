// Async prompt for the four final fields required before exporting the
// Advanced Closures CSV.  Uses a plain <dialog> element so we stay within
// browser built-ins — no extra library needed, and <dialog> gives us
// keyboard-accessible focus trapping for free in modern browsers.

import i18next from "i18next";
import type { FinalFields } from "../csv/buildClosuresCsv";

// ---------------------------------------------------------------------------
// DOM helpers — thin wrappers to avoid repetition without adding a framework
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

function labeledInput(labelText: string, inputEl: HTMLInputElement, id: string): HTMLDivElement {
  const wrapper = el("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "4px";

  const label = el("label");
  label.htmlFor = id;
  label.textContent = labelText;
  label.style.fontSize = "13px";
  label.style.fontWeight = "600";
  label.style.color = "#333";

  inputEl.id = id;
  inputEl.style.padding = "6px 8px";
  inputEl.style.fontSize = "13px";
  inputEl.style.border = "1px solid #ccc";
  inputEl.style.borderRadius = "4px";

  wrapper.appendChild(label);
  wrapper.appendChild(inputEl);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show a modal-like overlay that collects the four FinalFields from the user.
 *
 * Returns the filled-in FinalFields when the user clicks OK, or null if the
 * user cancels (via the Cancel button, the Escape key, or backdrop click).
 *
 * Wires all i18n keys under the "panel.finalFields" namespace.
 */
export async function promptFinalFields(
  defaults?: Partial<FinalFields>,
): Promise<FinalFields | null> {
  return new Promise<FinalFields | null>((resolve) => {
    let settled = false;

    function settle(result: FinalFields | null): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    // --- Inputs ---------------------------------------------------------------

    const reasonInput = el("input");
    reasonInput.type = "text";
    reasonInput.value = defaults?.reason ?? "";
    reasonInput.placeholder = i18next.t("panel.finalFields.reason");

    const ignoreTrafficInput = el("input");
    ignoreTrafficInput.type = "checkbox";
    ignoreTrafficInput.checked = defaults?.ignoreTraffic ?? true;
    ignoreTrafficInput.style.width = "18px";
    ignoreTrafficInput.style.height = "18px";
    ignoreTrafficInput.style.cursor = "pointer";

    const mteIdInput = el("input");
    mteIdInput.type = "text";
    mteIdInput.value = defaults?.mteId ?? "";

    const commentInput = el("input");
    commentInput.type = "text";
    commentInput.value = defaults?.comment ?? "";

    // --- Error banner ---------------------------------------------------------

    const errorBanner = el("p");
    errorBanner.style.margin = "0";
    errorBanner.style.color = "#c00";
    errorBanner.style.fontSize = "12px";
    errorBanner.style.display = "none";

    function showError(msg: string): void {
      errorBanner.textContent = msg;
      errorBanner.style.display = "block";
    }

    // --- Dialog ---------------------------------------------------------------

    // Using <dialog> for native focus trapping and Esc key handling.
    const dialog = el("dialog");
    dialog.style.border = "none";
    dialog.style.borderRadius = "8px";
    dialog.style.padding = "28px 32px";
    dialog.style.maxWidth = "420px";
    dialog.style.width = "90vw";
    dialog.style.boxShadow = "0 6px 32px rgba(0,0,0,0.25)";

    // --- Title ----------------------------------------------------------------

    const title = el("h3");
    title.textContent = i18next.t("panel.finalFields.title");
    title.style.margin = "0 0 16px 0";
    title.style.fontSize = "16px";
    title.style.fontWeight = "700";

    // --- Form body ------------------------------------------------------------

    const form = el("form");
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "12px";
    // method="dialog" lets the native dialog close on submit (we intercept it).
    form.method = "dialog";

    // Reason row
    form.appendChild(
      labeledInput(i18next.t("panel.finalFields.reason"), reasonInput, "pff-reason"),
    );

    // Ignore traffic row — checkbox with inline label
    const ignoreRow = el("div");
    ignoreRow.style.display = "flex";
    ignoreRow.style.alignItems = "center";
    ignoreRow.style.gap = "8px";
    ignoreRow.style.cursor = "pointer";
    ignoreTrafficInput.id = "pff-ignore-traffic";
    const ignoreLabel = el("label");
    ignoreLabel.htmlFor = "pff-ignore-traffic";
    ignoreLabel.textContent = i18next.t("panel.finalFields.ignoreTraffic");
    ignoreLabel.style.fontSize = "13px";
    ignoreLabel.style.fontWeight = "600";
    ignoreLabel.style.color = "#333";
    ignoreLabel.style.cursor = "pointer";
    ignoreRow.appendChild(ignoreTrafficInput);
    ignoreRow.appendChild(ignoreLabel);
    form.appendChild(ignoreRow);

    // MTE ID row
    form.appendChild(labeledInput(i18next.t("panel.finalFields.mteId"), mteIdInput, "pff-mte-id"));

    // Comment row
    form.appendChild(
      labeledInput(i18next.t("panel.finalFields.comment"), commentInput, "pff-comment"),
    );

    form.appendChild(errorBanner);

    // --- Buttons --------------------------------------------------------------

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
    cancelBtn.addEventListener("click", () => {
      settle(null);
    });

    const okBtn = el("button");
    okBtn.type = "submit";
    okBtn.textContent = i18next.t("panel.finalFields.ok");
    okBtn.style.padding = "7px 16px";
    okBtn.style.cursor = "pointer";
    okBtn.style.fontWeight = "bold";

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(okBtn);

    // --- Submit handler -------------------------------------------------------

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const reason = reasonInput.value.trim();
      const comment = commentInput.value.trim();
      const mteId = mteIdInput.value.trim();

      // Guard comma in user-facing fields early so the error appears in the
      // modal rather than propagating to buildClosuresCsv as an unhandled throw.
      const commaError = i18next.t("panel.finalFields.errorCommaInField");
      if (reason.includes(",") || comment.includes(",") || mteId.includes(",")) {
        showError(commaError);
        return;
      }

      settle({
        reason,
        ignoreTraffic: ignoreTrafficInput.checked,
        mteId,
        comment,
      });
    });

    // --- Escape key closes with null ------------------------------------------

    // <dialog> already fires a "cancel" event on Escape — wire it here.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      settle(null);
    });

    // --- Assemble and open ----------------------------------------------------

    dialog.appendChild(title);
    dialog.appendChild(form);
    form.appendChild(buttonRow);

    document.body.appendChild(dialog);
    dialog.showModal();

    // Focus the reason field immediately so the user can type right away.
    reasonInput.focus();

    // --- Cleanup --------------------------------------------------------------

    function cleanup(): void {
      if (dialog.parentNode) {
        dialog.close();
        dialog.parentNode.removeChild(dialog);
      }
    }
  });
}
