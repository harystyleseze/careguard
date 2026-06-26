/**
 * Pharmacy Payment Service - MPP Charge on Stellar
 *
 * Accepts real medication order payments via MPP (Machine Payments Protocol) charge mode.
 * Every payment settles as a real USDC transfer on Stellar testnet.
 *
 * Flow: Client POST -> 402 challenge -> Client signs Soroban auth entry -> Server broadcasts -> Order confirmed
 */

/// <reference path="../../types/proper-lockfile.d.ts" />

if (!process.stdout.isTTY) {
  process.env.NO_COLOR ??= "1";
  process.env.FORCE_COLOR = "0";
}

import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { Application } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { Server } from "http";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { stellar } from "@stellar/mpp/charge/server";
import { Mppx, Store } from "mppx/server";
import lock from "proper-lockfile";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { logger } from "../../shared/logger.ts";
import { requestContextMiddleware } from "../../shared/request-context.ts";
import { requestLoggerMiddleware } from "../../shared/request-logger.ts";
import { sanitizeUserString } from "../../shared/sanitize.ts";
import {
  MedicationOrderSchema,
  type MedicationOrderInput,
} from "./validation.ts";

const DEFAULT_PORT = parseInt(process.env.PHARMACY_PAYMENT_PORT || "3005", 10);
type StellarMppNetwork = "stellar:testnet" | "stellar:pubnet";

const NETWORK: StellarMppNetwork = "stellar:testnet";
const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
const DEFAULT_ORDERS_FILE = path.join(DEFAULT_DATA_DIR, "orders.json");
const orderSaveQueues = new Map<string, Promise<void>>();

export type PharmacyOrderRecord = {
  id: string;
  drug: string;
  pharmacy: string;
  amount: number;
  status: "confirmed";
  timestamp: string;
  network: string;
  protocol: "MPP Charge";
};

type MppChargeResult = {
  status: number;
  challenge?: Response;
  withReceipt?: (response: Response) => Response;
};

export type MppChargeServer = {
  charge(input: { amount: string; description: string }): (request: Request) => Promise<MppChargeResult>;
};

