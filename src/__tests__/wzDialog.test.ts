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
});
