import { i18next } from "../../../locales/i18n";
import type { LineEntry } from "../../lines/types";
import { LineRowView } from "./LineRowView";

export interface LinesListProps {
  onLoadUrl: (url: string) => void;
  onSelect: (id: string) => void;
}

/**
 * Pure DOM view for the Lignes sub-tab: URL input + Load button, an inline
 * error slot, a source-type info line, and the list of LineRowViews.
 */
export class LinesListView {
  readonly root: HTMLElement;
  private readonly urlInput: HTMLInputElement;
  private readonly errorEl: HTMLElement;
  private readonly sourceEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly onSelect: (id: string) => void;

  constructor(props: LinesListProps) {
    this.onSelect = props.onSelect;
    this.root = document.createElement("div");
    this.root.classList.add("sidebar-tab-pane-body");

    const urlRow = document.createElement("section");
    urlRow.className = "wmegj-section";

    const label = document.createElement("label");
    label.textContent = i18next.t("panel.lines.urlLabel");
    urlRow.appendChild(label);

    this.urlInput = document.createElement("input");
    this.urlInput.type = "url";
    this.urlInput.style.width = "100%";
    urlRow.appendChild(this.urlInput);

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = i18next.t("panel.lines.urlLoad");
    loadBtn.addEventListener("click", () => props.onLoadUrl(this.urlInput.value.trim()));
    urlRow.appendChild(loadBtn);

    this.errorEl = document.createElement("p");
    this.errorEl.style.color = "#c00";
    this.errorEl.style.fontSize = "12px";
    this.errorEl.style.display = "none";
    urlRow.appendChild(this.errorEl);

    this.root.appendChild(urlRow);

    this.sourceEl = document.createElement("p");
    this.sourceEl.style.fontWeight = "600";
    this.root.appendChild(this.sourceEl);

    this.listEl = document.createElement("div");
    this.root.appendChild(this.listEl);
  }

  setUrl(url: string): void {
    this.urlInput.value = url;
  }

  setEntries(entries: readonly LineEntry[]): void {
    this.listEl.replaceChildren();
    if (entries.length === 0) {
      this.sourceEl.textContent = "";
      const empty = document.createElement("p");
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
