import { describe, expect, it } from "vitest";
import { validateManualMteInfo, type ManualMteInfo } from "../ui/promptMteInfo";

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
