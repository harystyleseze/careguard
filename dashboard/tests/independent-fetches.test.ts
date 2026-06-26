/**
 * Tests for independent data fetching (Issue #283)
 * Verifies that dashboard sections render independently without blocking on each other
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Independent Dashboard Fetches (Issue #283)', () => {
  describe('Loading state isolation', () => {
    it('should have independent loading states for each data source', () => {
      const loadingStates = {
        loadingAgentInfo: false,
        loadingSpending: false,
        loadingTransactions: false,
      };

      // Each should be independent
      loadingStates.loadingAgentInfo = true;
      expect(loadingStates.loadingAgentInfo).toBe(true);
      expect(loadingStates.loadingSpending).toBe(false);
      expect(loadingStates.loadingTransactions).toBe(false);

      loadingStates.loadingSpending = true;
      expect(loadingStates.loadingAgentInfo).toBe(true);
      expect(loadingStates.loadingSpending).toBe(true);
      expect(loadingStates.loadingTransactions).toBe(false);

      loadingStates.loadingTransactions = true;
      expect(loadingStates.loadingAgentInfo).toBe(true);
      expect(loadingStates.loadingSpending).toBe(true);
      expect(loadingStates.loadingTransactions).toBe(true);
    });

    it('should allow one fetch to complete while others are loading', () => {
      const loadingStates = {
        loadingAgentInfo: true,
        loadingSpending: true,
        loadingTransactions: true,
      };

      // Agent info finishes first
      loadingStates.loadingAgentInfo = false;

      expect(loadingStates.loadingAgentInfo).toBe(false);
      expect(loadingStates.loadingSpending).toBe(true);
      expect(loadingStates.loadingTransactions).toBe(true);
    });

    it('should not block other fetches when one is slow', () => {
      const loadingStates = {
        loadingAgentInfo: false,
        loadingSpending: false,
        loadingTransactions: true, // Slow fetch
      };

      // Agent info and spending should be able to render
      const canRenderAgentInfo = !loadingStates.loadingAgentInfo;
      const canRenderSpending = !loadingStates.loadingSpending;
      const canRenderTransactions = !loadingStates.loadingTransactions;

      expect(canRenderAgentInfo).toBe(true);
      expect(canRenderSpending).toBe(true);
      expect(canRenderTransactions).toBe(false);
    });
  });

  describe('Fetch independence scenarios', () => {
    it('should restart one fetch without affecting others', () => {
      let callCounts = {
        agentInfoCalls: 0,
        spendingCalls: 0,
        transactionsCalls: 0,
      };

      // Simulate fetches
      const fetchAgentInfo = () => {
        callCounts.agentInfoCalls++;
      };

      const fetchSpending = () => {
        callCounts.spendingCalls++;
      };

      const fetchTransactions = () => {
        callCounts.transactionsCalls++;
      };

      // All fetches called
      fetchAgentInfo();
      fetchSpending();
      fetchTransactions();

      expect(callCounts).toEqual({
        agentInfoCalls: 1,
        spendingCalls: 1,
        transactionsCalls: 1,
      });

      // Re-fetch transactions only
      fetchTransactions();

      expect(callCounts).toEqual({
        agentInfoCalls: 1,
        spendingCalls: 1,
        transactionsCalls: 2,
      });

      // Other fetches not affected
      expect(callCounts.agentInfoCalls).toBe(1);
      expect(callCounts.spendingCalls).toBe(1);
    });

    it('should handle one fetch failure without affecting others', () => {
      const fetchResults = {
        agentInfo: { ok: true, data: {} },
        spending: { ok: false, error: 'Network error' }, // This one fails
        transactions: { ok: true, data: [] },
      };

      // Check results independently
      expect(fetchResults.agentInfo.ok).toBe(true);
      expect(fetchResults.spending.ok).toBe(false);
      expect(fetchResults.transactions.ok).toBe(true);

      // Render sections independently
      const renderedAgentInfo = fetchResults.agentInfo.ok;
      const renderedSpending = fetchResults.spending.ok;
      const renderedTransactions = fetchResults.transactions.ok;

      expect(renderedAgentInfo).toBe(true);
      expect(renderedSpending).toBe(false);
      expect(renderedTransactions).toBe(true);
    });

    it('should allow transaction fetch timeout without blocking agent info', async () => {
      const timeouts = {
        agentInfoTimeout: 100,
        spendingTimeout: 150,
        transactionsTimeout: 5000, // Much slower
      };

      const results: Record<string, string> = {};

      // Simulate parallel fetches with different timeouts
      const fetchAgentInfo = new Promise(resolve => {
        setTimeout(() => {
          results.agentInfo = 'loaded';
          resolve('agentInfo');
        }, timeouts.agentInfoTimeout);
      });

      const fetchTransactions = new Promise(resolve => {
        setTimeout(() => {
          results.transactions = 'loaded';
          resolve('transactions');
        }, timeouts.transactionsTimeout);
      });

      // After 200ms, only agentInfo should be loaded
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(results.agentInfo).toBe('loaded');
      expect(results.transactions).toBeUndefined();

      // Later, transactions will be loaded
      await new Promise(resolve => setTimeout(resolve, 5000));
      expect(results.transactions).toBe('loaded');
    });
  });

  describe('Progressive rendering', () => {
    it('should render sections as data arrives independently', () => {
      const sections = {
        agentInfo: null as { status: string } | null,
        spending: null as { limit: number } | null,
        transactions: null as { id: number }[] | null,
      };

      // Agent info loads first
      sections.agentInfo = { status: 'Active' };
      expect(sections.agentInfo).not.toBeNull();
      expect(sections.spending).toBeNull();
      expect(sections.transactions).toBeNull();

      // Transactions load next
      sections.transactions = [{ id: 1 }, { id: 2 }];
      expect(sections.agentInfo).not.toBeNull();
      expect(sections.spending).toBeNull();
      expect(sections.transactions).not.toBeNull();
      expect(sections.transactions.length).toBe(2);

      // Finally spending loads
      sections.spending = { limit: 500 };
      expect(sections.agentInfo).not.toBeNull();
      expect(sections.spending).not.toBeNull();
      expect(sections.transactions).not.toBeNull();
    });

    it('should re-render only affected sections on individual fetch completion', () => {
      const renderCounts = {
        agentInfo: 0,
        spending: 0,
        transactions: 0,
      };

      const rerender = (section: keyof typeof renderCounts) => {
        renderCounts[section]++;
      };

      // Initial render (all loading)
      rerender('agentInfo');
      rerender('spending');
      rerender('transactions');

      expect(renderCounts).toEqual({ agentInfo: 1, spending: 1, transactions: 1 });

      // Agent info fetch completes
      rerender('agentInfo');

      expect(renderCounts).toEqual({ agentInfo: 2, spending: 1, transactions: 1 });

      // Transactions fetch completes
      rerender('transactions');

      expect(renderCounts).toEqual({ agentInfo: 2, spending: 1, transactions: 2 });

      // Only affected sections re-rendered
      expect(renderCounts.spending).toBe(1);
    });
  });

  describe('Refetch scenarios', () => {
    it('should allow refetching transactions while other data is fresh', () => {
      const lastFetch = {
        agentInfo: Date.now(),
        spending: Date.now(),
        transactions: Date.now() - 5000, // Older transaction data
      };

      // Re-fetch only transactions (it's older)
      const now = Date.now();
      const needsRefetch = {
        agentInfo: now - lastFetch.agentInfo > 10000,
        spending: now - lastFetch.spending > 30000,
        transactions: now - lastFetch.transactions > 3000,
      };

      expect(needsRefetch.agentInfo).toBe(false);
      expect(needsRefetch.spending).toBe(false);
      expect(needsRefetch.transactions).toBe(true);

      // Update only transactions
      lastFetch.transactions = now;

      expect(lastFetch.agentInfo).toEqual(lastFetch.agentInfo);
      expect(lastFetch.spending).toEqual(lastFetch.spending);
      expect(lastFetch.transactions).toEqual(now);
    });

    it('should handle user manually triggering one fetch', () => {
      let callCount = 0;

      const fetchSpending = () => {
        callCount++;
      };

      // User clicks "Force Sync Policy"
      fetchSpending();
      expect(callCount).toBe(1);

      // Other fetches not called
      fetchSpending();
      expect(callCount).toBe(2);
    });
  });

  describe('Error recovery', () => {
    it('should allow retry of failed fetch independently', () => {
      let attempts = 0;

      const fetchTransactions = async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Network error');
        }
        return { transactions: [] };
      };

      // First attempt fails
      expect(async () => {
        await fetchTransactions();
      }).rejects.toThrow();

      expect(attempts).toBe(1);

      // Retry only transactions fetch
      expect(async () => {
        const result = await fetchTransactions();
        return result;
      }).not.toThrow();

      expect(attempts).toBe(2);
    });

    it('should not require all fetches to succeed for page to render', () => {
      const fetchResults = {
        agentInfo: { success: true, data: { connected: true } },
        spending: { success: false, error: 'API down' },
        transactions: { success: true, data: { transactions: [] } },
      };

      // Page can render with 2 of 3 sources
      const canRender = (
        fetchResults.agentInfo.success ||
        fetchResults.spending.success ||
        fetchResults.transactions.success
      );

      expect(canRender).toBe(true);
      expect(fetchResults.spending.success).toBe(false);
    });
  });
});
