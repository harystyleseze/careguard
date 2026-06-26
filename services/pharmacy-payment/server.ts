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
import { Mppx } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
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
import {
  createFileBackedMppStore,
  loadOrders,
  saveOrder,
} from "./persistence.ts";

const PORT = parseInt(process.env.PHARMACY_PAYMENT_PORT || "3005");
const RECIPIENT = process.env.PHARMACY_1_PUBLIC_KEY;
const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY;
const NETWORK = "stellar:testnet";

if (!RECIPIENT) throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");
if (!MPP_SECRET_KEY) throw new Error("MPP_SECRET_KEY required in .env");

// Order and MPP charge storage (persisted to files)
import { existsSync, mkdirSync } from "fs";

const DATA_DIR = new URL("../../data", import.meta.url).pathname;
const ORDERS_FILE = `${DATA_DIR}/orders.json`;
const MPP_STORE_FILE = `${DATA_DIR}/mpp-store.json`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

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
    network: NETWORK,
    recipient: RECIPIENT,
    currency: USDC_SAC_TESTNET,
  });
});

app.get("/pharmacy/orders", (_req, res) => {
  res.json({ orders: loadOrders(ORDERS_FILE) });
});

// MPP charge server
const mppx = Mppx.create({
  secretKey: MPP_SECRET_KEY,
  methods: [
    stellar.charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      network: NETWORK,
      store: createFileBackedMppStore(MPP_STORE_FILE),
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

  const orderInput = parsedOrder.data as MedicationOrderInput;
  const safeDrug = sanitizeUserString(orderInput.drug);
  const safePharmacy = sanitizeUserString(orderInput.pharmacy);

  // Convert Express request to Web Request for mppx
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
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
  const result = await mppx.charge({
    amount: orderInput.amount.toFixed(2),
    description: `Medication: ${safeDrug} from ${safePharmacy}`,
  })(webReq);

  // 402 = client needs to sign and pay
  if (result.status === 402) {
    const challenge = result.challenge;
    challenge.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    const body = await challenge.text();
    res.status(402).send(body);
    return;
  }

  // Payment verified and settled on Stellar — create order
  const confirmedOrder = {
    id: `order-${Date.now()}`,
    drug: safeDrug,
    pharmacy: safePharmacy,
    amount: orderInput.amount,
    status: "confirmed",
    timestamp: new Date().toISOString(),
    network: NETWORK,
    protocol: "MPP Charge",
  };
  await saveOrder(ORDERS_FILE, confirmedOrder);
  logger.info(
    { orderId: confirmedOrder.id },
    "Order saved successfully with atomic persistence",
  );

  // Return response with payment receipt headers
  const response = result.withReceipt(
    Response.json({
      success: true,
      order: confirmedOrder,
      message: `Payment of $${confirmedOrder.amount} USDC settled on Stellar. ${safeDrug} order from ${safePharmacy} confirmed.`,
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
  res.send("OK");
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, network: NETWORK, recipient: RECIPIENT, currency: USDC_SAC_TESTNET }, "Pharmacy Payment Service (MPP Charge) started");
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Draining server...");
  isDraining = true;
  server.close(() => {
    logger.info("Server closed. Exiting process.");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Graceful shutdown timeout. Forcing exit.");
    process.exit(1);
  }, 30000);
});
