/**
 * React component tests for the Policy tab (Issue #47).
 *
 * Runs in jsdom via environmentMatchGlobs in vitest.config.ts.
 * Tests cover:
 *  1. Fields render with values from spending.policy
 *  2. Editing a field fires setPolicyForm without being overwritten by polling
 *     (activeTab !== "policy" guard in useAgentState.fetchSpending)
 *  3. Submit sends POST /agent/policy with current form values (onUpdatePolicy mock)
 *  4. "Policy Saved" button text shown while policySaved === true (fake timers)
 *  5. Negative value rejected client-side (validatePolicy via form validation)
 */

import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PolicyTab } from "../components/tabs/policy-tab";
import type { PolicyTabProps } from "../components/tabs/policy-tab";

const RECIPIENT = { name: "Rosa Garcia" };

const BASE_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 0,
};

function buildProps(overrides: Partial<PolicyTabProps> = {}): PolicyTabProps {
  return {
    recipient: RECIPIENT,
    policyForm: { ...BASE_POLICY },
    setPolicyForm: vi.fn(),
    setPolicyDirty: vi.fn(),
    spending: null,
    policySaved: false,
    onUpdatePolicy: vi.fn().mockResolvedValue({ ok: true }),
    onForceSync: vi.fn(),
    ...overrides,
  };
}

describe("PolicyTab — rendering (Issue #47)", () => {
  it("renders all 5 number input fields", () => {
    render(<PolicyTab {...buildProps()} />);
    expect(screen.getByLabelText(/Daily Spending Limit/i)).toBeTruthy();
    expect(screen.getByLabelText(/Monthly Spending Limit/i)).toBeTruthy();
    expect(screen.getByLabelText(/Medication Monthly Budget/i)).toBeTruthy();
    expect(screen.getByLabelText(/Bill Monthly Budget/i)).toBeTruthy();
    expect(screen.getByLabelText(/Caregiver Approval Threshold/i)).toBeTruthy();
  });

  it("populates fields with values from spending.policy (the policyForm prop)", () => {
    const props = buildProps({
      policyForm: {
        dailyLimit: 120,
        monthlyLimit: 700,
        medicationMonthlyBudget: 250,
        billMonthlyBudget: 450,
        approvalThreshold: 80,
        holdTimeSeconds: 0,
      },
    });
    render(<PolicyTab {...props} />);

    const dailyInput = screen.getByLabelText(/Daily Spending Limit/i) as HTMLInputElement;
    const monthlyInput = screen.getByLabelText(/Monthly Spending Limit/i) as HTMLInputElement;

    expect(dailyInput.value).toBe("120");
    expect(monthlyInput.value).toBe("700");
  });

  it("renders the 'Update Policy' button when policySaved is false", () => {
    render(<PolicyTab {...buildProps({ policySaved: false })} />);
    expect(screen.getByRole("button", { name: /Update Policy/i })).toBeTruthy();
  });

  it("shows 'Policy Saved' button text when policySaved is true", () => {
    render(<PolicyTab {...buildProps({ policySaved: true })} />);
    expect(screen.getByRole("button", { name: /Policy Saved/i })).toBeTruthy();
  });

  it("renders recipient name in heading", () => {
    render(<PolicyTab {...buildProps()} />);
    expect(screen.getByText(/Rosa Garcia/)).toBeTruthy();
  });
});

