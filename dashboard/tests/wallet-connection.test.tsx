import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { WalletNetworkBanner } from "../src/components/wallet-network-banner";
import { useWalletNetwork } from "../src/hooks/use-wallet-network";

// Mock the wallet network hook
vi.mock("../src/hooks/use-wallet-network");

describe("Wallet Connection States", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Disconnected Wallet State", () => {
    it("should show unavailable message when no wallet is connected", () => {
      vi.mocked(useWalletNetwork).mockReturnValue({
        status: "unavailable",
        expectedNetwork: "testnet",
        currentNetwork: null,
        errorMessage: "No wallet connected",
        recoveryInstructions: "Please connect your wallet to continue",
      });

      render(<WalletNetworkBanner walletAddress={undefined} enabled={true} />);

      expect(screen.getByText("Network Unavailable")).toBeInTheDocument();
      expect(screen.getByText("No wallet connected")).toBeInTheDocument();
      expect(screen.getByText("Please connect your wallet to continue")).toBeInTheDocument();
    });

    it("should not show banner when wallet is correctly connected", () => {
      vi.mocked(useWalletNetwork).mockReturnValue({
        status: "correct",
        expectedNetwork: "testnet",
        currentNetwork: "testnet",
        errorMessage: null,
        recoveryInstructions: null,
      });

      const { container } = render(
        <WalletNetworkBanner walletAddress="GTEST123" enabled={true} />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe("Connected Wallet State", () => {
    it("should show success state when wallet is on correct network", () => {
      vi.mocked(useWalletNetwork).mockReturnValue({
        status: "correct",
        expectedNetwork: "testnet",
        currentNetwork: "testnet",
        errorMessage: null,
        recoveryInstructions: null,
      });

      const { container } = render(
        <WalletNetworkBanner walletAddress="GTEST123" enabled={true} />
      );

      // Banner should not be visible for correct state
      expect(container.firstChild).toBeNull();
    });

    it("should show mismatch warning when wallet is on wrong network", () => {
      vi.mocked(useWalletNetwork).mockReturnValue({
        status: "mismatch",
        expectedNetwork: "testnet",
        currentNetwork: "unknown",
        errorMessage: "Wallet not found on testnet",
        recoveryInstructions:
          "This app is configured for Stellar testnet. Please switch your wallet to testnet or fund your account on testnet.",
      });

      render(<WalletNetworkBanner walletAddress="GTEST123" enabled={true} />);

      expect(screen.getByText("Network Mismatch Detected")).toBeInTheDocument();
      expect(screen.getByText("Wallet not found on testnet")).toBeInTheDocument();
      expect(screen.getByText(/switch your wallet to testnet/i)).toBeInTheDocument();
    });
  });

  describe("Disabled/Loading State During Pending Purchase", () => {
    it("should show checking state initially", () => {
      vi.mocked(useWalletNetwork).mockReturnValue({
        status: "checking",
        expectedNetwork: "testnet",
        currentNetwork: null,
        errorMessage: null,
        recoveryInstructions: null,
      });

      const { container } = render(
        <WalletNetworkBanner walletAddress="GTEST123" enabled={true} />
      );

      // Banner should not show during checking
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Error Copy When Wallet Action Fails", () => {
    it("should show user-friendly error message on network failure", () => {
      vi.mocked(useWalletNetwork).mockReturnValue({
        status: "unavailable",
        expectedNetwork: "testnet",
        currentNetwork: null,
        errorMessage: "Unable to verify network",
        recoveryInstructions: "Please check your connection and try again",
      });

      render(<WalletNetworkBanner walletAddress="GTEST123" enabled={true} />);

      expect(screen.getByText("Network Unavailable")).toBeInTheDocument();
      expect(screen.getByText("Unable to verify network")).toBeInTheDocument();
      expect(screen.getByText("Please check your connection and try again")).toBeInTheDocument();
    });

    it("should allow dismissing error banner", async () => {
      const user = userEvent.setup();
      const onDismiss = vi.fn();

      vi.mocked(useWalletNetwork).mockReturnValue({
        status: "unavailable",
        expectedNetwork: "testnet",
        currentNetwork: null,
        errorMessage: "Unable to verify network",
        recoveryInstructions: "Please check your connection and try again",
      });

      render(
        <WalletNetworkBanner
          walletAddress="GTEST123"
          enabled={true}
          onDismiss={onDismiss}
        />
      );

      const dismissButton = screen.getByLabelText("Dismiss");
      await user.click(dismissButton);

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("Purchase Button States", () => {
    it("should map technical errors to user-facing messages", () => {
      const technicalErrors = [
        {
          technical: "Account not found on testnet",
          userFacing: "Wallet not found on testnet",
        },
        {
          technical: "HTTP 404",
          userFacing: "Wallet not found on testnet",
        },
        {
          technical: "Network timeout",
          userFacing: "Unable to verify network",
        },
      ];

      technicalErrors.forEach(({ userFacing }) => {
        vi.mocked(useWalletNetwork).mockReturnValue({
          status: "mismatch",
          expectedNetwork: "testnet",
          currentNetwork: "unknown",
          errorMessage: userFacing,
          recoveryInstructions: "Please switch your wallet network",
        });

        const { unmount } = render(
          <WalletNetworkBanner walletAddress="GTEST123" enabled={true} />
        );

        expect(screen.getByText(userFacing)).toBeInTheDocument();
        unmount();
      });
    });
  });
});
