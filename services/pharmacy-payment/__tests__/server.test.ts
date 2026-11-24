/**
 * Unit tests for services/pharmacy-payment/server.ts (Issue #31 / #943).
 *
 * Strategy:
 *   - Import and exercise the REAL Express app exported by server.ts — no
 *     hand-copied route reimplementation.  This follows the same pattern used
 *     correctly in http-order.integration.test.ts.
 *   - Mock only the external SDKs (mppx, Stellar) and file-locking so tests
 *     run without real network or disk side-effects.
 *   - Use a real temp-dir for DATA_DIR so order-persistence I/O is exercised
 *     against the actual saveOrder / loadOrders functions in server.ts.
 *
 * Acceptance criteria (Issue #943):
 *   - POST without payment → 402 + challenge headers echoed
 *   - POST with valid payment → 200, order appended to orders.json, receipt headers set
 *   - Missing drug / pharmacy / amount → 400
 *   - Concurrent 50 parallel POSTs → 50 orders in the file
 *   - A regression in the real POST /pharmacy/order handler is now caught here
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";
import type { Express } from "express";
import type { Server } from "http";

// ── Mocks (registered before the server module is imported) ───────────────────

let mppChargeImpl: (webReq: Request) => Promise<any> = async () => ({
  status: 402,
  challenge: {
    headers: new Map([
      ["X-Payment-Required", "1"],
      ["WWW-Authenticate", "x402"],
    ]),
    text: async () => JSON.stringify({ requires: "payment" }),
  },
});

vi.mock("mppx/server", () => ({
  Store: {
    memory: vi.fn(() => ({ type: "memory" })),
    fileSystem: vi.fn((p: string) => ({ type: "fileSystem", path: p })),
  },
  Mppx: {
    create: vi.fn(() => ({
      charge: () => (webReq: Request) => mppChargeImpl(webReq),
    })),
  },
}));

vi.mock("@stellar/mpp/charge/server", () => ({
  stellar: { charge: vi.fn(() => ({})) },
}));

vi.mock("@stellar/mpp", () => ({
  USDC_SAC_TESTNET: "USDC_SAC_TESTNET",
}));

vi.mock("dotenv/config", () => ({}));

vi.mock("proper-lockfile", () => ({
  default: {
    lock: vi.fn(() => Promise.resolve(() => Promise.resolve())),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const successCharge = async (_webReq: Request) => ({
  status: 200,
  withReceipt: (resp: Response) => {
    const headers = new Headers(resp.headers);
    headers.set("X-Payment-Receipt", "receipt-abc123");
    return new Response(resp.body, { status: resp.status, headers });
  },
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let app: Express;
let server: Server;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "careguard-server-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.PHARMACY_1_PUBLIC_KEY = "GPUB123TESTPHARMAKEY";
  process.env.MPP_SECRET_KEY = "SBTEST123SECRETKEY456789012345678901234567890123456789012345";
  process.env.PHARMACY_PAYMENT_PORT = "0";

  const mod = await import("../server.ts");
  app = mod.app;
  server = mod.server;
});

beforeEach(() => {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  mppChargeImpl = async () => ({
    status: 402,
    challenge: {
      headers: new Map([
        ["X-Payment-Required", "1"],
        ["WWW-Authenticate", "x402"],
      ]),
      text: async () => JSON.stringify({ requires: "payment" }),
    },
  });
});

afterAll(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// ── GET /pharmacy/orders ──────────────────────────────────────────────────────

describe("GET /pharmacy/orders", () => {
  it("returns 200 and an orders array", async () => {
    const res = await request(app).get("/pharmacy/orders");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
  });
});

// ── POST /pharmacy/order — 402 challenge ──────────────────────────────────────

describe("POST /pharmacy/order — 402 challenge (no payment)", () => {
  it("returns 402 with challenge body and X-Payment-Required header", async () => {
    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Metformin", pharmacy: "CVS", amount: 15.0 });

    expect(res.status).toBe(402);
    expect(res.headers["x-payment-required"]).toBe("1");
    expect(res.headers["www-authenticate"]).toBe("x402");
    const body = JSON.parse(res.text);
    expect(body.requires).toBe("payment");
  });

  it("does not persist an order when payment is required", async () => {
    const before = await request(app).get("/pharmacy/orders");
    const countBefore = before.body.orders.length;

    await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Lisinopril", pharmacy: "Walgreens", amount: 20.0 });

    const after = await request(app).get("/pharmacy/orders");
    expect(after.body.orders.length).toBe(countBefore);
  });
});

// ── POST /pharmacy/order — 200 success ───────────────────────────────────────

describe("POST /pharmacy/order — 200 success (payment verified)", () => {
  it("returns 200, persists the order, and sets receipt headers", async () => {
    mppChargeImpl = successCharge;

    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Atorvastatin", pharmacy: "Costco", amount: 9.99 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order.drug).toBe("Atorvastatin");
    expect(res.body.order.pharmacy).toBe("Costco");
    expect(res.body.order.amount).toBeCloseTo(9.99, 2);
    expect(res.body.order.status).toBe("confirmed");
    expect(res.body.order.id).toMatch(/^order-/);

    // Order must be readable via GET /pharmacy/orders
    const listRes = await request(app).get("/pharmacy/orders");
    const found = listRes.body.orders.find(
      (o: any) => o.id === res.body.order.id,
    );
    expect(found).toBeDefined();
    expect(found.drug).toBe("Atorvastatin");
  });

  it("sets X-Payment-Receipt header on 200 response", async () => {
    mppChargeImpl = successCharge;
    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Omeprazole", pharmacy: "RiteAid", amount: 7.5 });
    expect(res.status).toBe(200);
    expect(res.headers["x-payment-receipt"]).toBe("receipt-abc123");
  });
});

// ── POST /pharmacy/order — 400 validation errors ──────────────────────────────

describe("POST /pharmacy/order — 400 validation errors", () => {
  it("rejects a missing drug field", async () => {
    const res = await request(app)
      .post("/pharmacy/order")
      .send({ pharmacy: "CVS", amount: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid order/);
  });

  it("rejects a missing pharmacy field", async () => {
    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Metformin", amount: 10 });
    expect(res.status).toBe(400);
  });

  it("rejects a missing amount field", async () => {
    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Metformin", pharmacy: "CVS" });
    expect(res.status).toBe(400);
  });

  it("rejects a negative amount", async () => {
    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Metformin", pharmacy: "CVS", amount: -5 });
    expect(res.status).toBe(400);
  });

  it("rejects a zero amount", async () => {
    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Metformin", pharmacy: "CVS", amount: 0 });
    expect(res.status).toBe(400);
  });
});

// ── Blocklist: auth/cookie headers must not be forwarded ─────────────────────

describe("POST /pharmacy/order — header forwarding blocklist", () => {
  it("strips Authorization header before passing to mppx (never leaks caller creds)", async () => {
    let capturedHeaders: Headers | undefined;
    mppChargeImpl = async (webReq: Request) => {
      capturedHeaders = webReq.headers;
      return {
        status: 402,
        challenge: {
          headers: new Map([["X-Payment-Required", "1"]]),
          text: async () => "{}",
        },
      };
    };

    await request(app)
      .post("/pharmacy/order")
      .set("Authorization", "Bearer secret-token")
      .send({ drug: "Metformin", pharmacy: "CVS", amount: 10 });

    expect(capturedHeaders?.has("authorization")).toBe(false);
  });

  it("strips Cookie header before passing to mppx", async () => {
    let capturedHeaders: Headers | undefined;
    mppChargeImpl = async (webReq: Request) => {
      capturedHeaders = webReq.headers;
      return {
        status: 402,
        challenge: {
          headers: new Map([["X-Payment-Required", "1"]]),
          text: async () => "{}",
        },
      };
    };

    await request(app)
      .post("/pharmacy/order")
      .set("Cookie", "session=abc123")
      .send({ drug: "Metformin", pharmacy: "CVS", amount: 10 });

    expect(capturedHeaders?.has("cookie")).toBe(false);
  });
});

// ── POST /pharmacy/order — concurrent orders ──────────────────────────────────

describe("POST /pharmacy/order — concurrent orders (Issue #31 acceptance criterion)", () => {
  it("50 parallel POSTs each return 200 and produce 50 unique order IDs", async () => {
    mppChargeImpl = successCharge;

    const drugs = [
      "Lisinopril",
      "Metformin",
      "Atorvastatin",
      "Amlodipine",
      "Omeprazole",
    ];

    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        request(app)
          .post("/pharmacy/order")
          .send({ drug: drugs[i % drugs.length], pharmacy: "CVS", amount: 10 + i }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 200)).toBe(true);

    const ids = responses.map((r) => r.body.order?.id).filter(Boolean);
    expect(new Set(ids).size).toBe(50);

    // All orders must be readable back via the real GET handler
    const listRes = await request(app).get("/pharmacy/orders");
    const listedIds = new Set(listRes.body.orders.map((o: any) => o.id));
    for (const id of ids) {
      expect(listedIds.has(id)).toBe(true);
    }
  });
});

describe('POST /pharmacy/order — MPP header allowlist (#938)', () => {
  beforeEach(() => { orderStore = []; });

  it('forwards allowed headers (x-payment, content-type, accept) to mppCharge', async () => {
    let capturedHeaders: Headers | null = null;
    const capturingCharge = async (webReq: Request) => {
      capturedHeaders = webReq.headers;
      return {
        status: 200,
        withReceipt: (resp: Response) => resp,
      };
    };

    const app = createTestApp({ mppCharge: capturingCharge, loadOrders: loadOrdersFn, saveOrder: saveOrderFn });
    await request(app)
      .post('/pharmacy/order')
      .set('X-Payment', 'pay_receipt_xyz')
      .set('Accept', 'application/json')
      .send({ drug: 'Metformin', pharmacy: 'CVS', amount: 10 });

    expect(capturedHeaders!.get('x-payment')).toBe('pay_receipt_xyz');
    expect(capturedHeaders!.get('accept')).toBe('application/json');
  });

  it('does NOT forward arbitrary caller headers to mppCharge', async () => {
    let capturedHeaders: Headers | null = null;
    const capturingCharge = async (webReq: Request) => {
      capturedHeaders = webReq.headers;
      return {
        status: 200,
        withReceipt: (resp: Response) => resp,
      };
    };

    const app = createTestApp({ mppCharge: capturingCharge, loadOrders: loadOrdersFn, saveOrder: saveOrderFn });
    await request(app)
      .post('/pharmacy/order')
      .set('X-Custom-Attack', 'injected')
      .set('X-Forwarded-For', '1.2.3.4')
      .set('Authorization', 'Bearer stolen-token')
      .set('Cookie', 'session=abc')
      .send({ drug: 'Metformin', pharmacy: 'CVS', amount: 10 });

    expect(capturedHeaders!.get('x-custom-attack')).toBeNull();
    expect(capturedHeaders!.get('x-forwarded-for')).toBeNull();
    expect(capturedHeaders!.get('authorization')).toBeNull();
    expect(capturedHeaders!.get('cookie')).toBeNull();
  });
});
