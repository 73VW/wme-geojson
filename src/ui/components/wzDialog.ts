// Dialogs built exactly like WME's own (e.g. the "save edits" dialog):
//   #wz-dialog-container > wz-dialog > wz-dialog-content + wz-dialog-controls
// wz-dialog is opened with showDialog() once upgraded. dismissible="false"
// removes the × and the backdrop close, so every exit goes through settle().

import i18next from "i18next";
import { injectStyles } from "../styles";
import { wzButton } from "./wz";

export interface WzDialogOptions {
  title: string;
  /** Nodes under the title. Strings become wz-body2 paragraphs. */
  body?: (Node | string)[];
  primaryLabel: string;
  /** Omit for a single-button information dialog. */
  cancelLabel?: string;
  /** Runs on primary click / Enter. Return an error message to stay open. */
  onPrimary?: () => string | null;
  focus?: HTMLElement;
  /** WME widths: xs 320px, sm 400px (default), lg 560px, xl 720px. */
  size?: "xs" | "sm" | "lg" | "xl";
}

interface WzDialogElement extends HTMLElement {
  componentOnReady?: () => Promise<unknown>;
  showDialog?: () => void;
  hideDialog?: () => void;
}

// Topmost last: only the top dialog handles Enter / Escape.
const openDialogs: HTMLElement[] = [];

function isTagRegistered(tagName: string): boolean {
  return typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;
}

function textElement(tagName: string, text: string, className = ""): HTMLElement {
  const el = document.createElement(isTagRegistered(tagName) ? tagName : "p");
  el.className = className;
  el.textContent = text;
  return el;
}

export function wzDialog(opts: WzDialogOptions): Promise<boolean> {
  injectStyles(document);
  const useNative = isTagRegistered("wz-dialog");

  const body = document.createElement("div");
  body.className = "wmegj-dialog-body";
  body.appendChild(textElement("wz-h4", opts.title));
  for (const part of opts.body ?? []) {
    body.appendChild(typeof part === "string" ? textElement("wz-body2", part) : part);
  }
  const errorEl = textElement("wz-caption", "", "wmegj-dialog-error");
  body.appendChild(errorEl);

  const primaryBtn = wzButton({ text: opts.primaryLabel, variant: "primary" });
  const cancelBtn = opts.cancelLabel
    ? wzButton({ text: opts.cancelLabel, variant: "secondary" })
    : null;
  cancelBtn?.setAttribute("alarming", "");

  const controls = document.createElement(useNative ? "wz-dialog-controls" : "div");
  controls.className = "wmegj-dialog-controls";
  controls.setAttribute("layout", "horizontal-reverse");
  controls.appendChild(primaryBtn);
  if (cancelBtn) controls.appendChild(cancelBtn);

  let host: WzDialogElement;
  if (useNative) {
    host = document.createElement("wz-dialog");
    host.setAttribute("size", opts.size ?? "sm");
    host.setAttribute("dismissible", "false");
    const content = document.createElement("wz-dialog-content");
    content.appendChild(body);
    host.append(content, controls);
  } else {
    host = document.createElement("dialog");
    host.className = "wmegj-dialog-fallback";
    host.append(body, controls);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;

    function settle(result: boolean): void {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKeyDown, true);
      openDialogs.splice(openDialogs.indexOf(host), 1);
      host.hideDialog?.();
      host.remove();
      resolve(result);
    }

    function submit(): void {
      const error = opts.onPrimary?.() ?? null;
      if (error) {
        errorEl.textContent = error;
        return;
      }
      settle(true);
    }

    function onKeyDown(event: KeyboardEvent): void {
      const isTopmost = openDialogs[openDialogs.length - 1] === host;
      if (!isTopmost) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        settle(false);
        return;
      }
      if (event.key !== "Enter") return;

      // Enter keeps its normal meaning in a textarea (new line) and on a
      // button (activates that button — e.g. Cancel must not submit).
      const path = event.composedPath();
      const inTextarea = path.some(
        (node) => node instanceof HTMLElement && /^(TEXTAREA|WZ-TEXTAREA)$/.test(node.tagName),
      );
      const onButton = path.some(
        (node) => node instanceof HTMLElement && /^(BUTTON|WZ-BUTTON)$/.test(node.tagName),
      );
      if (inTextarea || onButton) return;

      event.preventDefault();
      event.stopPropagation();
      submit();
    }

    primaryBtn.addEventListener("click", submit);
    cancelBtn?.addEventListener("click", () => settle(false));
    host.addEventListener("cancel", (event) => {
      // Fallback <dialog>: its native Esc handling would close without us.
      event.preventDefault();
      settle(false);
    });
    // window, not document: wz-dialog stops Escape propagation on window
    // (capture), which would hide it from a document listener.
    window.addEventListener("keydown", onKeyDown, true);

    const container = document.getElementById("wz-dialog-container") ?? document.body;
    container.appendChild(host);
    openDialogs.push(host);

    if (useNative) {
      void (host.componentOnReady?.() ?? Promise.resolve()).then(() => {
        host.showDialog?.();
        opts.focus?.focus();
      });
    } else {
      const fallback = host as unknown as HTMLDialogElement;
      if (typeof fallback.showModal === "function") fallback.showModal();
      else fallback.setAttribute("open", "");
      opts.focus?.focus();
    }
  });
}

export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}): Promise<boolean> {
  return wzDialog({
    title: opts.title,
    body: [opts.message],
    primaryLabel: opts.confirmLabel,
    cancelLabel: opts.cancelLabel,
  });
}

/** Replacement for window.alert(): one OK button, never blocks the page. */
export async function alertDialog(message: string): Promise<void> {
  await wzDialog({
    title: i18next.t("panel.dialogs.errorTitle"),
    body: [message],
    primaryLabel: i18next.t("panel.dialogs.ok"),
  });
}
