/**
 * Generic confirmation modal for the WME GeoJSON userscript.
 *
 * Provides a single function, confirmModal(), that shows a styled overlay
 * with a message and two buttons (confirm / cancel), and returns a Promise
 * that resolves to true (confirm) or false (cancel, Esc, backdrop click).
 *
 * Why inline styles: avoids needing a separate CSS file or injecting a
 * <style> tag; the modal is a thin, one-off UI piece whose styling is not
 * expected to vary. Inline styles on createElement elements are acceptable
 * here per the project conventions.
 *
 * DOM safety: message and label strings come from i18n; we use textContent,
 * never innerHTML, so no XSS risk even if i18n strings were ever tampered with.
 */

export interface ConfirmOptions {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * Display a modal confirmation dialog and return whether the user confirmed.
 *
 * Resolves true  → user clicked the confirm button.
 * Resolves false → user clicked cancel, pressed Esc, or clicked the backdrop.
 *
 * The overlay is appended to document.body and removed on resolution.
 * All event listeners are cleaned up on resolution.
 */
export function confirmModal(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Track whether the promise has already been resolved to prevent double-
    // firing if multiple close paths trigger in quick succession.
    let settled = false;

    function settle(result: boolean): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    // --- Overlay (semi-transparent backdrop) ---
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0, 0, 0, 0.55)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    // A high z-index to sit above WME's own panels and modals.
    overlay.style.zIndex = "99999";

    // --- Card ---
    const card = document.createElement("div");
    card.style.background = "#ffffff";
    card.style.borderRadius = "6px";
    card.style.padding = "24px 28px";
    card.style.maxWidth = "420px";
    card.style.width = "90%";
    card.style.boxShadow = "0 4px 24px rgba(0, 0, 0, 0.25)";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "20px";

    // --- Message ---
    const messageEl = document.createElement("p");
    messageEl.textContent = opts.message;
    messageEl.style.margin = "0";
    messageEl.style.fontSize = "14px";
    messageEl.style.lineHeight = "1.5";
    messageEl.style.color = "#333";
    card.appendChild(messageEl);

    // --- Button row ---
    const buttonRow = document.createElement("div");
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "flex-end";
    buttonRow.style.gap = "10px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = opts.cancelLabel;
    cancelBtn.style.padding = "7px 16px";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.addEventListener("click", () => {
      settle(false);
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = opts.confirmLabel;
    confirmBtn.style.padding = "7px 16px";
    confirmBtn.style.cursor = "pointer";
    confirmBtn.style.fontWeight = "bold";
    confirmBtn.addEventListener("click", () => {
      settle(true);
    });

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(confirmBtn);
    card.appendChild(buttonRow);

    overlay.appendChild(card);

    // --- Backdrop click: close without confirming ---
    // We want only clicks directly on the overlay (not bubbling up from the
    // card) to dismiss, so we compare event.target.
    function onOverlayClick(e: MouseEvent): void {
      if (e.target === overlay) {
        settle(false);
      }
    }

    // --- Esc key: close without confirming ---
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        settle(false);
      }
    }

    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown);

    function cleanup(): void {
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeyDown);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }

    document.body.appendChild(overlay);

    // Focus the confirm button so keyboard users can press Enter immediately.
    confirmBtn.focus();
  });
}
