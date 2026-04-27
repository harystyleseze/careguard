import { render, screen, fireEvent } from '@testing-library/react';
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

// Mock fetch
global.fetch = vi.fn();

describe('ARIA Tab Semantics and Keyboard Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have proper ARIA attributes on tablist', () => {
    const { container } = render(<Dashboard />);
    
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toBeInTheDocument();
    expect(tablist).toHaveAttribute('aria-label', 'Dashboard tabs');
  });

  it('should have proper ARIA attributes on tabs', () => {
    const { container } = render(<Dashboard />);
    
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(7); // overview, medications, bills, policy, wallet, activity, settings
    
    // Check first tab (overview)
    const firstTab = tabs[0];
    expect(firstTab).toHaveAttribute('id', 'tab-overview');
    expect(firstTab).toHaveAttribute('aria-controls', 'tabpanel-overview');
    expect(firstTab).toHaveAttribute('aria-selected', 'true');
    expect(firstTab).toHaveAttribute('tabIndex', '0');
    
    // Check other tabs
    for (let i = 1; i < tabs.length; i++) {
      expect(tabs[i]).toHaveAttribute('aria-selected', 'false');
      expect(tabs[i]).toHaveAttribute('tabIndex', '-1');
    }
  });

  it('should have proper ARIA attributes on tabpanels', () => {
    const { container } = render(<Dashboard />);
    
    const tabpanels = container.querySelectorAll('[role="tabpanel"]');
    expect(tabpanels).toHaveLength(7);
    
    // Check active tabpanel
    const activeTabpanel = container.querySelector('#tabpanel-overview');
    expect(activeTabpanel).toBeInTheDocument();
    expect(activeTabpanel).toHaveAttribute('aria-labelledby', 'tab-overview');
    expect(activeTabpanel).toHaveAttribute('tabIndex', '0');
  });

  it('should handle arrow key navigation', () => {
    const { container } = render(<Dashboard />);
    
    const tablist = container.querySelector('[role="tablist"]');
    const tabs = container.querySelectorAll('[role="tab"]');
    
    // Focus on first tab
    fireEvent.focus(tabs[0]);
    
    // Arrow right should move to next tab
    fireEvent.keyDown(tablist!, { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    
    // Arrow left should move to previous tab
    fireEvent.keyDown(tablist!, { key: 'ArrowLeft' });
    expect(tabs[0]).toHaveFocus();
  });

  it('should handle Home and End keys', () => {
    const { container } = render(<Dashboard />);
    
    const tablist = container.querySelector('[role="tablist"]');
    const tabs = container.querySelectorAll('[role="tab"]');
    
    // Focus on middle tab
    fireEvent.focus(tabs[3]);
    
    // Home should move to first tab
    fireEvent.keyDown(tablist!, { key: 'Home' });
    expect(tabs[0]).toHaveFocus();
    
    // Focus on middle tab again
    fireEvent.focus(tabs[3]);
    
    // End should move to last tab
    fireEvent.keyDown(tablist!, { key: 'End' });
    expect(tabs[6]).toHaveFocus();
  });

  it('should handle Enter and Space keys', () => {
    const { container } = render(<Dashboard />);
    
    const tablist = container.querySelector('[role="tablist"]');
    const tabs = container.querySelectorAll('[role="tab"]');
    
    // Focus on second tab
    fireEvent.focus(tabs[1]);
    
    // Mock window.location.href
    const originalHref = window.location.href;
    delete (window as any).location;
    (window as any).location = { href: '' };
    
    // Press Enter should navigate
    fireEvent.keyDown(tablist!, { key: 'Enter' });
    
    // Restore original location
    (window as any).location = { href: originalHref };
  });

  it('should have focus visible styles', () => {
    const { container } = render(<Dashboard />);
    
    const tabs = container.querySelectorAll('[role="tab"]');
    tabs.forEach(tab => {
      expect(tab).toHaveClass('focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-sky-500');
    });
  });
});
