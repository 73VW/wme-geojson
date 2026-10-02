import { describe, expect, it } from "vitest";
import { closureWindowDefaults } from "../ui/components/promptClosureWindow";

const fallback = { date: "2026-10-02", startTime: "09:00", endTime: "17:30" };

describe("closureWindowDefaults", () => {
  it("takes date and times from a one-day MTE", () => {
    expect(
      closureWindowDefaults(
        { startDate: "2026-10-30 06:30", endDate: "2026-10-30 18:00" },
        fallback,
      ),
    ).toEqual({ date: "2026-10-30", startTime: "06:30", endTime: "18:00" });
  });

  it("keeps only the start date when the MTE spans several days", () => {
    expect(
      closureWindowDefaults(
        { startDate: "2026-10-30 06:30", endDate: "2026-10-31 18:00" },
        fallback,
      ),
    ).toEqual({ date: "2026-10-30", startTime: "09:00", endTime: "17:30" });
  });

  it("falls back without a loaded MTE or with missing dates", () => {
    expect(closureWindowDefaults(null, fallback)).toEqual(fallback);
    expect(closureWindowDefaults({ startDate: null, endDate: null }, fallback)).toEqual(fallback);
  });
});
