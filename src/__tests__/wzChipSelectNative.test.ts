// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { wzChipSelect } from "../ui/components/wz";

// Mimics WME's wz-checkable-chip: a click toggles `checked` itself unless the
// chip is `controlled`, and the toggle runs after listeners added by users.
class FakeCheckableChip extends HTMLElement {
  checked = false;
  connectedCallback(): void {
    this.addEventListener("click", () =>
      queueMicrotask(() => {
        if (!this.hasAttribute("controlled")) this.checked = !this.checked;
      }),
    );
  }
}
customElements.define("wz-checkable-chip", FakeCheckableChip);

describe("wzChipSelect with WME chips", () => {
  it("keeps the clicked chip checked", async () => {
    const chips = wzChipSelect({
      label: "Niveau",
      value: "1",
      options: [
        { value: "1", label: "1" },
        { value: "3", label: "3" },
      ],
    });
    document.body.appendChild(chips.root);
    const [first, third] = [...chips.root.querySelectorAll<FakeCheckableChip>("wz-checkable-chip")];
    third.click();
    await Promise.resolve();
    expect(chips.getValue()).toBe("3");
    expect(third.checked).toBe(true);
    expect(first.checked).toBe(false);
  });
});
