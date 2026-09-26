/**
 * Tests for Issue #1257 — loading feedback while switching care recipients
 * via the header and settings dropdowns.
 *
 * Verifies:
 *  1. A spinner is shown and the <select> is disabled while a switch is
 *     in flight (parent has not applied the new selection yet).
 *  2. Rapid re-selection is ignored, preventing overlapping fetches.
 *  3. Once the parent applies the selection, the loading state clears and
 *     the updated recipient name is announced via a status region.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DashboardHeader } from "../components/dashboard-header";
import type { DashboardHeaderProps } from "../components/dashboard-header";
import { SettingsTab } from "../components/tabs/settings-tab";
import type { SettingsTabProps } from "../components/tabs/settings-tab";

const RECIPIENTS = [
  { id: "rosa_garcia", name: "Rosa Garcia" },
  { id: "john_smith", name: "John Smith" },
];

function buildHeaderProps(
  overrides: Partial<DashboardHeaderProps> = {},
): DashboardHeaderProps {
  return {
    recipient: { name: "Rosa Garcia", age: 78 },
    recipientInitials: "RG",
    agentInfo: null,
    agentConnected: true,
    agentPaused: false,
    walletBalance: null,
    onTogglePause: vi.fn(),
    recipients: RECIPIENTS,
    selectedRecipientId: "rosa_garcia",
    onSelectRecipient: vi.fn(),
    ...overrides,
  };
}

function buildSettingsProps(
  overrides: Partial<SettingsTabProps> = {},
): SettingsTabProps {
  return {
    recipient: { name: "Rosa Garcia", age: 78 },
    caregiver: { name: "Maria Garcia" },
    agentInfo: null,
    agentPaused: false,
    onTogglePause: vi.fn(),
    onUpdateProfile: vi.fn().mockResolvedValue(undefined),
    recipients: RECIPIENTS,
    selectedRecipientId: "rosa_garcia",
    onSelectRecipient: vi.fn(),
    ...overrides,
  };
}

describe("DashboardHeader — recipient switch feedback (Issue #1257)", () => {
  it("shows a spinner and disables the select while the switch is in flight", () => {
    render(<DashboardHeader {...buildHeaderProps()} />);
    fireEvent.change(screen.getByLabelText("Care Recipient"), {
      target: { value: "john_smith" },
    });
    expect(screen.getByTestId("recipient-switch-spinner")).toBeTruthy();
    expect(
      (screen.getByLabelText("Care Recipient") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Loading...");
  });

  it("ignores rapid re-selection while a switch is in flight", () => {
    const onSelectRecipient = vi.fn();
    render(
      <DashboardHeader
        {...buildHeaderProps({ onSelectRecipient })}
      />,
    );
    const select = screen.getByLabelText("Care Recipient");
    fireEvent.change(select, { target: { value: "john_smith" } });
    fireEvent.change(select, { target: { value: "rosa_garcia" } });
    expect(onSelectRecipient).toHaveBeenCalledTimes(1);
    expect(onSelectRecipient).toHaveBeenCalledWith("john_smith");
  });

  it("clears the loading state and announces the updated name once applied", () => {
    const { rerender } = render(
      <DashboardHeader {...buildHeaderProps()} />,
    );
    fireEvent.change(screen.getByLabelText("Care Recipient"), {
      target: { value: "john_smith" },
    });
    rerender(
      <DashboardHeader
        {...buildHeaderProps({
          selectedRecipientId: "john_smith",
          recipient: { name: "John Smith", age: 65 },
          recipientInitials: "JS",
        })}
      />,
    );
    expect(screen.queryByTestId("recipient-switch-spinner")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("John Smith");
  });
});

describe("SettingsTab — recipient switch feedback (Issue #1257)", () => {
  it("shows a spinner and disables the select while the switch is in flight", () => {
    render(<SettingsTab {...buildSettingsProps()} />);
    fireEvent.change(screen.getByLabelText("Care Recipient"), {
      target: { value: "john_smith" },
    });
    expect(screen.getByTestId("recipient-switch-spinner")).toBeTruthy();
    expect(
      (screen.getByLabelText("Care Recipient") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Loading...");
  });

  it("ignores rapid re-selection while a switch is in flight", () => {
    const onSelectRecipient = vi.fn();
    render(
      <SettingsTab {...buildSettingsProps({ onSelectRecipient })} />,
    );
    const select = screen.getByLabelText("Care Recipient");
    fireEvent.change(select, { target: { value: "john_smith" } });
    fireEvent.change(select, { target: { value: "rosa_garcia" } });
    expect(onSelectRecipient).toHaveBeenCalledTimes(1);
    expect(onSelectRecipient).toHaveBeenCalledWith("john_smith");
  });

  it("clears the loading state and announces the updated name once applied", () => {
    const { rerender } = render(
      <SettingsTab {...buildSettingsProps()} />,
    );
    fireEvent.change(screen.getByLabelText("Care Recipient"), {
      target: { value: "john_smith" },
    });
    rerender(
      <SettingsTab
        {...buildSettingsProps({
          selectedRecipientId: "john_smith",
          recipient: { name: "John Smith", age: 65 },
        })}
      />,
    );
    expect(screen.queryByTestId("recipient-switch-spinner")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("John Smith");
  });
});
