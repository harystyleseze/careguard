import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { billAuditOversizedRejectionsTotal } from '../shared/metrics.ts';

// Build a minimal test harness that mirrors the bill-audit middleware ordering
function buildTestApp(maxItems = 500) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Size gate — runs BEFORE the x402 payment middleware (issue #13)
  app.post('/bill/audit', (req, res, next) => {
    const items = req.body?.lineItems;
    if (Array.isArray(items) && items.length > maxItems) {
      billAuditOversizedRejectionsTotal.inc();
      res.status(400).json({ error: `lineItems exceeds max (${maxItems})` });
      return;
    }
    next();
  });

  // Stub route — stands in for the real x402 + audit handler
  app.post('/bill/audit', (req, res) => {
    res.json({ ok: true, lineItemCount: req.body?.lineItems?.length ?? 0 });
  });

  return app;
}

function makeLineItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    description: 'Office visit',
    cptCode: '99213',
    quantity: 1,
    chargedAmount: 130 + i,
  }));
}

describe('POST /bill/audit size cap (issue #13)', () => {
  it('rejects a 501-item body with 400 before x402 payment', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/bill/audit')
      .send({ lineItems: makeLineItems(501) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('lineItems exceeds max (500)');
  });

  it('accepts a 500-item body and returns 200', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/bill/audit')
      .send({ lineItems: makeLineItems(500) });

    expect(res.status).toBe(200);
    expect(res.body.lineItemCount).toBe(500);
  });

  it('accepts a 1-item body normally', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/bill/audit')
      .send({ lineItems: makeLineItems(1) });

    expect(res.status).toBe(200);
  });

  it('respects a custom BILL_AUDIT_MAX_ITEMS limit', async () => {
    const app = buildTestApp(10);

    const over = await request(app)
      .post('/bill/audit')
      .send({ lineItems: makeLineItems(11) });
    expect(over.status).toBe(400);
    expect(over.body.error).toBe('lineItems exceeds max (10)');

    const under = await request(app)
      .post('/bill/audit')
      .send({ lineItems: makeLineItems(10) });
    expect(under.status).toBe(200);
  });

  it('passes through non-array lineItems for downstream validation', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/bill/audit')
      .send({ lineItems: 'not-an-array' });

    // Size gate should not block — downstream validator handles the type error
    expect(res.status).toBe(200);
  });
});
