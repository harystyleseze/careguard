"use client";

import { useEffect, useState } from "react";

export type NetworkStatus = "correct" | "mismatch" | "unavailable" | "checking";

export interface WalletNetworkState {
  status: NetworkStatus;
  expectedNetwork: string;
  currentNetwork: string | null;
  errorMessage: string | null;
  recoveryInstructions: string | null;
}

export interface UseWalletNetworkOptions {
  expectedNetwork?: string;
  walletAddress?: string;
  enabled?: boolean;
}

export function useWalletNetwork({
  expectedNetwork = "testnet",
  walletAddress,
  enabled = true,
}: UseWalletNetworkOptions = {}): WalletNetworkState {
  const [state, setState] = useState<WalletNetworkState>({
    status: "checking",
    expectedNetwork,
    currentNetwork: null,
    errorMessage: null,
    recoveryInstructions: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({
        status: "unavailable",
        expectedNetwork,
        currentNetwork: null,
        errorMessage: "Network detection disabled",
        recoveryInstructions: null,
      });
      return;
    }

    async function checkNetwork() {
      try {
        if (!walletAddress) {
          setState({
            status: "unavailable",
            expectedNetwork,
            currentNetwork: null,
            errorMessage: "No wallet connected",
            recoveryInstructions: "Please connect your wallet to continue",
          });
          return;
        }

        // Check if wallet exists on expected network
        const horizonUrl =
          expectedNetwork === "testnet"
            ? "https://horizon-testnet.stellar.org"
            : "https://horizon.stellar.org";

        const response = await fetch(`${horizonUrl}/accounts/${walletAddress}`);

        if (response.ok) {
          setState({
            status: "correct",
            expectedNetwork,
            currentNetwork: expectedNetwork,
            errorMessage: null,
            recoveryInstructions: null,
          });
        } else if (response.status === 404) {
          // Account not found on expected network - might be on wrong network
          setState({
            status: "mismatch",
            expectedNetwork,
            currentNetwork: "unknown",
            errorMessage: `Wallet not found on ${expectedNetwork}`,
            recoveryInstructions: `This app is configured for Stellar ${expectedNetwork}. Please switch your wallet to ${expectedNetwork} or fund your account on ${expectedNetwork}.`,
          });
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.error("Network check error:", error);
        setState({
          status: "unavailable",
          expectedNetwork,
          currentNetwork: null,
          errorMessage: "Unable to verify network",
          recoveryInstructions: "Please check your connection and try again",
        });
      }
    }

    checkNetwork();
    
    // Re-check every 30 seconds
    const interval = setInterval(checkNetwork, 30000);
    return () => clearInterval(interval);
  }, [expectedNetwork, walletAddress, enabled]);

  return state;
}
