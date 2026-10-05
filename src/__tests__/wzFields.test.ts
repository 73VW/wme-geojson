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
  wzIconButton,
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

  it("splits date (with picker) and time like WME's MTE form", () => {
    const field = dateTimeInput({ label: "Début", value: "2026-10-05T09:00" });
    expect(field.date.type).toBe("date");
    expect(field.date.value).toBe("2026-10-05");
    expect(field.time.type).toBe("time");
    expect(field.time.value).toBe("09:00");
    expect(field.getValue()).toBe("2026-10-05T09:00");
    expect(field.root.textContent).toContain("Début");

    field.time.value = "";
    expect(field.getValue()).toBe("");

    field.setValue("2026-10-06T18:30");
    expect(field.date.value).toBe("2026-10-06");
    expect(field.time.value).toBe("18:30");
  });

  it("icon buttons carry a title and don't let the click bubble", () => {
    const onClick = vi.fn();
    const parent = vi.fn();
    const button = wzIconButton("w-icon-recenter", "Centrer", onClick);
    const row = document.createElement("div");
    row.addEventListener("click", parent);
    row.appendChild(button);
    button.click();
    expect(onClick).toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
    expect(button.title).toBe("Centrer");
    expect(button.querySelector("i.w-icon-recenter")).not.toBeNull();
  });
});
