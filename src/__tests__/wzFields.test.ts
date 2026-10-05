// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  dateTimeInput,
  isChecked,
  readValue,
  wzCheckbox,
  wzChipSelect,
  wzSelect,
  wzTextInput,
  wzTextarea,
} from "../ui/components/wz";

vi.spyOn(console, "warn").mockImplementation(() => {});

describe("wz field helpers (fallback DOM)", () => {
  it("reads text input and textarea values", () => {
    const input = wzTextInput({ label: "Titre", value: "abc", maxLength: 2 });
    expect(readValue(input)).toBe("abc");
    expect(input.querySelector("input")?.maxLength).toBe(2);

    const area = wzTextarea({ label: "Description", value: "long text" });
    expect(readValue(area)).toBe("long text");
  });

  it("selects the initial option and reads changes", () => {
    const select = wzSelect({
      label: "Catégorie",
      value: "B",
      options: [
        { value: "A", label: "a" },
        { value: "B", label: "b" },
      ],
    });
    expect(readValue(select)).toBe("B");
    select.querySelector("select")!.value = "A";
    expect(readValue(select)).toBe("A");
  });

  it("reports checkbox state", () => {
    const box = wzCheckbox({ label: "Ignorer le trafic", checked: true });
    expect(isChecked(box)).toBe(true);
    box.querySelector("input")!.click();
    expect(isChecked(box)).toBe(false);
  });

  it("chip select keeps exactly one chip checked and ignores disabled chips", () => {
    const chips = wzChipSelect({
      label: "Niveau",
      value: "1",
      options: [
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3", disabled: true },
      ],
    });
    const buttons = chips.root.querySelectorAll<HTMLButtonElement>("button");
    buttons[1].click();
    expect(chips.getValue()).toBe("2");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    buttons[2].click();
    expect(chips.getValue()).toBe("2");
  });

  it("datetime input keeps the datetime-local value format", () => {
    const { root, input } = dateTimeInput({ label: "Début", value: "2026-10-05T09:00" });
    expect(input.type).toBe("datetime-local");
    expect(input.value).toBe("2026-10-05T09:00");
    expect(root.textContent).toContain("Début");
  });
});
