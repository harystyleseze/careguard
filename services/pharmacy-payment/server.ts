/**
 * Pharmacy Payment Service — MPP Charge on Stellar
 *
 * Accepts real medication order payments via MPP (Machine Payments Protocol) charge mode.
 * Every payment settles as a real USDC transfer on Stellar testnet.
 *
 * Flow: Client POST → 402 challenge → Client signs Soroban auth entry → Server broadcasts → Order confirmed
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";

const PORT = parseInt(process.env.PHARMACY_PAYMENT_PORT || "3005");
const RECIPIENT = process.env.PHARMACY_1_PUBLIC_KEY;
const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY;
const NETWORK = "stellar:testnet";

if (!RECIPIENT) throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");
if (!MPP_SECRET_KEY) throw new Error("MPP_SECRET_KEY required in .env");

// Order storage (persisted to file)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

const DATA_DIR = new URL("../../data", import.meta.url).pathname;
const ORDERS_FILE = `${DATA_DIR}/orders.json`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function loadOrders(): any[] {
  if (!existsSync(ORDERS_FILE)) return [];
  return JSON.parse(readFileSync(ORDERS_FILE, "utf-8"));
}

function saveOrder(order: any) {
  const orders = loadOrders();
  orders.push(order);
  writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

const app = express();
app.use(cors());
app.use(express.json());

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
      store: Store.memory(),
    }),
  ],
});

// MPP-protected medication order endpoint
app.post("/pharmacy/order", async (req, res) => {
  const { drug, pharmacy, amount } = req.body;

  if (!drug || !pharmacy || !amount) {
    res.status(400).json({ error: "Missing required fields: drug, pharmacy, amount" });
    return;
  }

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
    amount: parseFloat(amount).toFixed(2),
    description: `Medication: ${drug} from ${pharmacy}`,
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
  const order = {
    id: `order-${Date.now()}`,
    drug,
    pharmacy,
    amount: parseFloat(amount),
    status: "confirmed",
    timestamp: new Date().toISOString(),
    network: NETWORK,
    protocol: "MPP Charge",
  };
  saveOrder(order);

  // Return response with payment receipt headers
  const response = result.withReceipt(
    Response.json({
      success: true,
      order,
      message: `Payment of $${amount} USDC settled on Stellar. ${drug} order from ${pharmacy} confirmed.`,
    })
  );

  response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
  const responseBody = await response.json();
  res.status(response.status).json(responseBody);
});

app.listen(PORT, () => {
  console.log(`\n💰 Pharmacy Payment Service (MPP Charge) running on http://localhost:${PORT}`);
  console.log(`   Protocol: MPP Charge on Stellar`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Recipient: ${RECIPIENT}`);
  console.log(`   Currency: ${USDC_SAC_TESTNET}\n`);
});
