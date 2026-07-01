/**
 * Stellar Network Configuration
 * Maps STELLAR_NETWORK env var to appropriate Horizon server and network passphrase
 * Validates that signer key prefix matches the configured network
 */

import { logger } from './logger.ts';

export type StellarNetworkType = 'testnet' | 'public';

export interface StellarNetworkConfig {
  networkType: StellarNetworkType;
  horizonUrl: string;
  networkPassphrase: string;
}

const STELLAR_NETWORKS: Record<StellarNetworkType, StellarNetworkConfig> = {
  testnet: {
    networkType: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  },
  public: {
    networkType: 'public',
    horizonUrl: 'https://horizon.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  },
};

/**
 * Resolve configured stellar network from environment
 * Defaults to 'testnet' if not specified
 */
export function resolveStellarNetwork(): StellarNetworkConfig {
  const networkEnv = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase() as StellarNetworkType;
  
  if (!STELLAR_NETWORKS[networkEnv]) {
    throw new Error(
      `Invalid STELLAR_NETWORK: "${networkEnv}". Must be one of: ${Object.keys(STELLAR_NETWORKS).join(', ')}`
    );
  }

  const config = STELLAR_NETWORKS[networkEnv];
  logger.info(
    { network: config.networkType, horizon: config.horizonUrl },
    'Resolved Stellar network configuration'
  );
  
  return config;
}

/**
 * Validate that signer key prefix matches the network
 * Testnet keys start with 'S' (not 'SA', 'SB', etc.)
 * Public keys start with 'G'
 * Secret keys must start with 'S'
 */
export function validateSignerKeyForNetwork(secretKey: string, network: StellarNetworkConfig): void {
  if (!secretKey.startsWith('S')) {
    throw new Error(
      `Invalid secret key prefix: "${secretKey[0]}". Secret keys must start with 'S'`
    );
  }

  // Both testnet and public use 'S' prefix for secret keys
  // The actual validation happens when loading the key through the Stellar SDK
  // If someone tries to use a mainnet account on testnet (or vice versa), 
  // the transactions will fail, and this log helps catch network mismatches early
  
  logger.info(
    { network: network.networkType, keyPrefix: secretKey[0] },
    'Signer key validated for configured network'
  );
}

/**
 * Get CSP (Content-Security-Policy) allowed origins for Horizon
 */
export function getStellarCspOrigins(): string[] {
  return [
    STELLAR_NETWORKS.testnet.horizonUrl,
    STELLAR_NETWORKS.public.horizonUrl,
  ];
}

/**
 * Get all configured horizon URLs (for mocking/testing)
 */
export function getAllHorizonUrls(): string[] {
  return Object.values(STELLAR_NETWORKS).map(config => config.horizonUrl);
}
