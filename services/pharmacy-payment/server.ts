/**
 * Pharmacy Payment Service — MPP Charge on Stellar
 *
 * Accepts real medication order payments via MPP (Machine Payments Protocol) charge mode.
 * Every payment settles as a real USDC transfer on Stellar testnet.
 *
 * Flow: Client POST → 402 challenge → Client signs Soroban auth entry → Server broadcasts → Order confirmed
 */

if (!process.stdout.isTTY) {
  process.env.NO_COLOR ??= "1";
  process.env.FORCE_COLOR = "0";
}

import "dotenv/config";
import path from "path";
import { pathToFileURL } from "url";
import express from "express";
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { logger } from "../../shared/logger.ts";
import { requestLifecycleMiddleware } from "../../shared/request-lifecycle.ts";
import { gracefulShutdown } from "../../shared/graceful-shutdown.ts";
import { sanitizeUserString } from "../../shared/sanitize.ts";
import {
  concurrentRequestsMiddleware,
  perRouteLimiters,
} from "../../shared/rate-limit.ts";
import {
  MedicationOrderSchema,
  isKnownDrugPharmacyPair,
  type MedicationOrderInput,
} from "./validation.ts";
import {
  metricsHandler,
  pharmacyPaymentOrdersTotal,
  pharmacyMppChargesTotal,
  paymentsUsdcTotal,
  stellarTxSubmittedTotal,
} from "../../shared/metrics.ts";

const PORT = parseInt(process.env.PHARMACY_PAYMENT_PORT || "3005", 10);
const NETWORK = "stellar:testnet";

function validateStartup() {
  const recipient = process.env.PHARMACY_1_PUBLIC_KEY;
  const mppSecretKey = process.env.MPP_SECRET_KEY;
  if (!recipient) throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");
  if (!mppSecretKey) throw new Error("MPP_SECRET_KEY required in .env");
  return { recipient, mppSecretKey };
}

// Order storage (persisted to file)
import { existsSync, mkdirSync, accessSync, constants as fsConstants } from "fs";
import { readFile, writeFile, rename, unlink } from "fs/promises";
import lock from "proper-lockfile";
import { getDataDir } from "../../shared/paths.ts";

const DATA_DIR = getDataDir();
const ORDERS_FILE = `${DATA_DIR}/orders.json`;
const MPP_STORE_FILE = `${DATA_DIR}/mpp-store.json`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function createMppStore(filePath: string) {
  const storeFactory = Store as typeof Store & {
    fileSystem?: (path: string) => ReturnType<typeof Store.memory>;
  };
  return storeFactory.fileSystem?.(filePath) ?? Store.memory();
}

export async function loadOrders(): Promise<any[]> {
  if (!existsSync(ORDERS_FILE)) return [];
  try {
    return JSON.parse(await readFile(ORDERS_FILE, "utf-8"));
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to parse orders file, starting with empty array');
    return [];
  }
}

/**
 * Save a new order to the orders file with file-level locking to prevent race conditions.
 * Uses atomic writes (temp file + rename) to ensure reads always see consistent state (Issue #203).
 * Ensures that concurrent calls don't lose data due to simultaneous read-modify-write operations.
 *
 * Trade-off: File-based locking is slower than in-memory storage but is sufficient for the demo.
 * For production, consider switching to SQLite (#168) or a proper database.
 */
export async function saveOrder(order: any) {
  let release: any;
  try {
    // Acquire exclusive lock on the orders file
    release = await lock.lock(ORDERS_FILE, { retries: 10, stale: 5000 });

    // Safe read-modify-write within lock, using atomic writes
    const orders = await loadOrders();
    orders.push(order);
    const tempFile = `${ORDERS_FILE}.tmp-${Date.now()}`;
    try {
      await writeFile(tempFile, JSON.stringify(orders, null, 2), 'utf-8');
      await rename(tempFile, ORDERS_FILE);
    } catch (err) {
      try { await unlink(tempFile); } catch {}
      throw err;
    }

    logger.info({ orderId: order.id || 'unknown' }, 'Order saved successfully with atomic write and lock');
  } catch (err: any) {
    logger.error({ err: err.message, orderId: order.id || 'unknown' }, 'Failed to save order');
    throw err;
  } finally {
    // Always release the lock
    if (release) {
      try {
        await release();
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Failed to release file lock');
      }
    }
  }
}

