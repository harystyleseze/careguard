import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Bar } from "../components/primitives/bar";

function barWidth(container: HTMLElement): string {
  const inner = container.querySelector<HTMLElement>(".rounded-full.transition-all");
  return inner?.style.width ?? "";
}

describe("Bar component — NaN/invalid guard (#288)", () => {
  it("renders 0% when spent and budget are both 0", () => {
    const { container } = render(<Bar label="Meds" spent={0} budget={0} />);
    expect(barWidth(container)).toBe("0%");
  });

  it("renders 0% when spent is undefined", () => {
    const { container } = render(<Bar label="Meds" spent={undefined as any} budget={200} />);
    expect(barWidth(container)).toBe("0%");
  });

  it("renders 0% when budget is undefined", () => {
    const { container } = render(<Bar label="Meds" spent={50} budget={undefined as any} />);
    expect(barWidth(container)).toBe("0%");
  });

  it("renders 0% when spent is null", () => {
    const { container } = render(<Bar label="Meds" spent={null as any} budget={100} />);
    expect(barWidth(container)).toBe("0%");
  });

  it("renders 0% when spent is NaN", () => {
    const { container } = render(<Bar label="Meds" spent={NaN} budget={100} />);
    expect(barWidth(container)).toBe("0%");
  });

  it("renders 0% when budget is NaN", () => {
    const { container } = render(<Bar label="Meds" spent={50} budget={NaN} />);
    expect(barWidth(container)).toBe("0%");
  });

  it("renders 0% when spent is Infinity", () => {
    const { container } = render(<Bar label="Meds" spent={Infinity} budget={100} />);
    expect(barWidth(container)).toBe("0%");
  });

  it("clamps negative spent to 0%", () => {
    const { container } = render(<Bar label="Meds" spent={-50} budget={100} />);
    expect(barWidth(container)).toBe("0%");
  });

  it("clamps over-budget to 100%", () => {
    const { container } = render(<Bar label="Meds" spent={500} budget={100} />);
    expect(barWidth(container)).toBe("100%");
  });

  it("renders correct percentage for normal values", () => {
    const { container } = render(<Bar label="Meds" spent={75} budget={100} />);
    expect(barWidth(container)).toBe("75%");
  });

  it("bar element always has a width attribute (never NaN%)", () => {
    const cases = [
      { spent: undefined as any, budget: undefined as any },
      { spent: NaN, budget: NaN },
      { spent: Infinity, budget: Infinity },
      { spent: -1, budget: 0 },
    ];
    for (const { spent, budget } of cases) {
      const { container } = render(<Bar label="x" spent={spent} budget={budget} />);
      const w = barWidth(container);
      expect(w).not.toContain("NaN");
      expect(w).toMatch(/^\d+(\.\d+)?%$/);
    }
  });
});
