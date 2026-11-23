import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, chmodSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";
import type { Express } from "express";
import type { Server } from "http";

/**
 * HTTP integration tests (Issue #790) against the REAL server.ts app (exported
 * for testing) — not a hand-copied route reimplementation. Only the MPP/Stellar
 * SDKs and file-locking are mocked; real Express middleware and real fs against
 * a temp data dir are used, so this exercises the actual charge -> order-record
 * -> read-back path on the wire, including the header-sanitization and
 * facilitator-unavailable handling added alongside this test.
 */

let mppChargeImpl: (webReq: Request) => Promise<any> = async () => ({
  status: 402,
  challenge: {
    headers: new Map([["X-Payment-Required", "1"]]),
    text: async () => JSON.stringify({ requires: "payment" }),
  },
});
let lastWebReqHeaders: Headers | undefined;

vi.mock("mppx/server", () => ({
  Store: {
    memory: vi.fn(() => ({ type: "memory" })),
    fileSystem: vi.fn((p: string) => ({ type: "fileSystem", path: p })),
  },
  Mppx: {
    create: vi.fn(() => ({
      charge: () => (webReq: Request) => {
        lastWebReqHeaders = webReq.headers;
        return mppChargeImpl(webReq);
      },
    })),
  },
}));
vi.mock("@stellar/mpp/charge/server", () => ({ stellar: { charge: vi.fn(() => ({})) } }));
vi.mock("@stellar/mpp", () => ({ USDC_SAC_TESTNET: "USDC_SAC_TESTNET" }));
vi.mock("dotenv/config", () => ({}));
vi.mock("proper-lockfile", () => ({
  default: { lock: vi.fn(() => Promise.resolve(() => Promise.resolve())) },
}));

const successCharge = async (_webReq: Request) => ({
  status: 200,
  withReceipt: (resp: Response) => resp,
});

let app: Express;
let server: Server;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "careguard-mpp-http-"));
  process.env.DATA_DIR = dataDir;
  process.env.PHARMACY_1_PUBLIC_KEY = "GPUB123TEST";
  process.env.MPP_SECRET_KEY = "test-mpp-secret";
  process.env.PHARMACY_PAYMENT_PORT = "0";

  const mod = await import("../server.ts");
  app = mod.app;
  server = mod.server;
});

beforeEach(() => {
  // The global test setup (tests/setup.ts) wipes process.env.DATA_DIR after every
  // test regardless of file — recreate our fixed temp dir so the already-imported
  // server module (which captured DATA_DIR once at import time) keeps working.
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  mppChargeImpl = async () => ({
    status: 402,
    challenge: {
      headers: new Map([["X-Payment-Required", "1"]]),
      text: async () => JSON.stringify({ requires: "payment" }),
    },
  });
  lastWebReqHeaders = undefined;
});

afterAll(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("POST /pharmacy/order (Issue #790)", () => {
  it("with a settled payment, returns 200 and the order is readable via GET /pharmacy/orders", async () => {
    mppChargeImpl = successCharge;

    const postRes = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Amoxicillin", pharmacy: "Test Pharmacy", amount: 12.5 });

    expect(postRes.status).toBe(200);
    expect(postRes.body.order.id).toMatch(/^order-/);

    const listRes = await request(app).get("/pharmacy/orders");
    expect(listRes.status).toBe(200);
    const found = listRes.body.orders.find((o: any) => o.id === postRes.body.order.id);
    expect(found).toBeDefined();
    expect(found.drug).toBe("Amoxicillin");
  });

  it("rejects a negative amount with 4xx before any charge is attempted", async () => {
    const chargeSpy = vi.fn(successCharge);
    mppChargeImpl = chargeSpy;

    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Amoxicillin", pharmacy: "Test Pharmacy", amount: -5 });

    expect(res.status).toBe(400);
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it("rejects an Infinity amount with 4xx before any charge is attempted", async () => {
    const chargeSpy = vi.fn(successCharge);
    mppChargeImpl = chargeSpy;

    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Amoxicillin", pharmacy: "Test Pharmacy", amount: "Infinity" });

    expect(res.status).toBe(400);
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it("rejects an unbounded (>$10,000) amount with 4xx before any charge is attempted", async () => {
    const chargeSpy = vi.fn(successCharge);
    mppChargeImpl = chargeSpy;

    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Amoxicillin", pharmacy: "Test Pharmacy", amount: 999999 });

    expect(res.status).toBe(400);
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it("returns 503 and persists no order when the MPP facilitator throws", async () => {
    mppChargeImpl = async () => {
      throw new Error("facilitator unreachable");
    };

    const before = await request(app).get("/pharmacy/orders");
    const beforeCount = before.body.orders.length;

    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Ibuprofen", pharmacy: "Test Pharmacy", amount: 5 });

    expect(res.status).toBe(503);

    const after = await request(app).get("/pharmacy/orders");
    expect(after.body.orders.length).toBe(beforeCount);
  });

  it("rejects fields that sanitize to empty with 400", async () => {
    const chargeSpy = vi.fn(successCharge);
    mppChargeImpl = chargeSpy;

    const res = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "????", pharmacy: "CVS", amount: 12.5 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SANITIZED_TEXT");
    expect(res.body.details.field).toBe("drug");
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it("returns a JSON 400 for malformed JSON bodies", async () => {
    const res = await request(app)
      .post("/pharmacy/order")
      .set("Content-Type", "application/json")
      .send("{bad json");

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.error).toBe("Invalid JSON body");
  });

  it("does not forward the caller's Authorization/Cookie headers to the upstream MPP call", async () => {
    mppChargeImpl = successCharge;

    await request(app)
      .post("/pharmacy/order")
      .set("Authorization", "Bearer super-secret-caller-token")
      .set("Cookie", "session=super-secret-session")
      .send({ drug: "Amoxicillin", pharmacy: "Test Pharmacy", amount: 8 });

    expect(lastWebReqHeaders).toBeDefined();
    expect(lastWebReqHeaders!.get("authorization")).toBeNull();
    expect(lastWebReqHeaders!.get("cookie")).toBeNull();
  });
});

describe("GET /ready (Issue #790)", () => {
  it("returns 200 when the order store directory is writable", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
  });

  it("returns 503 when the order store directory is not writable", async () => {
    chmodSync(dataDir, 0o444);
    try {
      const res = await request(app).get("/ready");
      expect(res.status).toBe(503);
    } finally {
      chmodSync(dataDir, 0o755); // restore so afterAll cleanup can remove it
    }
  });
});
