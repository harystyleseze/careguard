import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BillLineItemsVirtualized from "../app/page#BillLineItemsVirtualized";

// Mock the virtualizer
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => [
      { index: 0, size: 80, start: 0 },
      { index: 1, size: 80, start: 80 },
      { index: 2, size: 80, start: 160 },
    ],
    getTotalSize: () => 240,
  })),
}));

describe("BillLineItemsVirtualized", () => {
  const mockLineItems = Array.from({ length: 100 }, (_, i) => ({
    description: `Test Item ${i + 1}`,
    cptCode: `992${String(i + 1).padStart(2, "0")}`,
    chargedAmount: 100 + i,
    status: i % 3 === 0 ? "valid" : i % 3 === 1 ? "duplicate" : "upcoded",
    suggestedAmount: i % 3 === 0 ? 100 + i : 80 + i,
    errorDescription: i % 3 === 0 ? null : "Test error",
  }));

  it("should render normally for 50 or fewer items", () => {
    const smallList = mockLineItems.slice(0, 50);
    render(<BillLineItemsVirtualized lineItems={smallList} />);

    // Should render all items without virtualization
    expect(screen.getByText("Test Item 1")).toBeInTheDocument();
    expect(screen.getByText("Test Item 50")).toBeInTheDocument();
  });

  it("should use virtualization for more than 50 items", () => {
    const largeList = mockLineItems.slice(0, 100);
    render(<BillLineItemsVirtualized lineItems={largeList} />);

    // Should only render visible items due to virtualization
    expect(screen.getByText("Test Item 1")).toBeInTheDocument();
    // Should not render all 100 items in DOM
    expect(document.querySelectorAll('[data-testid="line-item"]')).toHaveLength(
      3,
    );
  });

  it("should render error states correctly", () => {
    const errorItems = [
      {
        description: "Error Item",
        cptCode: "99213",
        chargedAmount: 200,
        status: "duplicate",
        suggestedAmount: 0,
        errorDescription: "Duplicate charge detected",
      },
    ];

    render(<BillLineItemsVirtualized lineItems={errorItems} />);

    expect(screen.getByText("Error Item")).toBeInTheDocument();
    expect(screen.getByText("Duplicate charge detected")).toBeInTheDocument();
    expect(screen.getByText("$200")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
  });

  it("should render valid items correctly", () => {
    const validItems = [
      {
        description: "Valid Item",
        cptCode: "99214",
        chargedAmount: 150,
        status: "valid",
        suggestedAmount: 150,
        errorDescription: null,
      },
    ];

    render(<BillLineItemsVirtualized lineItems={validItems} />);

    expect(screen.getByText("Valid Item")).toBeInTheDocument();
    expect(screen.getByText("$150")).toBeInTheDocument();
    expect(
      screen.queryByText("Duplicate charge detected"),
    ).not.toBeInTheDocument();
  });

  it("should handle empty list", () => {
    render(<BillLineItemsVirtualized lineItems={[]} />);

    // Should not crash and should render empty container
    expect(screen.queryByText("Test Item")).not.toBeInTheDocument();
  });
});
