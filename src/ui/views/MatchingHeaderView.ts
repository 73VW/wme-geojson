// Pure DOM view for the matching panel header: the panel title and the
// walk-state badge. No SDK, no store access — the controller drives it
// via setBadge(). Created as part of the view/logic separation refactor.

import { i18next } from "../../../locales/i18n";
import type { WalkState } from "../../controller/walkStates";

export class MatchingHeaderView {
  /** Root element — append this where the title + badge used to be built. */
  readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly badgeEl: HTMLElement;

  constructor() {
    this.root = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "wmegj-panel-title";
    title.textContent = i18next.t("panel.title");
    this.root.appendChild(title);
    this.titleEl = title;

    const badgeWrapper = document.createElement("p");
    this.badgeEl = document.createElement("strong");
    this.badgeEl.textContent = "—";
    badgeWrapper.appendChild(this.badgeEl);
    this.root.appendChild(badgeWrapper);
  }

  /** Replace the panel title with the selected line's display name. */
  setTitle(name: string): void {
    this.titleEl.textContent = name;
  }

  /** Update the walk-state badge text. */
  setBadge(state: WalkState): void {
    this.badgeEl.textContent = i18next.t(`panel.status.${state}`);
  }
}
