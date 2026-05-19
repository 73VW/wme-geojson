import { i18next } from "../../../locales/i18n";
import { wzButton, wzTextInput } from "../components/wz";
import type { LineEntry } from "../../lines/types";
import { LineRowView } from "./LineRowView";

export interface LinesListProps {
  onLoadUrl: (url: string) => void;
  onSelect: (id: string) => void;
}

/**
 * Pure DOM view for the Lignes sub-tab: URL input + Load button, an inline
 * error slot, a source-type info line, and the list of LineRowViews.
 *
 * Uses the WME web components (wz-text-input / wz-button) so the sub-tab
 * matches the editor's native look.
 */
export class LinesListView {
  readonly root: HTMLElement;
  private readonly urlInputHost: HTMLElement;
  private currentUrl = "";
  private readonly errorEl: HTMLElement;
  private readonly sourceEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly onSelect: (id: string) => void;

  constructor(props: LinesListProps) {
    this.onSelect = props.onSelect;
    this.root = document.createElement("div");
    this.root.classList.add("sidebar-tab-pane-body", "wmegj-panel-root");

    const urlRow = document.createElement("section");
    urlRow.className = "wmegj-section";

    this.urlInputHost = wzTextInput({
      label: i18next.t("panel.lines.urlLabel"),
      type: "url",
      placeholder: "https://…",
      onInput: (value) => {
        this.currentUrl = value;
      },
    });
    urlRow.appendChild(this.urlInputHost);

    const loadBtn = wzButton({
      text: i18next.t("panel.lines.urlLoad"),
      variant: "primary",
      onClick: () => props.onLoadUrl(this.currentUrl.trim()),
    });
    loadBtn.classList.add("wmegj-load-btn");
    urlRow.appendChild(loadBtn);

    this.errorEl = document.createElement("p");
    this.errorEl.className = "wmegj-url-error";
    this.errorEl.style.display = "none";
    urlRow.appendChild(this.errorEl);

    this.root.appendChild(urlRow);

    this.sourceEl = document.createElement("p");
    this.sourceEl.className = "wmegj-source-line";
    this.root.appendChild(this.sourceEl);

    this.listEl = document.createElement("section");
    this.listEl.className = "wmegj-section";
    this.root.appendChild(this.listEl);
  }

  /** Pre-fill the URL field (e.g. from the query param). */
  setUrl(url: string): void {
    this.currentUrl = url;
    // The wz host exposes `.value`; the plain-input fallback nests an <input>.
    (this.urlInputHost as unknown as { value?: string }).value = url;
    this.urlInputHost.setAttribute("value", url);
    const nested = this.urlInputHost.querySelector("input");
    if (nested) nested.value = url;
  }

  setEntries(entries: readonly LineEntry[]): void {
    this.listEl.replaceChildren();
    if (entries.length === 0) {
      this.sourceEl.textContent = "";
      const empty = document.createElement("p");
      empty.className = "wmegj-lines-empty";
      empty.textContent = i18next.t("panel.lines.empty");
      this.listEl.appendChild(empty);
      return;
    }
    // Phase 7a always has exactly one entry (single Feature).
    this.sourceEl.textContent = i18next.t("panel.lines.sourceFeature");
    for (const entry of entries) {
      const row = new LineRowView({ entry, onSelect: this.onSelect });
      this.listEl.appendChild(row.root);
    }
  }

  showError(message: string): void {
    this.errorEl.textContent = i18next.t("panel.errors.loadUrl", { message });
    this.errorEl.style.display = "block";
  }

  clearError(): void {
    this.errorEl.textContent = "";
    this.errorEl.style.display = "none";
  }
}
