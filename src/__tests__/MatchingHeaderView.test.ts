// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MatchingHeaderView } from "../ui/views/MatchingHeaderView";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

describe("MatchingHeaderView", () => {
  it("goes back to the Lignes tab", () => {
    const onBack = vi.fn();
    const header = new MatchingHeaderView({ onBack });
    header.root.querySelector<HTMLButtonElement>(".wmegj-back")!.click();
    expect(onBack).toHaveBeenCalled();
  });

  it("summarises length and progress on one line", () => {
    const header = new MatchingHeaderView({ onBack: vi.fn() });
    header.setTitle("SS7+11 Les Cols");
    const summary = () => header.root.querySelector(".wmegj-header-summary")?.textContent;

    header.setSummary(30.85, { kind: "notStarted" });
    expect(header.root.textContent).toContain("SS7+11 Les Cols");
    expect(summary()).toBe("30.85 km · Pas commencé");

    header.setSummary(30.85, { kind: "inProgress", percent: 40 });
    expect(summary()).toBe("30.85 km · 40 % validé");

    header.setSummary(null, { kind: "done" });
    expect(summary()).toBe("Correspondance terminée");
  });

  it("looks like a WME panel header: back icon, kicker, title", () => {
    const header = new MatchingHeaderView({ onBack: vi.fn() });
    header.setTitle("SS7+11 Les Cols");
    expect(header.root.querySelector(".wmegj-back i.w-icon-arrow-left")).not.toBeNull();
    expect(header.root.querySelector(".wmegj-header-kicker")?.textContent).toBe("Ligne");
  });
});
