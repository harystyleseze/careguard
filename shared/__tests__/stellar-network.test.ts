/**
 * Tests for stellar network configuration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveStellarNetwork,
  validateSignerKeyForNetwork,
  getStellarCspOrigins,
  getAllHorizonUrls,
  type StellarNetworkType,
} from '../stellar-network';

describe('Stellar Network Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear the env to reset for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveStellarNetwork', () => {
    it('should resolve testnet when STELLAR_NETWORK=testnet', () => {
      process.env.STELLAR_NETWORK = 'testnet';
      const config = resolveStellarNetwork();

      expect(config.networkType).toBe('testnet');
      expect(config.horizonUrl).toBe('https://horizon-testnet.stellar.org');
      expect(config.networkPassphrase).toBe('Test SDF Network ; September 2015');
    });

    it('should resolve mainnet when STELLAR_NETWORK=public', () => {
      process.env.STELLAR_NETWORK = 'public';
      const config = resolveStellarNetwork();

      expect(config.networkType).toBe('public');
      expect(config.horizonUrl).toBe('https://horizon.stellar.org');
      expect(config.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
    });

    it('should default to testnet when STELLAR_NETWORK is not set', () => {
      delete process.env.STELLAR_NETWORK;
      const config = resolveStellarNetwork();

      expect(config.networkType).toBe('testnet');
      expect(config.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    });

    it('should default to testnet when STELLAR_NETWORK is empty', () => {
      process.env.STELLAR_NETWORK = '';
      const config = resolveStellarNetwork();

      expect(config.networkType).toBe('testnet');
    });

    it('should be case-insensitive when resolving network type', () => {
      process.env.STELLAR_NETWORK = 'TESTNET';
      const config = resolveStellarNetwork();

      expect(config.networkType).toBe('testnet');
    });

    it('should be case-insensitive for public network', () => {
      process.env.STELLAR_NETWORK = 'PUBLIC';
      const config = resolveStellarNetwork();

      expect(config.networkType).toBe('public');
    });

    it('should throw error for invalid STELLAR_NETWORK value', () => {
      process.env.STELLAR_NETWORK = 'invalid-network';

      expect(() => {
        resolveStellarNetwork();
      }).toThrow(/Invalid STELLAR_NETWORK/);
    });

    it('should throw error if network is neither testnet nor public', () => {
      process.env.STELLAR_NETWORK = 'staging';

      expect(() => {
        resolveStellarNetwork();
      }).toThrow(/Must be one of: testnet, public/);
    });
  });

  describe('validateSignerKeyForNetwork', () => {
    it('should validate testnet signer key with S prefix', () => {
      process.env.STELLAR_NETWORK = 'testnet';
      const config = resolveStellarNetwork();
      const validTestnetKey = 'SBZVMB74Z76QZ3ZZW2JXWLRVDVUUTWB4OJ5BNQSQVZYCWPVXFZ5GMQKJ';

      expect(() => {
        validateSignerKeyForNetwork(validTestnetKey, config);
      }).not.toThrow();
    });

    it('should validate public network signer key with S prefix', () => {
      process.env.STELLAR_NETWORK = 'public';
      const config = resolveStellarNetwork();
      const validPublicKey = 'SBZVMB74Z76QZ3ZZW2JXWLRVDVUUTWB4OJ5BNQSQVZYCWPVXFZ5GMQKJ';

      expect(() => {
        validateSignerKeyForNetwork(validPublicKey, config);
      }).not.toThrow();
    });

    it('should reject key that does not start with S', () => {
      process.env.STELLAR_NETWORK = 'testnet';
      const config = resolveStellarNetwork();
      const invalidKey = 'GBZVMB74Z76QZ3ZZW2JXWLRVDVUUTWB4OJ5BNQSQVZYCWPVXFZ5GMQKJ'; // G prefix (public key)

      expect(() => {
        validateSignerKeyForNetwork(invalidKey, config);
      }).toThrow(/Invalid secret key prefix: "G". Secret keys must start with 'S'/);
    });

    it('should reject short invalid key prefixes', () => {
      process.env.STELLAR_NETWORK = 'testnet';
      const config = resolveStellarNetwork();

      expect(() => {
        validateSignerKeyForNetwork('ABCD', config);
      }).toThrow(/Invalid secret key prefix: "A". Secret keys must start with 'S'/);
    });
  });

  describe('getStellarCspOrigins', () => {
    it('should return CSP origins for both testnet and public', () => {
      const origins = getStellarCspOrigins();

      expect(origins).toContain('https://horizon-testnet.stellar.org');
      expect(origins).toContain('https://horizon.stellar.org');
      expect(origins).toHaveLength(2);
    });

    it('should return distinct origins', () => {
      const origins = getStellarCspOrigins();
      const uniqueOrigins = new Set(origins);

      expect(uniqueOrigins.size).toBe(origins.length);
    });
  });

  describe('getAllHorizonUrls', () => {
    it('should return all configured Horizon URLs', () => {
      const urls = getAllHorizonUrls();

      expect(urls).toContain('https://horizon-testnet.stellar.org');
      expect(urls).toContain('https://horizon.stellar.org');
      expect(urls).toHaveLength(2);
    });

    it('should match CSP origins', () => {
      const cspOrigins = getStellarCspOrigins();
      const horizonUrls = getAllHorizonUrls();

      expect(horizonUrls).toEqual(cspOrigins);
    });
  });
});
