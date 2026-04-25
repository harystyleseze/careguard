import { vi, describe, it, expect, afterAll } from 'vitest';
import supertest from 'supertest';

vi.hoisted(() => {
  process.env.PHARMACY_1_PUBLIC_KEY = 'GTEST1234567890123456789TESTKEY3';
  process.env.PHARMACY_API_PORT = '0';
});

// Mock x402 middleware to bypass payment gate in tests
const mockApplyX402 = vi.hoisted(() => vi.fn());

vi.mock('../../shared/x402-middleware.ts', () => ({
  applyX402Middleware: mockApplyX402,
  NETWORK: 'stellar:testnet',
  OZ_FACILITATOR_URL: 'https://test.example.com',
}));

import { app, server } from './server.ts';

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const req = supertest(app);

// ─── /pharmacy/drugs ─────────────────────────────────────────────────────────

describe('GET /pharmacy/drugs', () => {
  it('returns provider metadata and drug count', async () => {
    const res = await req.get('/pharmacy/drugs');
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('static');
    expect(res.body.count).toBe(5); // StaticProvider has 5 canonical drugs
    expect(res.body.message).toBeDefined();
  });
});

// ─── /pharmacy/compare ───────────────────────────────────────────────────────

describe('GET /pharmacy/compare', () => {
  it('missing drug param → 400 with error message', async () => {
    const res = await req.get('/pharmacy/compare');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/drug/i);
  });

  it('unknown drug → 404 with available drug count', async () => {
    const res = await req.get('/pharmacy/compare?drug=xyzunknowndrug');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(res.body.drugCount).toBe(5);
  });

  it('lisinopril → 5 pharmacies sorted cheapest-first', async () => {
    const res = await req.get('/pharmacy/compare?drug=lisinopril');
    expect(res.status).toBe(200);
    expect(res.body.prices).toHaveLength(5);
    // Verify ascending price order
    const prices = res.body.prices.map((p: any) => p.price);
    for (let i = 0; i < prices.length - 1; i++) {
      expect(prices[i]).toBeLessThanOrEqual(prices[i + 1]);
    }
    // Cheapest should be Costco ($3.50)
    expect(res.body.prices[0].pharmacyName).toMatch(/Costco/);
    expect(res.body.prices[0].price).toBe(3.5);
  });

  it('lisinopril potentialSavings = mostExpensive − cheapest', async () => {
    const res = await req.get('/pharmacy/compare?drug=lisinopril');
    expect(res.status).toBe(200);
    const expected = +(18.99 - 3.50).toFixed(2);
    expect(res.body.potentialSavings).toBeCloseTo(expected, 2);
    expect(res.body.cheapest.price).toBe(3.5);
    expect(res.body.mostExpensive.price).toBe(18.99);
  });

  it('metformin potentialSavings correct', async () => {
    const res = await req.get('/pharmacy/compare?drug=metformin');
    expect(res.status).toBe(200);
    const expected = +(16.79 - 4.0).toFixed(2);
    expect(res.body.potentialSavings).toBeCloseTo(expected, 2);
  });

  it('atorvastatin potentialSavings correct', async () => {
    const res = await req.get('/pharmacy/compare?drug=atorvastatin');
    expect(res.status).toBe(200);
    const expected = +(31.99 - 6.5).toFixed(2);
    expect(res.body.potentialSavings).toBeCloseTo(expected, 2);
  });

  it('case-insensitive drug name lookup', async () => {
    const lower = await req.get('/pharmacy/compare?drug=lisinopril');
    const upper = await req.get('/pharmacy/compare?drug=LISINOPRIL');
    expect(lower.status).toBe(200);
    expect(upper.status).toBe(200);
    expect(lower.body.prices.length).toBe(upper.body.prices.length);
  });

  it('response includes protocol, provider, zipCode fields', async () => {
    const res = await req.get('/pharmacy/compare?drug=amlodipine&zip=10001');
    expect(res.status).toBe(200);
    expect(res.body.protocol.name).toBe('x402');
    expect(res.body.provider).toBe('static');
    expect(res.body.zipCode).toBe('10001');
  });
});

// ─── x402 gate ───────────────────────────────────────────────────────────────

describe('x402 gate', () => {
  it('applyX402Middleware was called for the compare route', () => {
    // Verifies the payment gate is wired up (mocked to no-op in tests)
    expect(mockApplyX402).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ 'GET /pharmacy/compare': expect.any(Object) })
    );
  });
});

// ─── GET / ────────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns service info', async () => {
    const res = await req.get('/');
    expect(res.status).toBe(200);
    expect(res.body.service).toMatch(/Pharmacy/);
    expect(res.body.pricingProvider).toBe('static');
  });
});
