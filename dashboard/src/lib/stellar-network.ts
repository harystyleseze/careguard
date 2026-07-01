/**
 * Stellar Network Configuration
 * 
 * Derives explorer URLs and network labels from NEXT_PUBLIC_STELLAR_NETWORK environment variable.
 * Supports "testnet" and "public" (mainnet) networks.
 */

const STELLAR_NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet') as 'testnet' | 'public';

if (!['testnet', 'public'].includes(STELLAR_NETWORK)) {
  console.warn(`[stellar-network] Invalid NEXT_PUBLIC_STELLAR_NETWORK: "${STELLAR_NETWORK}". Defaulting to "testnet".`);
}

export const NETWORK_LABEL = STELLAR_NETWORK === 'public' ? 'Stellar Mainnet' : 'Stellar Testnet';

export const EXPLORER_TX_URL = STELLAR_NETWORK === 'public' 
  ? 'https://stellar.expert/explorer/public/tx'
  : 'https://stellar.expert/explorer/testnet/tx';

export const EXPLORER_ACCOUNT_URL = STELLAR_NETWORK === 'public'
  ? 'https://stellar.expert/explorer/public/account'
  : 'https://stellar.expert/explorer/testnet/account';
