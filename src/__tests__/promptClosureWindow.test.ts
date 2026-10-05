// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18next from "i18next";
import { promptClosureWindow } from "../ui/components/promptClosureWindow";

vi.spyOn(console, "warn").mockImplementation(() => {});

const defaults = { date: "2026-10-05", startTime: "09:00", endTime: "17:30" };
const dates = () => [...document.querySelectorAll<HTMLInputElement>("dialog .wmegj-date")];
const times = () => [...document.querySelectorAll<HTMLInputElement>("dialog .wmegj-time")];
const ok = () => document.querySelector<HTMLButtonElement>(".wmegj-button--primary")!;

// Uninitialised i18next returns undefined; with no resources it returns the key.
beforeAll(async () => {
  await i18next.init({ lng: "en", resources: {} });
});

afterEach(() => document.body.replaceChildren());

describe("promptClosureWindow", () => {
  it("returns the prefilled window", async () => {
    const result = promptClosureWindow(defaults, "apply");
    ok().click();
    await expect(result).resolves.toEqual([
      { startISO: "2026-10-05T09:00", endISO: "2026-10-05T17:30" },
    ]);
  });

  it("stays open when the end is not after the start", () => {
    void promptClosureWindow(defaults, "apply");
    times()[1].value = "09:00";
    ok().click();
    expect(document.querySelector("dialog")).not.toBeNull();
    expect(document.querySelector(".wmegj-dialog-error")?.textContent).not.toBe("");
  });

  it("adds a line on the last line's date and never removes the only line", () => {
    void promptClosureWindow(defaults, "apply");
    const removeButtons = () => [
      ...document.querySelectorAll<HTMLButtonElement>(".wmegj-icon-only"),
    ];
    expect(removeButtons()[0].disabled).toBe(true);
    document.querySelector<HTMLButtonElement>(".wmegj-button--text")!.click();
    expect(dates()).toHaveLength(4); // start + end date per line
    expect(dates()[2].value).toBe("2026-10-05");
    expect(times()[2].value).toBe("09:00");
    expect(removeButtons()[0].disabled).toBe(false);
  });
});
