import { i18next } from "../../../locales/i18n";
import type { LineEntry } from "../../lines/types";

export interface LineRowProps {
  entry: LineEntry;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
}

/**
 * Pure DOM view for a single line in the Lignes list: colour pill, name, a
 * round "recenter" icon button, and a trailing arrow. The whole card is
 * clickable to select the line. No store access; styling comes from the
 * shell-injected `.wmegj-line-*` rules so it matches the WME editor look.
 */
export class LineRowView {
  readonly root: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly nameEl: HTMLElement;

  constructor(props: LineRowProps) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-line-row";
    this.root.title = i18next.t("panel.lines.select");
    this.root.addEventListener("click", () => props.onSelect(props.entry.id));

    this.pill = document.createElement("span");
    this.pill.className = "wmegj-line-pill";
    this.root.appendChild(this.pill);

    this.nameEl = document.createElement("span");
    this.nameEl.className = "wmegj-line-name";
    this.root.appendChild(this.nameEl);

    const centerBtn = document.createElement("button");
    centerBtn.type = "button";
    centerBtn.className = "wmegj-icon-btn";
    centerBtn.title = i18next.t("panel.lines.center");
    const centerIcon = document.createElement("i");
    centerIcon.className = "w-icon w-icon-recenter w-icon-2x";
    centerBtn.appendChild(centerIcon);
    // The card itself selects the line; the center button must not also
    // trigger that, so it stops the click from bubbling up to the card.
    centerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      props.onCenter(props.entry.id);
    });
    this.root.appendChild(centerBtn);

    // Trailing arrow — a visual affordance that the card opens the line.
    const arrow = document.createElement("i");
    arrow.className = "w-icon w-icon-arrow-right wmegj-line-arrow";
    arrow.setAttribute("aria-hidden", "true");
    this.root.appendChild(arrow);

    this.update(props.entry);
  }

  update(entry: LineEntry): void {
    this.pill.style.backgroundColor = entry.color;
    this.nameEl.textContent = entry.displayName;
  }
}
