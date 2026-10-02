import { describe, expect, it, vi } from "vitest";
import { pollUntil } from "../utils/pollUntil";

describe("pollUntil", () => {
  it("checks 3 times, 1 s apart, then gives up", async () => {
    vi.useFakeTimers();
    const check = vi.fn(() => false);
    const pending = pollUntil(check, 3, 1000);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(3);
    await expect(pending).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("stops as soon as the check passes", async () => {
    const check = vi.fn(() => true);
    await expect(pollUntil(check, 3, 1000)).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
