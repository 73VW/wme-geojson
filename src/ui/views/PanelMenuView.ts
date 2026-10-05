// "⋯" button opening a small menu of secondary actions (Debug, copy debug
// JSON, restart). Closes after a choice or a click outside.

export interface PanelMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export class PanelMenuView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;

  constructor(props: { label: string }) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-menu";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wmegj-icon-only wmegj-menu-toggle";
    toggle.title = props.label;
    toggle.setAttribute("aria-label", props.label);
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.textContent = "⋯";
    toggle.addEventListener("click", () => (this.isOpen() ? this.close() : this.open()));

    this.list = document.createElement("div");
    this.list.className = "wmegj-menu-list";
    this.list.setAttribute("role", "menu");
    this.list.hidden = true;

    this.root.append(toggle, this.list);
  }

  setItems(items: PanelMenuItem[]): void {
    this.list.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = item.danger ? "wmegj-menu-item is-danger" : "wmegj-menu-item";
        button.setAttribute("role", "menuitem");
        button.textContent = item.label;
        button.disabled = item.disabled ?? false;
        button.addEventListener("click", () => {
          if (button.disabled) return;
          this.close();
          item.onSelect();
        });
        return button;
      }),
    );
  }

  isOpen(): boolean {
    return !this.list.hidden;
  }

  close(): void {
    this.list.hidden = true;
    document.removeEventListener("pointerdown", this.onOutside, true);
  }

  private open(): void {
    this.list.hidden = false;
    document.addEventListener("pointerdown", this.onOutside, true);
  }

  private readonly onOutside = (event: Event): void => {
    if (!this.root.contains(event.target as Node)) this.close();
  };
}
