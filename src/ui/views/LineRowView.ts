import { i18next } from "../../../locales/i18n";
import { wzButton } from "../components/wz";
import type { LineEntry } from "../../lines/types";

export interface LineRowProps {
  entry: LineEntry;
  onSelect: (id: string) => void;
}

/**
 * Pure DOM view for a single line in the Lignes list: colour pill, name,
 * and a "Sélectionner" button. No store access. Styling comes from the
 * shell-injected `.wmegj-line-*` rules so it matches the WME editor look.
 */
export class LineRowView {
  readonly root: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly nameEl: HTMLElement;

  constructor(props: LineRowProps) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-line-row";

    this.pill = document.createElement("span");
    this.pill.className = "wmegj-line-pill";
    this.root.appendChild(this.pill);

    this.nameEl = document.createElement("span");
    this.nameEl.className = "wmegj-line-name";
    this.root.appendChild(this.nameEl);

    const selectBtn = wzButton({
      text: i18next.t("panel.lines.select"),
      variant: "primary",
      onClick: () => props.onSelect(props.entry.id),
    });
    this.root.appendChild(selectBtn);

    this.update(props.entry);
  }

  update(entry: LineEntry): void {
    this.pill.style.backgroundColor = entry.color;
    this.nameEl.textContent = entry.displayName;
  }
}
