/**
 * React tests for WalletTab (Issue #49).
 * Runs in jsdom via environmentMatchGlobs in vitest.config.ts.
 * Balances arrive as props from useAgentState — tested here via direct prop injection.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WalletTab } from "../components/tabs/wallet-tab";
import type { WalletTabProps } from "../components/tabs/wallet-tab";

const WALLET_ADDRESS = "GDTEST123WALLETADDRESS456ABCDEF";

function buildProps(overrides: Partial<WalletTabProps> = {}): WalletTabProps {
  return {
    agentInfo: {
      agentWallet: WALLET_ADDRESS,
      llm: "groq/llama-3.3",
      network: "stellar:testnet",
    } as any,
    walletBalance: "42.50",
    walletXlm: "10.20",
    ...overrides,
  };
}

describe("WalletTab — balance display (Issue #49)", () => {
  it("renders USDC balance at 2-decimal precision", () => {
    render(<WalletTab {...buildProps({ walletBalance: "42.50" })} />);
    expect(screen.getByText("$42.50")).toBeTruthy();
  });

  it("renders XLM balance at 2-decimal precision", () => {
    render(<WalletTab {...buildProps({ walletXlm: "10.20" })} />);
    expect(screen.getByText("10.20")).toBeTruthy();
  });

  it("missing USDC trustline (walletBalance=null) shows $0.00", () => {
    render(<WalletTab {...buildProps({ walletBalance: null })} />);
    expect(screen.getByText("$0.00")).toBeTruthy();
  });

  it("missing XLM (walletXlm=null) shows 0.00", () => {
    render(<WalletTab {...buildProps({ walletXlm: null })} />);
    // The XLM div shows just the value without $ prefix
    expect(screen.getByText("0.00")).toBeTruthy();
  });

  it("walletBalance='0' renders as '$0' — nullish coalescing does not replace real zero", () => {
    render(<WalletTab {...buildProps({ walletBalance: "0" })} />);
    // With ?? the real value "0" is preserved; || would silently replace it with "0.00"
    expect(screen.getByText("$0")).toBeTruthy();
  });

  it("Horizon error (both null) shows $0.00 placeholder for USDC", () => {
    render(<WalletTab {...buildProps({ walletBalance: null, walletXlm: null })} />);
    expect(screen.getByText("$0.00")).toBeTruthy();
  });
});

describe("WalletTab — wallet address display (Issue #49)", () => {
  it("renders wallet address", () => {
    render(<WalletTab {...buildProps()} />);
    expect(screen.getByText(WALLET_ADDRESS)).toBeTruthy();
  });

  it("shows 'Not connected' when agentInfo is null", () => {
    render(<WalletTab {...buildProps({ agentInfo: null })} />);
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
  });
});

// Mock copyText so we don't depend on jsdom's clipboard/isSecureContext quirks.
// The copyText implementation is tested separately in clipboard.test.ts.
const { copyTextMock } = vi.hoisted(() => ({
  copyTextMock: vi.fn().mockResolvedValue("ok" as const),
}));
vi.mock("../lib/clipboard", () => ({
  copyText: copyTextMock,
}));

describe("WalletTab — copy button (Issue #49)", () => {
  beforeEach(() => {
    copyTextMock.mockClear();
    copyTextMock.mockResolvedValue("ok");
  });

  it("Copy button writes wallet address to clipboard (mocked)", async () => {
    const user = userEvent.setup();
    render(<WalletTab {...buildProps()} />);
    await user.click(screen.getByRole("button", { name: /Copy/i }));
    expect(copyTextMock).toHaveBeenCalledWith(WALLET_ADDRESS);
  });

  it("Copy button shows 'Copied' text after click", async () => {
    const user = userEvent.setup();
    render(<WalletTab {...buildProps()} />);
    await user.click(screen.getByRole("button", { name: /Copy/i }));
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeTruthy();
    });
  });
});

describe("WalletTab — Stellar Explorer link (Issue #49)", () => {
  it("View on Stellar Explorer link points at correct URL", () => {
    render(<WalletTab {...buildProps()} />);
    const link = screen.getByRole("link", { name: /View on Stellar Explorer/i }) as HTMLAnchorElement;
    expect(link.href).toBe(
      `https://stellar.expert/explorer/testnet/account/${WALLET_ADDRESS}`,
    );
  });

  it("Explorer link is not rendered when agentInfo is null", () => {
    render(<WalletTab {...buildProps({ agentInfo: null })} />);
    expect(screen.queryByRole("link", { name: /View on Stellar Explorer/i })).toBeNull();
  });

  it("Explorer link opens in new tab", () => {
    render(<WalletTab {...buildProps()} />);
    const link = screen.getByRole("link", { name: /View on Stellar Explorer/i }) as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });
});
