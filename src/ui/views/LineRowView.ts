import { i18next } from "../../../locales/i18n";
import type { LineEntry } from "../../lines/types";

export interface LineRowProps {
  entry: LineEntry;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
}

/**
 * Pure DOM view for a single line in the Lignes list: colour pill, name, a
 * round "recenter" icon button, and a trailing affordance. The whole card is
 * clickable to select the line — except while its slowUp details are still
 * loading. No store access; styling comes from the shell-injected
 * `.wmegj-line-*` rules.
 */
export class LineRowView {
  readonly root: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly nameEl: HTMLElement;

  constructor(props: LineRowProps) {
    const isLoading = props.entry.slowupFetchStatus === "loading";

    this.root = document.createElement("div");
    this.root.className = isLoading ? "wmegj-line-row wmegj-line-row--loading" : "wmegj-line-row";
    if (!isLoading) {
      this.root.title = i18next.t("panel.lines.select");
      this.root.addEventListener("click", () => props.onSelect(props.entry.id));
    }

    this.pill = document.createElement("span");
    this.pill.className = "wmegj-line-pill";
    this.root.appendChild(this.pill);

    this.nameEl = document.createElement("span");
    this.nameEl.className = "wmegj-line-name";
    this.root.appendChild(this.nameEl);

    if (props.entry.slowupFetchStatus === "error") {
      const warn = document.createElement("i");
      warn.className = "w-icon w-icon-alert-fill wmegj-line-warning";
      warn.title = i18next.t("panel.lines.detailsError");
      this.root.appendChild(warn);
    }

    const centerBtn = document.createElement("button");
    centerBtn.type = "button";
    centerBtn.className = "wmegj-icon-btn";
    centerBtn.title = i18next.t("panel.lines.center");
    const centerIcon = document.createElement("i");
    centerIcon.className = "w-icon w-icon-recenter w-icon-2x";
    centerBtn.appendChild(centerIcon);
    centerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      props.onCenter(props.entry.id);
    });
    this.root.appendChild(centerBtn);

    if (isLoading) {
      const spinner = document.createElement("span");
      spinner.className = "wmegj-spinner";
      spinner.title = i18next.t("panel.lines.detailsLoading");
      spinner.setAttribute("aria-label", i18next.t("panel.lines.detailsLoading"));
      this.root.appendChild(spinner);
    } else {
      const arrow = document.createElement("i");
      arrow.className = "w-icon w-icon-arrow-right wmegj-line-arrow";
      arrow.setAttribute("aria-hidden", "true");
      this.root.appendChild(arrow);
    }

    this.update(props.entry);
  }

  update(entry: LineEntry): void {
    this.pill.style.backgroundColor = entry.color;
    this.nameEl.textContent = entry.displayName;
  }
}
