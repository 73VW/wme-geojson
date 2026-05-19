import { i18next } from "../../../locales/i18n";
import type { LineEntry } from "../../lines/types";

export interface LineRowProps {
  entry: LineEntry;
  onSelect: (id: string) => void;
}

/**
 * Pure DOM view for a single line in the Lignes list: colour pill, name,
 * and a "Sélectionner" button. No store access.
 */
export class LineRowView {
  readonly root: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly nameEl: HTMLElement;

  constructor(props: LineRowProps) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-line-row";
    this.root.style.display = "flex";
    this.root.style.alignItems = "center";
    this.root.style.gap = "8px";
    this.root.style.padding = "6px 0";

    this.pill = document.createElement("span");
    this.pill.style.width = "12px";
    this.pill.style.height = "12px";
    this.pill.style.borderRadius = "50%";
    this.pill.style.flex = "0 0 auto";
    this.root.appendChild(this.pill);

    this.nameEl = document.createElement("span");
    this.nameEl.style.flex = "1 1 auto";
    this.root.appendChild(this.nameEl);

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.textContent = i18next.t("panel.lines.select");
    selectBtn.addEventListener("click", () => props.onSelect(props.entry.id));
    this.root.appendChild(selectBtn);

    this.update(props.entry);
  }

  update(entry: LineEntry): void {
    this.pill.style.backgroundColor = entry.color;
    this.nameEl.textContent = entry.displayName;
  }
}
