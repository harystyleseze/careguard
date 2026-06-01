import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { EnhancedDetailView } from "../src/components/enhanced-detail-view";

describe("Purchase Button States", () => {
  const mockData = {
    id: "test-1",
    name: "Test Medication",
    creator: "GTEST123",
    price: 10,
    salesCount: 5,
    contentHash: "abc123def456",
    status: "active" as const,
    preview: "This is a test preview",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Disconnected Wallet State", () => {
    it("should disable purchase button when wallet is not connected", () => {
      const onAction = vi.fn();

      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={onAction}
          actionDisabled={true}
        />
      );

      const button = screen.getByRole("button", { name: /purchase/i });
      expect(button).toBeDisabled();
    });

    it("should show appropriate message for disconnected state", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={{ ...mockData, status: "unavailable" }}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText(/currently unavailable/i)).toBeInTheDocument();
    });
  });

  describe("Connected Wallet State", () => {
    it("should enable purchase button when wallet is connected", () => {
      const onAction = vi.fn();

      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={onAction}
          actionDisabled={false}
        />
      );

      const button = screen.getByRole("button", { name: /purchase/i });
      expect(button).not.toBeDisabled();
    });

    it("should call onAction with 'buy' when purchase button is clicked", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();

      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={onAction}
          actionDisabled={false}
        />
      );

      const button = screen.getByRole("button", { name: /purchase/i });
      await user.click(button);

      expect(onAction).toHaveBeenCalledWith("buy");
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("should show unlock button for purchased items", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();

      render(
        <EnhancedDetailView
          type="medication"
          data={{ ...mockData, status: "purchased" }}
          onAction={onAction}
          actionDisabled={false}
        />
      );

      const button = screen.getByRole("button", { name: /unlock/i });
      expect(button).toBeInTheDocument();
      
      await user.click(button);
      expect(onAction).toHaveBeenCalledWith("unlock");
    });
  });

  describe("Disabled/Loading State During Pending Purchase", () => {
    it("should show loading state during purchase", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={vi.fn()}
          actionLoading={true}
        />
      );

      const button = screen.getByRole("button", { name: /processing/i });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Processing...");
    });

    it("should disable button during loading", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={vi.fn()}
          actionLoading={true}
        />
      );

      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });

    it("should not trigger action when clicked during loading", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();

      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={onAction}
          actionLoading={true}
        />
      );

      const button = screen.getByRole("button");
      await user.click(button);

      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe("Error Copy When Wallet Action Fails", () => {
    it("should show unavailable message for inactive items", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={{ ...mockData, status: "inactive" }}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText(/currently unavailable/i)).toBeInTheDocument();
    });

    it("should not show action button for unavailable items", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={{ ...mockData, status: "unavailable" }}
          onAction={vi.fn()}
        />
      );

      const buttons = screen.queryAllByRole("button");
      const purchaseButton = buttons.find((btn) => btn.textContent?.includes("Purchase"));
      expect(purchaseButton).toBeUndefined();
    });

    it("should display price correctly in purchase button", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText(/purchase for 10 usdc/i)).toBeInTheDocument();
    });
  });

  describe("Status Badges", () => {
    it("should show active badge for active items", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={{ ...mockData, status: "active" }}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("should show purchased badge for purchased items", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={{ ...mockData, status: "purchased" }}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText("Purchased")).toBeInTheDocument();
    });

    it("should show unavailable badge for unavailable items", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={{ ...mockData, status: "unavailable" }}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText("Unavailable")).toBeInTheDocument();
    });
  });

  describe("Metadata Display", () => {
    it("should display creator address with copy functionality", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText("Creator")).toBeInTheDocument();
      expect(screen.getByText(mockData.creator)).toBeInTheDocument();
    });

    it("should display price with highlight", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText("Price")).toBeInTheDocument();
      expect(screen.getByText("10 USDC")).toBeInTheDocument();
    });

    it("should display sales count", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText("Sales")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("should display content hash with truncation", () => {
      render(
        <EnhancedDetailView
          type="medication"
          data={mockData}
          onAction={vi.fn()}
        />
      );

      expect(screen.getByText("Content Hash")).toBeInTheDocument();
      expect(screen.getByText(/abc123def456\.\.\./)).toBeInTheDocument();
    });
  });
});