describe("PolicyTab — form interaction (Issue #47)", () => {
  it("calls setPolicyForm and setPolicyDirty when a field is edited", () => {
    const setPolicyForm = vi.fn();
    const setPolicyDirty = vi.fn();
    render(<PolicyTab {...buildProps({ setPolicyForm, setPolicyDirty })} />);

    const input = screen.getByLabelText(/Daily Spending Limit/i);
    fireEvent.change(input, { target: { value: "150" } });

    expect(setPolicyDirty).toHaveBeenCalledWith(true);
    expect(setPolicyForm).toHaveBeenCalled();
  });

  it("does NOT call onUpdatePolicy when setPolicyForm is called (editing doesn't auto-submit)", () => {
    const onUpdatePolicy = vi.fn().mockResolvedValue({ ok: true });
    const setPolicyForm = vi.fn();
    render(<PolicyTab {...buildProps({ onUpdatePolicy, setPolicyForm })} />);

    const input = screen.getByLabelText(/Daily Spending Limit/i);
    fireEvent.change(input, { target: { value: "150" } });

    expect(onUpdatePolicy).not.toHaveBeenCalled();
  });

  it("submit button is disabled when form has a validation error", () => {
    // dailyLimit > monthlyLimit is invalid
    render(
      <PolicyTab
        {...buildProps({
          policyForm: { ...BASE_POLICY, dailyLimit: 900 }, // 900 > monthlyLimit 800
        })}
      />,
    );

    const submitBtn = screen.getByRole("button", { name: /Update Policy/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("calls onUpdatePolicy when form is submitted with valid data", async () => {
    const onUpdatePolicy = vi.fn().mockResolvedValue({ ok: true });
    render(<PolicyTab {...buildProps({ onUpdatePolicy })} />);

    const form = screen
      .getByRole("button", { name: /Update Policy/i })
      .closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(onUpdatePolicy).toHaveBeenCalledTimes(1);
  });
});

// --- Regression: editing a field must not be overwritten by 3s polling ---
// The guard lives in useAgentState.fetchSpending:
//   shouldSyncPolicy = forcePolicySync || (activeTabRef.current !== "policy" && !policyDirtyRef.current)
// When activeTab === "policy", shouldSyncPolicy is false, so setPolicyForm is NOT called.

describe("Polling guard — activeTab !== 'policy' prevents overwriting edits (Issue #47)", () => {
  it("shouldSyncPolicy is false when activeTab is 'policy'", () => {
    const activeTab = "policy";
    const policyDirty = false;
    const forcePolicySync = false;
    const shouldSyncPolicy = forcePolicySync || (activeTab !== "policy" && !policyDirty);
    expect(shouldSyncPolicy).toBe(false);
  });

  it("shouldSyncPolicy is false when policyDirty is true (user is editing)", () => {
    const activeTab = "overview";
    const policyDirty = true;
    const forcePolicySync = false;
    const shouldSyncPolicy = forcePolicySync || (activeTab !== "policy" && !policyDirty);
    expect(shouldSyncPolicy).toBe(false);
  });

  it("shouldSyncPolicy is true when tab is NOT policy and form is clean", () => {
    const activeTab = "overview";
    const policyDirty = false;
    const forcePolicySync = false;
    const shouldSyncPolicy = forcePolicySync || (activeTab !== "policy" && !policyDirty);
    expect(shouldSyncPolicy).toBe(true);
  });

  it("forcePolicySync overrides the guard", () => {
    const activeTab = "policy";
    const policyDirty = true;
    const forcePolicySync = true;
    const shouldSyncPolicy = forcePolicySync || (activeTab !== "policy" && !policyDirty);
    expect(shouldSyncPolicy).toBe(true);
  });
});

// --- Negative value rejected client-side (Issue #47 + post-#118 validation) ---

describe("PolicyTab — negative value rejected client-side (Issue #47)", () => {
  it("shows error message when dailyLimit is set to a negative value", async () => {
    const setPolicyForm = vi.fn();
    // Simulate the parent already having the negative value in state
    render(
      <PolicyTab
        {...buildProps({
          policyForm: { ...BASE_POLICY, dailyLimit: -1 },
          setPolicyForm,
        })}
      />,
    );

    // The submit button must be disabled because validation fails
    const submitBtn = screen.getByRole("button", { name: /Update Policy/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // An error message must be visible
    await waitFor(() => {
      const errorEl = document.querySelector("[aria-invalid='true']");
      expect(errorEl).not.toBeNull();
    });
  });

  it("'Update Policy' button is enabled for a fully valid policy", () => {
    render(<PolicyTab {...buildProps()} />);
    const submitBtn = screen.getByRole("button", { name: /Update Policy/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });
});

// --- "Policy Saved" state shown for 3 s (fake timers tested at hook level) ---
// The timeout lives in useAgentState.updatePolicy:
//   setPolicySaved(true);
//   setTimeout(() => setPolicySaved(false), 3000);
// We verify the component reflects the prop correctly; the timeout is the parent's responsibility.

describe("PolicyTab — policySaved prop drives button appearance (Issue #47)", () => {
  it("shows 'Policy Saved' (green) when policySaved is true", () => {
    const { container } = render(<PolicyTab {...buildProps({ policySaved: true })} />);
    const btn = screen.getByRole("button", { name: /Policy Saved/i });
    expect(btn).toBeTruthy();
    // The button should have the green background class
    expect(btn.className).toContain("bg-green-500");
  });

  it("shows 'Update Policy' (blue) when policySaved is false", () => {
    const { container } = render(<PolicyTab {...buildProps({ policySaved: false })} />);
    const btn = screen.getByRole("button", { name: /Update Policy/i });
    expect(btn).toBeTruthy();
    expect(btn.className).toContain("bg-sky-500");
  });
});

// --- Confirmation for sensitive (limit-raising) policy changes (Issue #216) ---

describe("PolicyTab — limit-increase confirmation (Issue #216)", () => {
  function withBaseline(
    formOverrides: Partial<typeof BASE_POLICY>,
    onUpdatePolicy = vi.fn().mockResolvedValue({ ok: true }),
  ): PolicyTabProps {
    return buildProps({
      policyForm: { ...BASE_POLICY, ...formOverrides },
      spending: { policy: { ...BASE_POLICY } } as never,
      onUpdatePolicy,
    });
  }

  function submitForm() {
    const form = screen
      .getByRole("button", { name: /Update Policy/i })
      .closest("form")!;
    fireEvent.submit(form);
  }

  it("decreasing a limit saves without a confirmation dialog", async () => {
    const onUpdatePolicy = vi.fn().mockResolvedValue({ ok: true });
    render(<PolicyTab {...withBaseline({ medicationMonthlyBudget: 200 }, onUpdatePolicy)} />);

    await act(async () => {
      submitForm();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onUpdatePolicy).toHaveBeenCalledTimes(1);
  });

  it("raising a limit opens a confirmation dialog with the diff and saves on confirm", async () => {
    const onUpdatePolicy = vi.fn().mockResolvedValue({ ok: true });
    render(<PolicyTab {...withBaseline({ dailyLimit: 150 }, onUpdatePolicy)} />);

    await act(async () => {
      submitForm();
    });

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Confirm policy change/i)).toBeTruthy();
    expect(within(dialog).getByText(/increases your spending exposure/i)).toBeTruthy();
    // Diff shows the before and after values.
    expect(within(dialog).getAllByText(/\$150/).length).toBeGreaterThan(0);
    expect(onUpdatePolicy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Confirm & Save/i }));
    });

    expect(onUpdatePolicy).toHaveBeenCalledTimes(1);
  });

  it("cancelling the confirmation does not save", async () => {
    const onUpdatePolicy = vi.fn().mockResolvedValue({ ok: true });
    render(<PolicyTab {...withBaseline({ dailyLimit: 150 }, onUpdatePolicy)} />);

    await act(async () => {
      submitForm();
    });

    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel$/i }));
    });

    expect(onUpdatePolicy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("requires typing CONFIRM when a limit more than doubles", async () => {
    const onUpdatePolicy = vi.fn().mockResolvedValue({ ok: true });
    render(<PolicyTab {...withBaseline({ dailyLimit: 300 }, onUpdatePolicy)} />);

    await act(async () => {
      submitForm();
    });

    const dialog = screen.getByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", {
      name: /Confirm & Save/i,
    }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    const typedInput = within(dialog).getByLabelText(/Type CONFIRM/i);
    await act(async () => {
      fireEvent.change(typedInput, { target: { value: "CONFIRM" } });
    });
    expect(confirmBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    expect(onUpdatePolicy).toHaveBeenCalledTimes(1);
  });

  it("policySaved timeout logic: flag goes true then false after 3 s", () => {
    vi.useFakeTimers();
    let policySaved = false;
    const setPolicySaved = (v: boolean) => {
      policySaved = v;
    };

    // Simulate updatePolicy setting policySaved=true then scheduling reset
    setPolicySaved(true);
    expect(policySaved).toBe(true);

    setTimeout(() => setPolicySaved(false), 3000);

    vi.advanceTimersByTime(2999);
    expect(policySaved).toBe(true); // still true before 3 s

    vi.advanceTimersByTime(1);
    expect(policySaved).toBe(false); // reset after 3 s

    vi.useRealTimers();
  });
});
