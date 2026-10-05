// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PanelMenuView } from "../ui/views/PanelMenuView";

describe("PanelMenuView", () => {
  it("opens from its ⋯ button and runs the chosen item, then closes", () => {
    const debug = vi.fn();
    const menu = new PanelMenuView({ label: "Plus d'actions" });
    document.body.appendChild(menu.root);
    menu.setItems([{ label: "Debug", onSelect: debug }]);
    const toggle = menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-toggle")!;
    expect(toggle.title).toBe("Plus d'actions");
    expect(menu.isOpen()).toBe(false);
    toggle.click();
    expect(menu.isOpen()).toBe(true);
    menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-item")!.click();
    expect(debug).toHaveBeenCalled();
    expect(menu.isOpen()).toBe(false);
  });

  it("marks dangerous items and skips disabled ones", () => {
    const restart = vi.fn();
    const menu = new PanelMenuView({ label: "…" });
    menu.setItems([{ label: "Recommencer", onSelect: restart, danger: true, disabled: true }]);
    menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-toggle")!.click();
    const item = menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-item")!;
    expect(item.classList.contains("is-danger")).toBe(true);
    expect(item.disabled).toBe(true);
    item.click();
    expect(restart).not.toHaveBeenCalled();
  });

  it("closes on a click outside", () => {
    const menu = new PanelMenuView({ label: "…" });
    document.body.appendChild(menu.root);
    menu.setItems([{ label: "Debug", onSelect: vi.fn() }]);
    menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-toggle")!.click();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });
});
