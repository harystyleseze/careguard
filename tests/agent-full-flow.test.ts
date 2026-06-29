process.env.MOCK_NETWORK = "0";

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

const tempDir = process.env.DATA_DIR!;


// Mock x402 and MPP clients so we don't actually do Stellar payments, 
// but we DO make the HTTP requests to the local services.
vi.mock('@x402/fetch', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    x402Client: class { 
      register() { return this; } 
      wrapFetchWithPayment(fetchFn: any) {
        return async (url: string, options: any = {}) => {
          const res = await fetchFn(url, { ...options });
          const body = await res.arrayBuffer();
          const headers = new Headers(res.headers);
          headers.set('PAYMENT-RESPONSE', 'mock-x402-tx-hash-000000000000000000000000000000000000000000000000');
          if (!res.ok) {
            console.log(`X402 FETCH FAILED: ${url} -> ${res.status} ${new TextDecoder().decode(body)}`);
          }
          return new Response(body, { status: res.status, statusText: res.statusText, headers });
        };
      }
    },
  };
});

vi.mock('../agent/mpp-client.ts', () => ({
  createMppClient: () => ({
    fetch: async (url: string, options: any) => {
      const res = await fetch(url, options);
      if (!res.ok) {
        console.error("MPP FETCH FAILED:", res.status, await res.text());
        throw new Error("mpp fetch failed");
      }
      const headers = new Headers(res.headers);
      headers.set('Payment-Receipt', Buffer.from(JSON.stringify({ reference: 'mock-mpp-tx-hash-000000000000000000000000000000000000000000000000' })).toString('base64'));
      const body = await res.arrayBuffer();
      return new Response(body, { status: res.status, statusText: res.statusText, headers });
    }
  })
}));

// Mock the on-chain confirmation check
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    Horizon: {
      Server: class {
        transactions() {
          return {
            transaction: () => ({
              call: async () => ({ successful: true })
            })
          };
        }
        loadAccount() {
          return Promise.resolve({ balances: [] });
        }
      }
    }
  };
});

// Mock middlewares in server so they don't block requests
vi.mock('../shared/x402-middleware.ts', () => ({
  applyX402Middleware: (app: any) => {
    // Just pass through
  },
  checkFacilitatorHealth: vi.fn(),
}));

vi.mock('mppx/server', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    Mppx: {
      create: () => ({
        methods: [],
        charge: () => async (req: any) => ({
          status: 200,
          withReceipt: (res: any) => res,
        }),
      }),
    },
  };
});
vi.mock('@stellar/mpp/charge/server', () => ({
  stellar: {
    charge: () => (req: any, res: any, next: any) => next()
  }
}));

const { app } = await import('../server.ts');

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              finish_reason: "stop",
              message: {
                content: "I have compared the prices and ordered medications. The total savings are $5.50.",
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'compare_pharmacy_prices', arguments: '{"drug_name":"lisinopril","dosage":"10mg"}' } },
                  { id: 'call_2', type: 'function', function: { name: 'compare_pharmacy_prices', arguments: '{"drug_name":"metformin","dosage":"500mg"}' } },
                  { id: 'call_3', type: 'function', function: { name: 'compare_pharmacy_prices', arguments: '{"drug_name":"atorvastatin","dosage":"20mg"}' } },
                  { id: 'call_4', type: 'function', function: { name: 'compare_pharmacy_prices', arguments: '{"drug_name":"amlodipine","dosage":"5mg"}' } },
                  { id: 'call_5', type: 'function', function: { name: 'check_drug_interactions', arguments: '{"medications":["lisinopril","metformin","atorvastatin","amlodipine"]}' } },
                  { id: 'call_6', type: 'function', function: { name: 'pay_for_medication', arguments: '{"pharmacy_id":"mock-pharmacy-1","pharmacy_name":"MockCare Pharmacy","drug_name":"lisinopril","amount":4.25}' } },
                  { id: 'call_7', type: 'function', function: { name: 'pay_for_medication', arguments: '{"pharmacy_id":"mock-pharmacy-2","pharmacy_name":"HealthPlus","drug_name":"metformin","amount":2.50}' } },
                  { id: 'call_8', type: 'function', function: { name: 'pay_for_medication', arguments: '{"pharmacy_id":"mock-pharmacy-1","pharmacy_name":"MockCare Pharmacy","drug_name":"atorvastatin","amount":5.75}' } },
                  { id: 'call_9', type: 'function', function: { name: 'pay_for_medication', arguments: '{"pharmacy_id":"mock-pharmacy-2","pharmacy_name":"HealthPlus","drug_name":"amlodipine","amount":1.15}' } },
                ]
              }
            }]
          })
        }
      }
    }
  };
});

