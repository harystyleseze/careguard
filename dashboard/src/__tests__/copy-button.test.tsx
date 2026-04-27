import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Dashboard from '../app/page';

// Mock the environment and dependencies
vi.mock('../../lib/useProfile', () => ({
  useProfile: () => ({
    recipient: {
      name: 'Rosa Garcia',
      age: 78,
    },
  }),
}));

vi.mock('../app/pdf', () => ({
  downloadBillAuditPDF: vi.fn(),
  downloadMedicationPDF: vi.fn(),
  downloadTransactionPDF: vi.fn(),
}));

vi.mock('../components/primitives/live-region', () => ({
  LiveRegion: ({ message }: { message: string }) => <div>{message}</div>,
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

// Mock fetch
global.fetch = vi.fn();

describe('Per-button Copy State', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should track copy state per button ID', async () => {
    // Mock agent info with wallet
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        service: 'CareGuard AI Agent',
        agentWallet: 'TEST_WALLET_ADDRESS_123456789',
        paused: false,
      }),
    });

    const { container } = render(<Dashboard />);
    
    // Wait for the component to load and find copy buttons
    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    // Get both copy buttons (wallet and settings)
    const copyButtons = screen.getAllByText('Copy');
    expect(copyButtons).toHaveLength(2);

    // Click the first copy button
    fireEvent.click(copyButtons[0]);
    
    // Only the first button should show "Copied"
    await waitFor(() => {
      expect(copyButtons[0]).toHaveTextContent('Copied');
      expect(copyButtons[1]).toHaveTextContent('Copy');
    });

    // Click the second copy button
    fireEvent.click(copyButtons[1]);
    
    // Now the second button should show "Copied" and first should return to "Copy"
    await waitFor(() => {
      expect(copyButtons[0]).toHaveTextContent('Copy');
      expect(copyButtons[1]).toHaveTextContent('Copied');
    });
  });

  it('should reset copy state after 2 seconds', async () => {
    vi.useFakeTimers();
    
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        service: 'CareGuard AI Agent',
        agentWallet: 'TEST_WALLET_ADDRESS_123456789',
        paused: false,
      }),
    });

    const { container } = render(<Dashboard />);
    
    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    const copyButtons = screen.getAllByText('Copy');
    fireEvent.click(copyButtons[0]);

    // Should show "Copied" immediately
    await waitFor(() => {
      expect(copyButtons[0]).toHaveTextContent('Copied');
    });

    // Fast-forward 2 seconds
    vi.advanceTimersByTime(2000);

    // Should return to "Copy"
    await waitFor(() => {
      expect(copyButtons[0]).toHaveTextContent('Copy');
    });

    vi.useRealTimers();
  });

  it('should call clipboard API with correct text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        service: 'CareGuard AI Agent',
        agentWallet: 'TEST_WALLET_ADDRESS_123456789',
        paused: false,
      }),
    });

    const { container } = render(<Dashboard />);
    
    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    const copyButtons = screen.getAllByText('Copy');
    fireEvent.click(copyButtons[0]);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TEST_WALLET_ADDRESS_123456789');
  });
});
