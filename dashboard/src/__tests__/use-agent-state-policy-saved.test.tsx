/**
 * Issue #1288 — the "Policy Saved" confirmation must read as a momentary
 * acknowledgement rather than a permanent status.
 *
 * PolicyTab fades the button (transition-colors duration-700), but the revert
 * itself is driven here in useAgentState, so these tests pin the timing:
 *   - the confirmation clears itself after 3 s,
 *   - editing any field clears it immediately, without waiting out the timer,
 *   - only one timer is ever outstanding, and it is dropped on unmount.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentState } from '../hooks/use-agent-state';

const POLICY = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

const SPENDING = {
  policy: POLICY,
  spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
  budgetRemaining: { medications: 300, bills: 500 },
  transactionCount: 0,
  recentTransactions: [],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockAgentEndpoints(): void {
  vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/agent/policy')) return json({ ok: true });
    if (url.includes('/agent/spending')) return json(SPENDING);
    if (url.includes('/agent/transactions')) return json({ transactions: [] });
    if (url.includes('/agent/audit')) return json({ data: [] });
    return json({ connected: false });
  });
}

function renderPolicyState() {
  return renderHook(() => useAgentState({ activeTab: 'policy' }));
}

describe('useAgentState — policySaved confirmation timing (Issue #1288)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockAgentEndpoints();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows Policy Saved after a successful update', async () => {
    const { result } = renderPolicyState();

    await act(async () => {
      await result.current.updatePolicy();
    });

    expect(result.current.policySaved).toBe(true);
  });

  it('reverts to the editable state after the confirmation window', async () => {
    const { result } = renderPolicyState();

    await act(async () => {
      await result.current.updatePolicy();
    });
    expect(result.current.policySaved).toBe(true);

    // Still confirmed just before the window closes.
    await act(async () => {
      vi.advanceTimersByTime(2900);
    });
    expect(result.current.policySaved).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.policySaved).toBe(false);
  });

  it('returns to the editable state as soon as a field changes', async () => {
    const { result } = renderPolicyState();

    await act(async () => {
      await result.current.updatePolicy();
    });
    expect(result.current.policySaved).toBe(true);

    act(() => {
      result.current.setPolicyDirty(true);
    });

    expect(result.current.policySaved).toBe(false);
    expect(result.current.policyDirty).toBe(true);
  });

  it('does not re-arm the confirmation after a field change', async () => {
    const { result } = renderPolicyState();

    await act(async () => {
      await result.current.updatePolicy();
    });

    act(() => {
      result.current.setPolicyDirty(true);
    });

    // The stale timer must have been cleared, so nothing flips state later.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.policySaved).toBe(false);
  });

  it('does not accumulate a confirmation timer across repeated saves', async () => {
    const { result } = renderPolicyState();

    await act(async () => {
      await result.current.updatePolicy();
    });
    const afterFirstSave = vi.getTimerCount();

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      await act(async () => {
        await result.current.updatePolicy();
      });
      // Each save supersedes the previous timer instead of stacking on it.
      expect(vi.getTimerCount()).toBe(afterFirstSave);
    }
  });

  it('does not leave a pending confirmation timer after unmount', async () => {
    const { result, unmount } = renderPolicyState();

    await act(async () => {
      await result.current.updatePolicy();
    });
    expect(result.current.policySaved).toBe(true);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves the confirmation off when the update fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/agent/policy')) {
        return new Response('nope', { status: 500 });
      }
      if (url.includes('/agent/spending')) return json(SPENDING);
      if (url.includes('/agent/transactions')) return json({ transactions: [] });
      if (url.includes('/agent/audit')) return json({ data: [] });
      return json({ connected: false });
    });

    const { result } = renderPolicyState();

    await act(async () => {
      await result.current.updatePolicy();
    });

    expect(result.current.policySaved).toBe(false);
  });
});
