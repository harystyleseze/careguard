import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPharmacyPaymentApp,
  loadOrders,
  startPharmacyPaymentServer,
  type MppChargeServer,
  type PharmacyOrderRecord,
} from "../server.ts";

const validOrder = {
  drug: "Atorvastatin",
  pharmacy: "CarePlus",
  amount: 12.34,
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

function setupApp(mppx: MppChargeServer) {
  const ordersFile = createTempOrdersPath();
  const app = createPharmacyPaymentApp({
    mppx,
    ordersFile,
    recipient: "GTESTRECIPIENT",
    port: 3305,
  });

  return { app, ordersFile };
}

function createTempOrdersPath() {
  const dir = mkdtempSync(path.join(tmpdir(), "careguard-pharmacy-payment-"));
  tempDirs.push(dir);
  return path.join(dir, "orders.json");
}

function readOrders(ordersFile: string): PharmacyOrderRecord[] {
  return JSON.parse(readFileSync(ordersFile, "utf-8"));
}

function createChallengeMppx() {
  const charge = vi.fn((input: { amount: string; description: string }) => {
    return vi.fn(async (_request: Request) => ({
      status: 402,
      challenge: new Response(JSON.stringify({ challenge: "sign-this-payment" }), {
        status: 402,
        headers: {
          "www-authenticate": "MPP challenge=sign-this-payment",
          "x-mpp-challenge": "sign-this-payment",
        },
      }),
      input,
    }));
  });

  return { charge } as unknown as MppChargeServer & { charge: typeof charge };
}

function createSuccessMppx(receipt = "stellar-receipt-abc") {
  const charge = vi.fn((_input: { amount: string; description: string }) => {
    return vi.fn(async (_request: Request) => ({
      status: 200,
      withReceipt(response: Response) {
        response.headers.set("PAYMENT-RESPONSE", receipt);
        response.headers.set("x-mpp-receipt", "settled");
        return response;
      },
    }));
  });

  return { charge } as unknown as MppChargeServer & { charge: typeof charge };
}

describe("pharmacy payment server", () => {
  it("returns the MPP 402 challenge body and headers before payment", async () => {
    const mppx = createChallengeMppx();
    const { app } = setupApp(mppx);

    const response = await request(app).post("/pharmacy/order").send(validOrder);

    expect(response.status).toBe(402);
    expect(response.text).toBe(JSON.stringify({ challenge: "sign-this-payment" }));
    expect(response.headers["www-authenticate"]).toBe("MPP challenge=sign-this-payment");
    expect(response.headers["x-mpp-challenge"]).toBe("sign-this-payment");
    expect(mppx.charge).toHaveBeenCalledWith({
      amount: "12.34",
      description: "Medication: Atorvastatin from CarePlus",
    });
  });

  it("persists a confirmed order and echoes receipt headers after valid payment", async () => {
    const mppx = createSuccessMppx("stellar-receipt-success");
    const { app, ordersFile } = setupApp(mppx);

    const response = await request(app).post("/pharmacy/order").send({
      drug: "Metformin",
      pharmacy: "Health Hub",
      amount: "20.50",
    });

    expect(response.status).toBe(200);
    expect(response.headers["payment-response"]).toBe("stellar-receipt-success");
    expect(response.headers["x-mpp-receipt"]).toBe("settled");
    expect(response.body).toMatchObject({
      success: true,
      order: {
        drug: "Metformin",
        pharmacy: "Health Hub",
        amount: 20.5,
        status: "confirmed",
        network: "stellar:testnet",
        protocol: "MPP Charge",
      },
    });

    const orders = readOrders(ordersFile);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject(response.body.order);
  });

  it.each([
    ["drug", { pharmacy: "CarePlus", amount: 12.34 }],
    ["pharmacy", { drug: "Atorvastatin", amount: 12.34 }],
    ["amount", { drug: "Atorvastatin", pharmacy: "CarePlus" }],
  ])("returns 400 when %s is missing", async (_field, body) => {
    const mppx = createSuccessMppx();
    const { app } = setupApp(mppx);

    const response = await request(app).post("/pharmacy/order").send(body);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid order request");
    expect(response.body.details.length).toBeGreaterThan(0);
    expect(mppx.charge).not.toHaveBeenCalled();
  });

  it("persists all orders from 50 parallel successful payment requests", async () => {
    const mppx = createSuccessMppx();
    const { app, ordersFile } = setupApp(mppx);

    const responses = await Promise.all(
      Array.from({ length: 50 }, (_value, index) =>
        request(app)
          .post("/pharmacy/order")
          .send({
            drug: `Drug ${index}`,
            pharmacy: `Pharmacy ${index % 5}`,
            amount: 1 + index / 100,
          }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(50).fill(200));

    const orders = readOrders(ordersFile);
    expect(orders).toHaveLength(50);
    expect(new Set(orders.map((order) => order.id)).size).toBe(50);
    expect(orders.map((order) => order.amount).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_value, index) => 1 + index / 100),
    );
  }, 30000);

  it("returns the persisted order list", async () => {
    const mppx = createSuccessMppx();
    const { app, ordersFile } = setupApp(mppx);
    const seedOrders: PharmacyOrderRecord[] = [
      {
        id: "order-seed",
        drug: "Lisinopril",
        pharmacy: "CarePlus",
        amount: 7.25,
        status: "confirmed",
        timestamp: "2026-06-26T00:00:00.000Z",
        network: "stellar:testnet",
        protocol: "MPP Charge",
      },
    ];
    writeFileSync(ordersFile, JSON.stringify(seedOrders));

    const response = await request(app).get("/pharmacy/orders");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ orders: seedOrders });
  });

  it("returns an empty order list for missing and empty order files", () => {
    const ordersFile = createTempOrdersPath();

    expect(loadOrders(ordersFile)).toEqual([]);

    writeFileSync(ordersFile, "");

    expect(loadOrders(ordersFile)).toEqual([]);
  });

  it("returns 413 when the JSON body exceeds the configured limit", async () => {
    const originalLimit = process.env.JSON_BODY_LIMIT;
    process.env.JSON_BODY_LIMIT = "8b";

    try {
      const mppx = createSuccessMppx();
      const { app } = setupApp(mppx);

      const response = await request(app).post("/pharmacy/order").send(validOrder);

      expect(response.status).toBe(413);
      expect(response.body.error).toBe("Request body too large");
      expect(mppx.charge).not.toHaveBeenCalled();
    } finally {
      if (originalLimit === undefined) {
        delete process.env.JSON_BODY_LIMIT;
      } else {
        process.env.JSON_BODY_LIMIT = originalLimit;
      }
    }
  });

  it("passes unexpected payment errors to Express error handling", async () => {
    const charge = vi.fn(() => {
      return vi.fn(async () => ({
        status: 402,
      }));
    });
    const { app } = setupApp({ charge } as unknown as MppChargeServer);

    const response = await request(app).post("/pharmacy/order").send(validOrder);

    expect(response.status).toBe(500);
    expect(charge).toHaveBeenCalledOnce();
  });

  it("requires Stellar MPP environment variables when no payment server is injected", () => {
    const originalRecipient = process.env.PHARMACY_1_PUBLIC_KEY;
    const originalSecret = process.env.MPP_SECRET_KEY;
    delete process.env.PHARMACY_1_PUBLIC_KEY;
    delete process.env.MPP_SECRET_KEY;

    try {
      expect(() => createPharmacyPaymentApp()).toThrow("PHARMACY_1_PUBLIC_KEY required in .env");
    } finally {
      if (originalRecipient === undefined) {
        delete process.env.PHARMACY_1_PUBLIC_KEY;
      } else {
        process.env.PHARMACY_1_PUBLIC_KEY = originalRecipient;
      }

      if (originalSecret === undefined) {
        delete process.env.MPP_SECRET_KEY;
      } else {
        process.env.MPP_SECRET_KEY = originalSecret;
      }
    }
  });

  it("starts and closes an HTTP server with injected payment dependencies", async () => {
    const server = startPharmacyPaymentServer({
      mppx: createSuccessMppx(),
      ordersFile: createTempOrdersPath(),
      recipient: "GTESTRECIPIENT",
      port: 0,
    });

    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", resolve);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const address = server.address();
    expect(address).toBeTruthy();
    expect(typeof address === "object" && address !== null ? address.port : undefined).toBeGreaterThan(0);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it("serves metadata and readiness for the isolated test app", async () => {
    const mppx = createSuccessMppx();
    const { app } = setupApp(mppx);

    await expect(request(app).get("/")).resolves.toMatchObject({
      status: 200,
      body: {
        service: "CareGuard Pharmacy Payment Service",
        protocol: "MPP Charge on Stellar",
        recipient: "GTESTRECIPIENT",
      },
    });

    await expect(request(app).get("/ready")).resolves.toMatchObject({
      status: 200,
      text: "OK",
    });

    app.locals.startDraining();

    await expect(request(app).get("/ready")).resolves.toMatchObject({
      status: 503,
      text: "Service Unavailable",
    });
  });
});
