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
import express from "express";
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { logger } from "../../shared/logger.ts";
import { requireApiKey } from "../../shared/auth.ts";
import { requestLifecycleMiddleware } from "../../shared/request-lifecycle.ts";
import { gracefulShutdown } from "../../shared/graceful-shutdown.ts";
import { sanitizeUserString } from "../../shared/sanitize.ts";
import {
  MedicationOrderSchema,
  type MedicationOrderInput,
} from "./validation.ts";

const PORT = parseInt(process.env.PHARMACY_PAYMENT_PORT || "3005", 10);
const RECIPIENT = process.env.PHARMACY_1_PUBLIC_KEY;
const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY;
const NETWORK = "stellar:testnet";

if (!RECIPIENT) throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");
if (!MPP_SECRET_KEY) throw new Error("MPP_SECRET_KEY required in .env");

// Order storage (persisted to file)
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, accessSync, constants as fsConstants } from "fs";
import lock from "proper-lockfile";

const DATA_DIR = process.env.DATA_DIR || new URL("../../data", import.meta.url).pathname;
const ORDERS_FILE = `${DATA_DIR}/orders.json`;
const MPP_STORE_FILE = `${DATA_DIR}/mpp-store.json`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function createMppStore(filePath: string) {
  const storeFactory = Store as typeof Store & {
    fileSystem?: (path: string) => ReturnType<typeof Store.memory>;
  };
  return storeFactory.fileSystem?.(filePath) ?? Store.memory();
}

function loadOrders(): any[] {
  if (!existsSync(ORDERS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(ORDERS_FILE, "utf-8"));
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
async function saveOrder(order: any) {
  let release: any;
  try {
    // Acquire exclusive lock on the orders file
    release = await lock.lock(ORDERS_FILE, { retries: 10, stale: 5000 });

    // Safe read-modify-write within lock, using atomic writes
    const orders = loadOrders();
    orders.push(order);
    const tempFile = `${ORDERS_FILE}.tmp-${Date.now()}`;
    try {
      writeFileSync(tempFile, JSON.stringify(orders, null, 2), 'utf-8');
      renameSync(tempFile, ORDERS_FILE);
    } catch (err) {
      try { writeFileSync(ORDERS_FILE, '', 'utf-8'); } catch {}
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

export const app = express();
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
    recipient: RECIPIENT,
    currency: USDC_SAC_TESTNET,
  });
});

app.get("/pharmacy/orders", requireApiKey, (_req, res) => {
  res.json({ orders: loadOrders() });
});

// MPP charge server
const mppx = Mppx.create({
  secretKey: MPP_SECRET_KEY,
  methods: [
    stellar.charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      network: NETWORK,
      store: createMppStore(MPP_STORE_FILE),
    }),
  ],
});

// MPP-protected medication order endpoint
app.post("/pharmacy/order", async (req, res) => {
  const parsedOrder = MedicationOrderSchema.safeParse(req.body);
  if (!parsedOrder.success) {
    res.status(400).json({
      error: "Invalid order request",
      details: parsedOrder.error.issues.map((issue) => issue.message),
    });
    return;
  }

  const order = parsedOrder.data as MedicationOrderInput;
  const safeDrug = sanitizeUserString(order.drug);
  const safePharmacy = sanitizeUserString(order.pharmacy);

  // Convert Express request to Web Request for mppx. Never forward the
  // caller's own auth/session headers into the upstream MPP charge call —
  // mppx only needs the payment-protocol headers (e.g. X-Payment).
  const FORWARD_HEADER_BLOCKLIST = new Set(["authorization", "cookie"]);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (FORWARD_HEADER_BLOCKLIST.has(key.toLowerCase())) continue;
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
  try {
    accessSync(DATA_DIR, fsConstants.W_OK);
  } catch {
    res.status(503).json({ error: "Order store is not writable" });
    return;
  }
  res.send("OK");
});

export const server = app.listen(PORT, () => {
  logger.info({ port: PORT, network: NETWORK, recipient: RECIPIENT, currency: USDC_SAC_TESTNET }, "Pharmacy Payment Service (MPP Charge) started");
});

gracefulShutdown({ server, onDrainStart: () => { isDraining = true; } });
