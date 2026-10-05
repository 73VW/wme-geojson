// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { wzDialog } from "../ui/components/wzDialog";

vi.spyOn(console, "warn").mockImplementation(() => {});

const primary = () => document.querySelector<HTMLButtonElement>(".wmegj-button--primary")!;
const cancel = () => document.querySelector<HTMLButtonElement>(".wmegj-button--secondary")!;
const key = (target: EventTarget, k: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, composed: true }));

afterEach(() => {
  document.body.replaceChildren();
});

describe("wzDialog", () => {
  it("resolves true on primary and removes itself", async () => {
    const result = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    primary().click();
    await expect(result).resolves.toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("resolves false on cancel and on Escape", async () => {
    const byButton = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    cancel().click();
    await expect(byButton).resolves.toBe(false);

    const byEscape = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    key(document.body, "Escape");
    await expect(byEscape).resolves.toBe(false);
  });

  it("submits on Enter in a text field but not in a textarea", async () => {
    const area = document.createElement("textarea");
    const input = document.createElement("input");
    const result = wzDialog({ title: "T", body: [area, input], primaryLabel: "OK" });
    key(area, "Enter");
    expect(document.querySelector("dialog")).not.toBeNull();
    key(input, "Enter");
    await expect(result).resolves.toBe(true);
  });

  it("Enter on the cancel button cancels instead of submitting", async () => {
    const result = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    key(cancel(), "Enter");
    expect(document.querySelector("dialog")).not.toBeNull();
    cancel().click();
    await expect(result).resolves.toBe(false);
  });

  it("stays open and shows the error returned by onPrimary", async () => {
    let attempts = 0;
    const result = wzDialog({
      title: "T",
      primaryLabel: "OK",
      onPrimary: () => (++attempts === 1 ? "Champ obligatoire" : null),
    });
    primary().click();
    expect(document.querySelector(".wmegj-dialog-error")?.textContent).toBe("Champ obligatoire");
    primary().click();
    await expect(result).resolves.toBe(true);
  });

  it("only the topmost dialog reacts to keys", async () => {
    const bottom = wzDialog({ title: "Bottom", primaryLabel: "OK", cancelLabel: "Annuler" });
    const top = wzDialog({ title: "Top", primaryLabel: "OK", cancelLabel: "Annuler" });
    key(document.body, "Escape");
    await expect(top).resolves.toBe(false);
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    key(document.body, "Escape");
    await expect(bottom).resolves.toBe(false);
  });

  it("renders a single button when there is no cancel label", () => {
    void wzDialog({ title: "T", primaryLabel: "OK" });
    expect(document.querySelectorAll("dialog button")).toHaveLength(1);
  });

  it("closes on Escape even when wz-dialog stops propagation at window level", async () => {
    // WME's wz-dialog listens on window (capture) and stops Escape propagation.
    const stopEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopPropagation();
    };
    window.addEventListener("keydown", stopEscape, true);
    const result = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    key(document.body, "Escape");
    window.removeEventListener("keydown", stopEscape, true);
    await expect(result).resolves.toBe(false);
  });

  it("Enter on a button outside the dialog submits the dialog, not that button", async () => {
    // e.g. focus left on the sidebar button that opened the dialog
    const opener = document.createElement("button");
    const reopen = vi.fn();
    opener.addEventListener("click", reopen);
    document.body.appendChild(opener);
    opener.focus();
    const result = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    key(opener, "Enter");
    await expect(result).resolves.toBe(true);
    expect(reopen).not.toHaveBeenCalled();
  });

  it("focuses the primary button when no field asks for focus", () => {
    void wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    expect(document.activeElement).toBe(primary());
  });

  it("Escape closes an open menu inside the dialog, not the dialog", () => {
    // wz-select exposes `expanded` while open; wz-dialog stops Escape before
    // the select sees it, so the dialog has to close the menu itself.
    const select = document.createElement("div");
    const hideMenu = vi.fn(() => Object.assign(select, { expanded: false }));
    Object.assign(select, { expanded: true, hideMenu });
    void wzDialog({ title: "T", body: [select], primaryLabel: "OK", cancelLabel: "Annuler" });
    key(select, "Escape");
    expect(hideMenu).toHaveBeenCalledOnce();
    expect(document.querySelector("dialog")).not.toBeNull();
  });

  it("leaves Enter to an open menu inside the dialog", () => {
    const select = document.createElement("div");
    Object.assign(select, { expanded: true });
    void wzDialog({ title: "T", body: [select], primaryLabel: "OK" });
    key(select, "Enter");
    expect(document.querySelector("dialog")).not.toBeNull();
  });

  it("does not submit on the Enter that ends an IME composition", () => {
    const input = document.createElement("input");
    void wzDialog({ title: "T", body: [input], primaryLabel: "OK" });
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
    expect(document.querySelector("dialog")).not.toBeNull();
  });
});