export type CreatePharmacyPaymentAppOptions = {
  mppx?: MppChargeServer;
  ordersFile?: string;
  port?: number;
  recipient?: string;
  network?: StellarMppNetwork;
  currency?: typeof USDC_SAC_TESTNET;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required in .env`);
  return value;
}

/* v8 ignore start */
function createDefaultMppx(options: {
  recipient: string;
  secretKey: string;
  network: StellarMppNetwork;
  currency: typeof USDC_SAC_TESTNET;
}): MppChargeServer {
  return Mppx.create({
    secretKey: options.secretKey,
    methods: [
      stellar.charge({
        recipient: options.recipient,
        currency: options.currency,
        network: options.network,
        store: Store.memory(),
      }),
    ],
  }) as unknown as MppChargeServer;
}
/* v8 ignore stop */

function ensureOrdersFile(ordersFile: string): void {
  mkdirSync(path.dirname(ordersFile), { recursive: true });
  if (existsSync(ordersFile)) return;

  try {
    writeFileSync(ordersFile, JSON.stringify([]), { flag: "wx" });
  } catch (err: any) {
    if (err?.code !== "EEXIST") throw err;
  }
}

export function loadOrders(ordersFile = DEFAULT_ORDERS_FILE): PharmacyOrderRecord[] {
  if (!existsSync(ordersFile)) return [];
  const content = readFileSync(ordersFile, "utf-8").trim();
  if (!content) return [];
  return JSON.parse(content);
}

/**
 * Save a new order to the orders file with file-level locking to prevent race conditions.
 * Ensures that concurrent calls do not lose data due to simultaneous read-modify-write operations.
 *
 * Trade-off: File-based locking is slower than in-memory storage but is sufficient for the demo.
 * For production, consider switching to SQLite (#168) or a proper database.
 */
export async function saveOrder(order: PharmacyOrderRecord, ordersFile = DEFAULT_ORDERS_FILE): Promise<void> {
  const previousSave = orderSaveQueues.get(ordersFile) ?? Promise.resolve();
  const nextSave = previousSave
    .catch(() => undefined)
    .then(() => saveOrderWithLock(order, ordersFile));

  orderSaveQueues.set(ordersFile, nextSave);

  try {
    await nextSave;
  } finally {
    if (orderSaveQueues.get(ordersFile) === nextSave) {
      orderSaveQueues.delete(ordersFile);
    }
  }
}

async function saveOrderWithLock(order: PharmacyOrderRecord, ordersFile: string): Promise<void> {
  ensureOrdersFile(ordersFile);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock.lock(ordersFile, { retries: 100, stale: 5000 });

    const orders = loadOrders(ordersFile);
    orders.push(order);
    writeFileSync(ordersFile, JSON.stringify(orders, null, 2));

    logger.info({ orderId: order.id }, "Order saved successfully with lock");
  } catch (err: any) {
    logger.error({ err: err.message, orderId: order.id }, "Failed to save order");
    throw err;
  } finally {
    if (release) {
      try {
        await release();
      } catch (err: any) {
        logger.warn({ err: err.message }, "Failed to release file lock");
      }
    }
  }
}

export function createPharmacyPaymentApp(options: CreatePharmacyPaymentAppOptions = {}): Application {
  const port = options.port ?? DEFAULT_PORT;
  const network = options.network ?? NETWORK;
  const currency = options.currency ?? USDC_SAC_TESTNET;
  const runtimeRecipient = options.recipient ?? process.env.PHARMACY_1_PUBLIC_KEY;
  const ordersFile = options.ordersFile ?? DEFAULT_ORDERS_FILE;
  const mppxServer =
    options.mppx ??
    createDefaultMppx({
      recipient: runtimeRecipient ?? requireEnv("PHARMACY_1_PUBLIC_KEY"),
      secretKey: requireEnv("MPP_SECRET_KEY"),
      network,
      currency,
    });

  const app = express();
  applySecurityMiddleware(app);
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "20kb" }));
  app.use(requestContextMiddleware());
  app.use(requestLoggerMiddleware());

  app.get("/", (_req, res) => {
    res.json({
      service: "CareGuard Pharmacy Payment Service",
      version: "1.0.0",
      protocol: "MPP Charge on Stellar",
      network,
      recipient: runtimeRecipient ?? "",
      currency,
    });
  });

  app.get("/pharmacy/orders", (_req, res) => {
    res.json({ orders: loadOrders(ordersFile) });
  });

  app.post("/pharmacy/order", async (req, res) => {
    const parsedOrder = MedicationOrderSchema.safeParse(req.body);
    if (!parsedOrder.success) {
      res.status(400).json({
        error: "Invalid order request",
        details: parsedOrder.error.issues.map((issue) => issue.message),
      });
      return;
    }

    const orderInput = parsedOrder.data as MedicationOrderInput;
    const safeDrug = sanitizeUserString(orderInput.drug);
    const safePharmacy = sanitizeUserString(orderInput.pharmacy);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const entry of value) headers.append(key, entry);
      } else {
        headers.set(key, value);
      }
    }

    const webReq = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers,
    });

    const result = await mppxServer.charge({
      amount: orderInput.amount.toFixed(2),
      description: `Medication: ${safeDrug} from ${safePharmacy}`,
    })(webReq);

    if (result.status === 402) {
      if (!result.challenge) throw new Error("MPP charge returned 402 without a challenge");
      result.challenge.headers.forEach((value: string, key: string) => res.setHeader(key, value));
      const body = await result.challenge.text();
      res.status(402).send(body);
      return;
    }

    if (!result.withReceipt) throw new Error("MPP charge result did not include a receipt builder");

    const confirmedOrder: PharmacyOrderRecord = {
      id: `order-${Date.now()}-${randomUUID()}`,
      drug: safeDrug,
      pharmacy: safePharmacy,
      amount: orderInput.amount,
      status: "confirmed",
      timestamp: new Date().toISOString(),
      network,
      protocol: "MPP Charge",
    };
    await saveOrder(confirmedOrder, ordersFile);

    const response = result.withReceipt(
      Response.json({
        success: true,
        order: confirmedOrder,
        message: `Payment of $${confirmedOrder.amount} USDC settled on Stellar. ${safeDrug} order from ${safePharmacy} confirmed.`,
      }),
    );

    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    const responseBody = await response.json();
    res.status(response.status).json(responseBody);
  });

  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body too large", limit: err.limit });
    }
    next(err);
  });

  let isDraining = false;
  app.get("/ready", (_req, res) => {
    if (isDraining) {
      res.status(503).send("Service Unavailable");
      return;
    }
    res.send("OK");
  });

  app.locals.startDraining = () => {
    isDraining = true;
  };

  return app;
}

export function startPharmacyPaymentServer(options: CreatePharmacyPaymentAppOptions = {}): Server {
  const port = options.port ?? DEFAULT_PORT;
  const app = createPharmacyPaymentApp({ ...options, port });
  const server = app.listen(port, () => {
    logger.info(
      {
        port,
        network: options.network ?? NETWORK,
        recipient: options.recipient ?? process.env.PHARMACY_1_PUBLIC_KEY,
        currency: options.currency ?? USDC_SAC_TESTNET,
      },
      "Pharmacy Payment Service (MPP Charge) started",
    );
  });

  /* v8 ignore start */
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received. Draining server...");
    app.locals.startDraining();
    server.close(() => {
      logger.info("Server closed. Exiting process.");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Graceful shutdown timeout. Forcing exit.");
      process.exit(1);
    }, 30000);
  });
  /* v8 ignore stop */

  return server;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

/* v8 ignore start */
if (isMainModule()) {
  startPharmacyPaymentServer();
}
/* v8 ignore stop */
