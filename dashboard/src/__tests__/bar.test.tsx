import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Bar, getBarPercent } from "../components/primitives/bar";

describe("Bar percentage calculation", () => {
  it.each([
    ["undefined spent", undefined, 100, 0],
    ["undefined budget", 25, undefined, 0],
    ["null spent", null, 100, 0],
    ["null budget", 25, null, 0],
    ["NaN spent", Number.NaN, 100, 0],
    ["NaN budget", 25, Number.NaN, 0],
    ["Infinity spent", Number.POSITIVE_INFINITY, 100, 0],
    ["Infinity budget", 25, Number.POSITIVE_INFINITY, 0],
    ["negative spent", -5, 100, 0],
    ["over budget", 150, 100, 100],
    ["normal usage", 25, 100, 25],
  ])("%s resolves to a finite clamped percent", (_name, spent, budget, expected) => {
    expect(getBarPercent(spent, budget)).toBe(expected);
  });
});

describe("Bar rendering", () => {
  it("never renders a NaN width when values are missing or invalid", () => {
    render(<Bar label="Medical Bills" spent={Number.NaN} budget={undefined} />);

    const fill = screen.getByTestId("bar-fill") as HTMLDivElement;
    expect(fill.style.width).toBe("0%");
    expect(fill.getAttribute("style")).not.toContain("NaN");
  });

  it("keeps a visible track even when the fill is clamped to zero", () => {
    render(<Bar label="Medications" spent={undefined} budget={null} />);

    expect(screen.getByTestId("bar-track").outerHTML).toMatchInlineSnapshot(
      `"<div class="h-2 bg-slate-100 rounded-full overflow-hidden" data-testid="bar-track"><div class="h-full rounded-full transition-all duration-500 bg-sky-500" data-testid="bar-fill" style="width: 0%;"></div></div>"`,
    );
  });
});
