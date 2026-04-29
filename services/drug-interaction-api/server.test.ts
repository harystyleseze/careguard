import { vi, describe, it, expect, afterAll } from 'vitest';
import supertest from 'supertest';

// Env vars and port must be set before module is imported (vi.hoisted runs first)
vi.hoisted(() => {
  process.env.PHARMACY_2_PUBLIC_KEY = 'GTEST1234567890123456789TESTKEY1';
  process.env.DRUG_INTERACTION_API_PORT = '0'; // random port — no conflicts
});

vi.mock('../../shared/x402-middleware.ts', () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: 'stellar:testnet',
  OZ_FACILITATOR_URL: 'https://test.example.com',
}));

import { app, checkInteractions, server } from './server.ts';

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

// ─── checkInteractions pure-function tests ────────────────────────────────────

describe('checkInteractions', () => {
  it('["lisinopril","potassium"] → one severe interaction, overallRisk high', () => {
    const result = checkInteractions(['lisinopril', 'potassium']);
    expect(result.interactionCount).toBe(1);
    expect(result.severeCount).toBe(1);
    expect(result.interactions[0].severity).toBe('severe');
    expect(result.overallRisk).toBe('high');
  });

  it('["atorvastatin","grapefruit"] → one moderate interaction', () => {
    const result = checkInteractions(['atorvastatin', 'grapefruit']);
    expect(result.interactionCount).toBe(1);
    expect(result.interactions[0].severity).toBe('moderate');
    expect(result.overallRisk).toBe('moderate');
    expect(result.severeCount).toBe(0);
    expect(result.moderateCount).toBe(1);
  });

  it('["amlodipine","atorvastatin"] → one mild interaction', () => {
    const result = checkInteractions(['amlodipine', 'atorvastatin']);
    expect(result.interactionCount).toBe(1);
    expect(result.interactions[0].severity).toBe('mild');
    expect(result.overallRisk).toBe('low');
  });

  it('unknown pair → interactionCount 0, overallRisk none', () => {
    const result = checkInteractions(['aspirin', 'tylenol']);
    expect(result.interactionCount).toBe(0);
    expect(result.overallRisk).toBe('none');
    expect(result.summary).toMatch(/No known interactions/);
  });

  it('case-insensitive: mixed-case inputs produce identical output', () => {
    const lower = checkInteractions(['lisinopril', 'potassium']);
    const upper = checkInteractions(['LISINOPRIL', 'POTASSIUM']);
    const mixed = checkInteractions(['Lisinopril', 'Potassium']);
    expect(lower.interactionCount).toBe(upper.interactionCount);
    expect(lower.overallRisk).toBe(upper.overallRisk);
    expect(lower.interactions[0].severity).toBe(mixed.interactions[0].severity);
  });

  it('overallRisk: any severe → high (even if also moderate present)', () => {
    // severe: lisinopril+potassium, moderate: atorvastatin+grapefruit
    const result = checkInteractions(['lisinopril', 'potassium', 'atorvastatin', 'grapefruit']);
    expect(result.overallRisk).toBe('high');
    expect(result.severeCount).toBeGreaterThanOrEqual(1);
  });

  it('overallRisk: moderate-only (no severe) → moderate', () => {
    const result = checkInteractions(['atorvastatin', 'grapefruit']);
    expect(result.overallRisk).toBe('moderate');
    expect(result.severeCount).toBe(0);
  });

  it('interactions sorted: severe before moderate before mild', () => {
    // severe: lisinopril+potassium, moderate: lisinopril+ibuprofen, mild: amlodipine+atorvastatin
    const result = checkInteractions(['lisinopril', 'potassium', 'ibuprofen', 'amlodipine', 'atorvastatin']);
    const severities = result.interactions.map(i => i.severity);
    const order: Record<string, number> = { severe: 0, moderate: 1, mild: 2 };
    for (let i = 0; i < severities.length - 1; i++) {
      expect(order[severities[i]]).toBeLessThanOrEqual(order[severities[i + 1]]);
    }
  });

  it('all 8 canonical interactions are detectable', () => {
    const pairs: [string[], string][] = [
      [['lisinopril', 'potassium'], 'severe'],
      [['metformin', 'alcohol'], 'severe'],
      [['atorvastatin', 'grapefruit'], 'moderate'],
      [['lisinopril', 'ibuprofen'], 'moderate'],
      [['amlodipine', 'atorvastatin'], 'mild'],
      [['metformin', 'atorvastatin'], 'mild'],
      [['omeprazole', 'metformin'], 'mild'],
      [['lisinopril', 'amlodipine'], 'mild'],
    ];
    for (const [meds, expectedSeverity] of pairs) {
      const result = checkInteractions(meds);
      expect(result.interactionCount, `${meds.join('+')} should have 1 interaction`).toBe(1);
      expect(result.interactions[0].severity, `${meds.join('+')} severity`).toBe(expectedSeverity);
    }
  });

  it('reverse order of meds produces the same result', () => {
    const forward = checkInteractions(['lisinopril', 'potassium']);
    const reversed = checkInteractions(['potassium', 'lisinopril']);
    expect(forward.interactionCount).toBe(reversed.interactionCount);
    expect(forward.overallRisk).toBe(reversed.overallRisk);
  });

  it('mildCount equals total minus severe minus moderate', () => {
    const result = checkInteractions(['lisinopril', 'potassium', 'ibuprofen', 'amlodipine', 'atorvastatin']);
    expect(result.mildCount).toBe(result.interactionCount - result.severeCount - result.moderateCount);
  });

  it('summary message reflects interaction counts', () => {
    const result = checkInteractions(['lisinopril', 'potassium']);
    expect(result.summary).toMatch(/1 interaction/);
    expect(result.summary).toMatch(/1 severe/);
  });
});

// ─── HTTP endpoint tests ──────────────────────────────────────────────────────

describe('GET /drug/interactions', () => {
  const req = supertest(app);

  it('missing meds param → 400', async () => {
    const res = await req.get('/drug/interactions');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  it('single medication → 400 (need at least 2)', async () => {
    const res = await req.get('/drug/interactions?meds=lisinopril');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2 medications/);
  });

  it('valid pair → 200 with interaction data', async () => {
    const res = await req.get('/drug/interactions?meds=lisinopril,potassium');
    expect(res.status).toBe(200);
    expect(res.body.interactionCount).toBe(1);
    expect(res.body.overallRisk).toBe('high');
    expect(res.body.interactions).toHaveLength(1);
  });

  it('unknown pair → 200 with zero interactions', async () => {
    const res = await req.get('/drug/interactions?meds=aspirin,tylenol');
    expect(res.status).toBe(200);
    expect(res.body.interactionCount).toBe(0);
    expect(res.body.overallRisk).toBe('none');
  });
});

describe('GET /', () => {
  it('returns service info', async () => {
    const res = await supertest(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.service).toMatch(/Drug Interaction/);
  });
});