describe('Agent Full Flow', () => {
  let server: any;

  beforeEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });


    // Seed pharmacy DB
    const pharmacyDbPath = path.join(tempDir, 'pharmacy-pricing.sqlite');
    process.env.PHARMACY_DB_PATH = pharmacyDbPath;

    server = app.listen(process.env.PORT);
  });

  afterEach(() => {
    server.close();
    process.env.MOCK_NETWORK = "1";
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs the full agent flow successfully', async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Seed pharmacy pricing so the compare endpoints work
    await request(app).post('/pharmacy/drugs').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ name: 'lisinopril', dosages: ['10mg'] });
    await request(app).post('/pharmacy/drugs').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ name: 'metformin', dosages: ['500mg'] });
    await request(app).post('/pharmacy/drugs').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ name: 'atorvastatin', dosages: ['20mg'] });
    await request(app).post('/pharmacy/drugs').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ name: 'amlodipine', dosages: ['5mg'] });
    await request(app).post('/pharmacy/pharmacies').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ id: 'mock-pharmacy-1', name: 'MockCare Pharmacy', location: '123 Main St', distance: 1.0 });
    await request(app).post('/pharmacy/pharmacies').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ id: 'mock-pharmacy-2', name: 'HealthPlus', location: '456 Elm St', distance: 2.0 });
    await request(app).post('/pharmacy/prices').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ drug: 'lisinopril', dosage: '10mg', pharmacyId: 'mock-pharmacy-1', price: 4.25, timestamp: new Date().toISOString() });
    await request(app).post('/pharmacy/prices').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ drug: 'metformin', dosage: '500mg', pharmacyId: 'mock-pharmacy-2', price: 2.50, timestamp: new Date().toISOString() });
    await request(app).post('/pharmacy/prices').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ drug: 'atorvastatin', dosage: '20mg', pharmacyId: 'mock-pharmacy-1', price: 5.75, timestamp: new Date().toISOString() });
    await request(app).post('/pharmacy/prices').set('Authorization', `Bearer ${process.env.CAREGIVER_TOKEN}`).send({ drug: 'amlodipine', dosage: '5mg', pharmacyId: 'mock-pharmacy-2', price: 1.15, timestamp: new Date().toISOString() });

    const res = await request(app)
      .post('/agent/run')
      .set('Authorization', `Bearer ${process.env.AGENT_API_KEY}`)
      .send({ task: "Compare all of Rosa's medications, check interactions, order cheapest" });
      
    expect(res.status).toBe(200);
    expect(res.body.response).toContain("savings");
    
    const ordersFile = path.join(tempDir, 'orders.json');
    expect(fs.existsSync(ordersFile)).toBe(true);
    const orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    // The agent calls pay_for_medication 4 times
    expect(orders.length).toBe(4);

    const jsonlFile = path.join(tempDir, 'recipients', 'rosa', 'transactions.jsonl');
    const jsonl = fs.existsSync(jsonlFile) ? fs.readFileSync(jsonlFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    
    let totalServiceFees = 0;
    let totalMedications = 0;
    for (const tx of jsonl) {
      if (tx.type === 'service_fee') totalServiceFees += tx.amount;
      if (tx.type === 'medication') totalMedications += tx.amount;
    }
    const execSync = require('child_process').execSync;
    expect(totalServiceFees).toBeCloseTo(0.009); // 4 * 0.002 + 0.001
    expect(totalMedications).toBe(13.65); // 4.25 + 2.50 + 5.75 + 1.15
  });
});
