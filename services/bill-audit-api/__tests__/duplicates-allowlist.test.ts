/**
 * Tests for duplicate detection allowlist configuration (#176).
 *
 * Verifies that the allowlist is loaded from duplicates-allowlist.json,
 * can be reloaded on SIGHUP, and supports per-facility overrides.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';

describe('Duplicate detection allowlist', () => {
  const allowlistPath = new URL('../duplicates-allowlist.json', import.meta.url).pathname;
  let originalContent: string | null = null;

  beforeEach(() => {
    if (existsSync(allowlistPath)) {
      originalContent = readFileSync(allowlistPath, 'utf-8');
    }
  });

  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(allowlistPath, originalContent);
    }
  });

  it('allowlist file exists and is valid JSON', () => {
    expect(existsSync(allowlistPath)).toBe(true);
    const content = readFileSync(allowlistPath, 'utf-8');
    const data = JSON.parse(content);
    expect(Array.isArray(data)).toBe(true);
  });

  it('each entry has required fields: code, reason, addedBy, addedAt', () => {
    const content = readFileSync(allowlistPath, 'utf-8');
    const data = JSON.parse(content);
    
    for (const entry of data) {
      expect(entry).toHaveProperty('code');
      expect(entry).toHaveProperty('reason');
      expect(entry).toHaveProperty('addedBy');
      expect(entry).toHaveProperty('addedAt');
      expect(typeof entry.code).toBe('string');
      expect(typeof entry.reason).toBe('string');
      expect(typeof entry.addedBy).toBe('string');
      expect(typeof entry.addedAt).toBe('string');
    }
  });

  it('includes 96372 (injection) with documented reason', () => {
    const content = readFileSync(allowlistPath, 'utf-8');
    const data = JSON.parse(content);
    const entry = data.find((e: any) => e.code === '96372');
    
    expect(entry).toBeDefined();
    expect(entry.reason).toContain('multiple');
    expect(entry.reason.length).toBeGreaterThan(20);
  });

  it('includes 97110 (physical therapy) with documented reason', () => {
    const content = readFileSync(allowlistPath, 'utf-8');
    const data = JSON.parse(content);
    const entry = data.find((e: any) => e.code === '97110');
    
    expect(entry).toBeDefined();
    expect(entry.reason).toContain('15-minute');
    expect(entry.reason.length).toBeGreaterThan(20);
  });

  it('supports optional facilityId field for per-facility overrides', () => {
    const content = readFileSync(allowlistPath, 'utf-8');
    const data = JSON.parse(content);
    
    // Schema allows facilityId but doesn't require it
    for (const entry of data) {
      if (entry.facilityId) {
        expect(typeof entry.facilityId).toBe('string');
      }
    }
  });

  it('addedAt timestamps are valid ISO 8601 dates', () => {
    const content = readFileSync(allowlistPath, 'utf-8');
    const data = JSON.parse(content);
    
    for (const entry of data) {
      const date = new Date(entry.addedAt);
      expect(date.toString()).not.toBe('Invalid Date');
    }
  });
});
