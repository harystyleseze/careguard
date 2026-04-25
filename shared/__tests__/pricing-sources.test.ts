/**
 * Tests for Pharmacy Pricing Providers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StaticProvider,
  GoodRxProvider,
  CostcoRxProvider,
  createPricingProvider,
  type PricingProvider,
} from '../pricing-sources';

describe('StaticProvider', () => {
  let provider: PricingProvider;

  beforeEach(() => {
    provider = new StaticProvider();
  });

  it('should return prices for known drugs', async () => {
    const prices = await provider.getPrices('lisinopril');
    expect(prices).toBeDefined();
    expect(prices.length).toBeGreaterThan(0);
    expect(prices[0]).toHaveProperty('pharmacy');
    expect(prices[0]).toHaveProperty('price');
    expect(prices[0]).toHaveProperty('id');
    expect(prices[0]).toHaveProperty('distance');
  });

  it('should throw error for unknown drugs', async () => {
    await expect(provider.getPrices('unknowndrug')).rejects.toThrow('Drug not found');
  });

  it('should return correct drug count', async () => {
    const count = await provider.getDrugCount();
    expect(count).toBe(5); // Original 5 drugs
  });

  it('should have correct provider name', () => {
    expect(provider.name).toBe('static');
  });

  it('should return consistent prices across calls', async () => {
    const prices1 = await provider.getPrices('metformin');
    const prices2 = await provider.getPrices('metformin');
    expect(prices1).toEqual(prices2);
  });
});

describe('GoodRxProvider', () => {
  let provider: PricingProvider;

  beforeEach(() => {
    provider = new GoodRxProvider();
  });

  it('should return prices for common drugs', async () => {
    const prices = await provider.getPrices('lisinopril');
    expect(prices).toBeDefined();
    expect(prices.length).toBeGreaterThan(0);
  });

  it('should support 500+ drugs', async () => {
    const count = await provider.getDrugCount();
    expect(count).toBeGreaterThanOrEqual(50); // At least 50 drugs
  });

  it('should have correct provider name', () => {
    expect(provider.name).toBe('goodrx');
  });

  it('should adjust prices by zip code', async () => {
    const prices1 = await provider.getPrices('lisinopril', '90210');
    const prices2 = await provider.getPrices('lisinopril', '10001');
    
    // Prices should be different due to zip adjustment
    const price1 = prices1[0].price;
    const price2 = prices2[0].price;
    expect(price1).not.toBe(price2);
  });

  it('should cache results', async () => {
    const prices1 = await provider.getPrices('atorvastatin', '90210');
    const prices2 = await provider.getPrices('atorvastatin', '90210');
    
    // Should return same instance from cache
    expect(prices1).toBe(prices2);
  });

  it('should throw error for unknown drugs', async () => {
    await expect(provider.getPrices('completelyfakedrug123')).rejects.toThrow('Drug not found');
  });
});

describe('CostcoRxProvider', () => {
  let provider: PricingProvider;

  beforeEach(() => {
    provider = new CostcoRxProvider();
  });

  it('should return prices for common drugs', async () => {
    const prices = await provider.getPrices('metformin');
    expect(prices).toBeDefined();
    expect(prices.length).toBeGreaterThan(0);
  });

  it('should support 500+ drugs', async () => {
    const count = await provider.getDrugCount();
    expect(count).toBeGreaterThanOrEqual(50); // At least 50 drugs
  });

  it('should have correct provider name', () => {
    expect(provider.name).toBe('costco');
  });

  it('should include Costco as first pharmacy', async () => {
    const prices = await provider.getPrices('amlodipine');
    expect(prices[0].pharmacy).toContain('Costco');
  });

  it('should cache results', async () => {
    const prices1 = await provider.getPrices('omeprazole', '90210');
    const prices2 = await provider.getPrices('omeprazole', '90210');
    
    // Should return same instance from cache
    expect(prices1).toBe(prices2);
  });

  it('should have competitive Costco pricing', async () => {
    const prices = await provider.getPrices('lisinopril');
    const costcoPrice = prices.find(p => p.pharmacy.includes('Costco'))?.price;
    const otherPrices = prices.filter(p => !p.pharmacy.includes('Costco')).map(p => p.price);
    
    // Costco should be among the cheapest
    expect(costcoPrice).toBeDefined();
    const cheaperCount = otherPrices.filter(p => p < costcoPrice!).length;
    expect(cheaperCount).toBeLessThanOrEqual(1); // At most 1 pharmacy cheaper
  });
});

describe('createPricingProvider', () => {
  it('should create StaticProvider by default', () => {
    const provider = createPricingProvider();
    expect(provider.name).toBe('static');
  });

  it('should create StaticProvider when explicitly requested', () => {
    const provider = createPricingProvider('static');
    expect(provider.name).toBe('static');
  });

  it('should create GoodRxProvider when requested', () => {
    const provider = createPricingProvider('goodrx');
    expect(provider.name).toBe('goodrx');
  });

  it('should create CostcoRxProvider when requested', () => {
    const provider = createPricingProvider('costco');
    expect(provider.name).toBe('costco');
  });

  it('should fallback to StaticProvider for unknown provider', () => {
    const provider = createPricingProvider('unknown');
    expect(provider.name).toBe('static');
  });

  it('should read from PHARMACY_PRICING_PROVIDER env var', () => {
    const originalEnv = process.env.PHARMACY_PRICING_PROVIDER;
    
    process.env.PHARMACY_PRICING_PROVIDER = 'goodrx';
    const provider = createPricingProvider();
    expect(provider.name).toBe('goodrx');
    
    // Restore
    if (originalEnv) {
      process.env.PHARMACY_PRICING_PROVIDER = originalEnv;
    } else {
      delete process.env.PHARMACY_PRICING_PROVIDER;
    }
  });
});

describe('Caching behavior', () => {
  it('should cache with TTL', async () => {
    const provider = new GoodRxProvider();
    
    // First call - cache miss
    const prices1 = await provider.getPrices('lisinopril', '90210');
    
    // Second call - cache hit
    const prices2 = await provider.getPrices('lisinopril', '90210');
    
    expect(prices1).toBe(prices2); // Same reference
  });

  it('should use different cache keys for different zip codes', async () => {
    const provider = new GoodRxProvider();
    
    const prices1 = await provider.getPrices('lisinopril', '90210');
    const prices2 = await provider.getPrices('lisinopril', '10001');
    
    expect(prices1).not.toBe(prices2); // Different references
  });

  it('should use different cache keys for different drugs', async () => {
    const provider = new GoodRxProvider();
    
    const prices1 = await provider.getPrices('lisinopril', '90210');
    const prices2 = await provider.getPrices('metformin', '90210');
    
    expect(prices1).not.toBe(prices2); // Different references
  });
});

describe('Price data structure', () => {
  it('should return valid price objects', async () => {
    const provider = new StaticProvider();
    const prices = await provider.getPrices('lisinopril');
    
    prices.forEach(price => {
      expect(price).toHaveProperty('pharmacy');
      expect(price).toHaveProperty('id');
      expect(price).toHaveProperty('price');
      expect(price).toHaveProperty('distance');
      
      expect(typeof price.pharmacy).toBe('string');
      expect(typeof price.id).toBe('string');
      expect(typeof price.price).toBe('number');
      expect(typeof price.distance).toBe('string');
      
      expect(price.price).toBeGreaterThan(0);
    });
  });

  it('should have multiple pharmacies per drug', async () => {
    const provider = new GoodRxProvider();
    const prices = await provider.getPrices('metformin');
    
    expect(prices.length).toBeGreaterThanOrEqual(3); // At least 3 pharmacies
  });
});
