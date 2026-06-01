"use client";

import { useWalletNetwork, type UseWalletNetworkOptions } from "../hooks/use-wallet-network";

export interface WalletNetworkBannerProps extends UseWalletNetworkOptions {
  onDismiss?: () => void;
}

export function WalletNetworkBanner({
  expectedNetwork,
  walletAddress,
  enabled,
  onDismiss,
}: WalletNetworkBannerProps) {
  const networkState = useWalletNetwork({ expectedNetwork, walletAddress, enabled });

  if (networkState.status === "correct" || networkState.status === "checking") {
    return null;
  }

  const getBannerStyle = () => {
    switch (networkState.status) {
      case "mismatch":
        return "bg-red-50 border-red-200 text-red-900";
      case "unavailable":
        return "bg-yellow-50 border-yellow-200 text-yellow-900";
      default:
        return "bg-gray-50 border-gray-200 text-gray-900";
    }
  };

  const getIcon = () => {
    switch (networkState.status) {
      case "mismatch":
        return (
          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case "unavailable":
        return (
          <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`border-b ${getBannerStyle()}`}>
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-1">
              {networkState.status === "mismatch" ? "Network Mismatch Detected" : "Network Unavailable"}
            </h3>
            {networkState.errorMessage && (
              <p className="text-sm mb-2">{networkState.errorMessage}</p>
            )}
            {networkState.recoveryInstructions && (
              <div className="text-sm bg-white bg-opacity-50 rounded p-3 mt-2">
                <p className="font-medium mb-1">How to fix:</p>
                <p>{networkState.recoveryInstructions}</p>
              </div>
            )}
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="flex-shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
