// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { wzDialog } from "../ui/components/wzDialog";
import { promptClosureWindow } from "../ui/components/promptClosureWindow";

vi.spyOn(console, "warn").mockImplementation(() => {});

// Stand-in for WME's wz-dialog: only the API the helper calls.
class FakeWzDialog extends HTMLElement {
  showDialog(): void {}
  hideDialog(): void {}
}
customElements.define("wz-dialog", FakeWzDialog);

const host = () => document.querySelector("wz-dialog")!;

afterEach(() => document.body.replaceChildren());

describe("wzDialog on WME's wz-dialog", () => {
  it("uses WME's sm width by default", () => {
    void wzDialog({ title: "T", primaryLabel: "OK" });
    expect(host().getAttribute("size")).toBe("sm");
    expect(host().getAttribute("dismissible")).toBe("false");
  });

  it("opens the closure window wide enough for two dates and a delete button", () => {
    void promptClosureWindow({ date: "2026-10-05", startTime: "09:00", endTime: "17:30" });
    expect(host().getAttribute("size")).toBe("lg");
  });
});
