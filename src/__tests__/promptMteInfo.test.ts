// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.spyOn(console, "warn").mockImplementation(() => {});
import { promptMteInfo, validateManualMteInfo, type ManualMteInfo } from "../ui/promptMteInfo";

const base: ManualMteInfo = {
  title: "Fermeture",
  startDate: "2026-10-03T09:00",
  endDate: "2026-10-03T17:30",
  description: "",
  urlLink: "",
};

describe("validateManualMteInfo", () => {
  it("accepts a one-day event without description nor URL", () => {
    expect(validateManualMteInfo(base)).toBeNull();
  });

  it("rejects missing title or dates", () => {
    expect(validateManualMteInfo({ ...base, title: "" })).not.toBeNull();
    expect(validateManualMteInfo({ ...base, startDate: "" })).not.toBeNull();
    expect(validateManualMteInfo({ ...base, endDate: "" })).not.toBeNull();
  });

  it("rejects an end before the start, including same-day times", () => {
    expect(validateManualMteInfo({ ...base, endDate: "2026-10-02T17:30" })).not.toBeNull();
    expect(validateManualMteInfo({ ...base, endDate: "2026-10-03T08:00" })).not.toBeNull();
  });
});

describe("promptMteInfo", () => {
  it("truncates a long default title to the WME limit", () => {
    void promptMteInfo({
      title: "Rallye International du Valais 2026",
      userRank: 2,
      askDetails: true,
    });
    const title = document.querySelector<HTMLInputElement>("dialog input[type=text]")!;
    expect(title.value).toBe("Rallye International du V");
    document.body.replaceChildren();
  });

  it("asks only category and lock level when details come from slowUp", async () => {
    const result = promptMteInfo({ title: "x", userRank: 0, askDetails: false });
    expect(document.querySelectorAll("dialog input")).toHaveLength(0);
    document.querySelector<HTMLButtonElement>(".wmegj-button--primary")!.click();
    await expect(result).resolves.toEqual({
      options: { category: "SPORTING_EVENT", lockLevel: 1 },
      manual: null,
    });
  });
});