function createPharmacyPaymentApp(recipient: string, mppSecretKey: string) {
  const app = express();
  applySecurityMiddleware(app);
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "20kb" }));
  app.use(requestLifecycleMiddleware());

  app.get("/", (_req, res) => {
    res.json({
      service: "CareGuard Pharmacy Payment Service",
      version: "1.0.0",
      protocol: "MPP Charge on Stellar",
      network: NETWORK,
      recipient,
      currency: USDC_SAC_TESTNET,
    });
  });

  app.get("/pharmacy/orders", async (_req, res, next) => {
    try {
      res.json({ orders: await loadOrders() });
    } catch (err) {
      next(err);
    }
  });

  // GET /metrics endpoint for Prometheus instrumentation (Issue #1015)
  app.get("/metrics", metricsHandler());

  // MPP charge server
  const mppx = Mppx.create({
    secretKey: mppSecretKey,
    methods: [
      stellar.charge({
        recipient,
        currency: USDC_SAC_TESTNET,
        network: NETWORK,
        store: createMppStore(MPP_STORE_FILE),
      }),
    ],
  });

  // MPP-protected medication order endpoint
  app.post(
    "/pharmacy/order",
    perRouteLimiters.pharmacyOrder,
    concurrentRequestsMiddleware("pharmacy_order"),
    async (req, res) => {
      const parsedOrder = MedicationOrderSchema.safeParse(req.body);
      if (!parsedOrder.success) {
        res.status(400).json({
          error: "Invalid order request",
          details: parsedOrder.error.issues.map((issue) => issue.message),
        });
        return;
      }

      const order = parsedOrder.data as MedicationOrderInput;

      // Reject orders for drugs/pharmacies that do not exist in the catalog
      // before any payment flow is initiated (Issue #927).
      if (!isKnownDrugPharmacyPair(order.drug, order.pharmacy)) {
        res.status(400).json({
          error: "Unknown drug or pharmacy",
          code: "UNKNOWN_DRUG_PHARMACY_PAIR",
        });
        return;
      }

      const safeDrug = sanitizeUserString(order.drug);
      const safePharmacy = sanitizeUserString(order.pharmacy);

      // Convert Express request to Web Request for mppx.
      // Only forward the headers mppx.charge() actually requires:
      //   X-Payment  — the signed payment receipt from the client's x402 wallet
      //   Content-Type — needed so mppx can decode the request body
      //   Accept       — lets mppx negotiate the response format
      // Every other caller header (Host, Authorization, Cookie, X-Forwarded-*,
      // custom headers) is intentionally excluded to prevent header injection
      // into the internal charge call.
      const MPP_FORWARD_HEADER_ALLOWLIST = new Set(["x-payment", "content-type", "accept"]);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        if (!MPP_FORWARD_HEADER_ALLOWLIST.has(key.toLowerCase())) continue;
        if (Array.isArray(value)) {
          for (const entry of value) headers.append(key, entry);
        } else {
          headers.set(key, value);
        }
      }

      const webReq = new Request(`http://localhost:${PORT}${req.url}`, {
        method: req.method,
        headers,
      });

      // Run MPP charge flow
      let result;
      try {
        result = await mppx.charge({
          amount: Number(order.amount).toFixed(2),
          description: `Medication: ${safeDrug} from ${safePharmacy}`,
        })(webReq);
      } catch (err: any) {
        logger.error({ err: err?.message }, "MPP charge flow failed — facilitator unavailable");
        res.status(503).json({ error: "Payment facilitator unavailable, try again shortly" });
        return;
      }

      // 402 = client needs to sign and pay
      if (result.status === 402) {
        const challenge = result.challenge;
        challenge.headers.forEach((value: string, key: string) => res.setHeader(key, value));
        const body = await challenge.text();
        res.status(402).send(body);
        return;
      }

      // Payment verified and settled on Stellar — create order
      const newOrder = {
        id: `order-${Date.now()}`,
        drug: safeDrug,
        pharmacy: safePharmacy,
        amount: Number(order.amount),
        status: "confirmed",
        timestamp: new Date().toISOString(),
        network: NETWORK,
        protocol: "MPP Charge",
      };
      await saveOrder(newOrder);

      // Return response with payment receipt headers
      const response = result.withReceipt(
        Response.json({
          success: true,
          order: newOrder,
          message: `Payment of $${newOrder.amount} USDC settled on Stellar. ${safeDrug} order from ${safePharmacy} confirmed.`,
        })
      );

      response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
      const responseBody = await response.json();
      res.status(response.status).json(responseBody);
    },
  );

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
    try {
      accessSync(DATA_DIR, fsConstants.W_OK);
    } catch {
      res.status(503).json({ error: "Order store is not writable" });
      return;
    }
    res.send("OK");
  });

  return { app, setDraining: (draining: boolean) => { isDraining = draining; } };
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

let appInstance: ReturnType<typeof createPharmacyPaymentApp> | undefined;

export function getApp() {
  if (appInstance === undefined) {
    throw new Error("Pharmacy Payment app not initialized. Must call from entrypoint.");
  }
  return appInstance.app;
}

export let server: ReturnType<typeof express().listen> | undefined;

if (import.meta.url === entrypointUrl) {
  const { recipient, mppSecretKey } = validateStartup();
  appInstance = createPharmacyPaymentApp(recipient, mppSecretKey);
  server = appInstance.app.listen(PORT, () => {
    logger.info({ port: PORT, network: NETWORK, recipient, currency: USDC_SAC_TESTNET }, "Pharmacy Payment Service (MPP Charge) started");
  });

  gracefulShutdown({ server, onDrainStart: () => { appInstance?.setDraining(true); } });
}
