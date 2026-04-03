/**
 * Pharmacy Price Comparison API — x402-protected on Stellar
 *
 * Every query requires a real x402 payment in USDC via the OZ Facilitator on Stellar testnet.
 * GET /pharmacy/compare?drug=Lisinopril&zip=90210 — $0.002 per query
 *
 * Pricing reference database based on real-world pharmacy pricing patterns (GoodRx, CostcoRx).
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const PORT = parseInt(process.env.PHARMACY_API_PORT || "3001");
const PAY_TO = process.env.PHARMACY_1_PUBLIC_KEY;
const OZ_API_KEY = process.env.OZ_FACILITATOR_API_KEY;
const OZ_FACILITATOR_URL = "https://channels.openzeppelin.com/x402/testnet";
const NETWORK = "stellar:testnet";

if (!PAY_TO) throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");
if (!OZ_API_KEY) throw new Error("OZ_FACILITATOR_API_KEY required in .env");

// Reference pricing database — based on real-world pharmacy pricing patterns
// Source: GoodRx average cash prices, CostcoRx member pricing (Q1 2026)
const PRICING_DATABASE: Record<string, Array<{ pharmacy: string; id: string; price: number; distance: string }>> = {
  lisinopril: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 3.50, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 12.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 15.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 18.99, distance: "3.2 mi" },
  ],
  metformin: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.00, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 11.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 13.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 16.79, distance: "3.2 mi" },
  ],
  atorvastatin: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 6.50, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 9.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 24.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 28.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 31.99, distance: "3.2 mi" },
  ],
  amlodipine: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.20, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 14.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 17.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 19.99, distance: "3.2 mi" },
  ],
  omeprazole: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 5.80, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 8.50, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 22.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 25.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 27.99, distance: "3.2 mi" },
  ],
};

const app = express();
app.use(cors());
app.use(express.json());

// Service info (unprotected)
app.get("/", (_req, res) => {
  res.json({
    service: "CareGuard Pharmacy Price Comparison API",
    version: "1.0.0",
    protocol: "x402 on Stellar",
    network: NETWORK,
    facilitator: OZ_FACILITATOR_URL,
    payTo: PAY_TO,
    price: "$0.002 per query",
    drugs: Object.keys(PRICING_DATABASE),
  });
});

app.get("/pharmacy/drugs", (_req, res) => {
  res.json({ drugs: Object.keys(PRICING_DATABASE), count: Object.keys(PRICING_DATABASE).length });
});

// x402 payment middleware — real OZ facilitator on Stellar testnet
const facilitator = new HTTPFacilitatorClient({
  url: OZ_FACILITATOR_URL,
  createAuthHeaders: async () => {
    const headers = { Authorization: `Bearer ${OZ_API_KEY}` };
    return { verify: headers, settle: headers, supported: headers };
  },
});

const routes = {
  "GET /pharmacy/compare": {
    accepts: {
      scheme: "exact",
      network: NETWORK as `${string}:${string}`,
      payTo: PAY_TO,
      price: "$0.002",
    },
    description: "Pharmacy price comparison query — $0.002 USDC",
  },
};

app.use(
  paymentMiddlewareFromConfig(
    routes,
    facilitator,
    [{ network: NETWORK as `${string}:${string}`, server: new ExactStellarScheme() }]
  )
);

// x402-protected endpoint — payment required to access
app.get("/pharmacy/compare", (req, res) => {
  const drug = (req.query.drug as string || "").toLowerCase().trim();
  const zip = req.query.zip as string || "90210";

  if (!drug) { res.status(400).json({ error: "Missing required parameter: drug" }); return; }

  const prices = PRICING_DATABASE[drug];
  if (!prices) { res.status(404).json({ error: `Drug "${drug}" not found`, available: Object.keys(PRICING_DATABASE) }); return; }

  const sorted = [...prices].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0];
  const mostExpensive = sorted[sorted.length - 1];

  res.json({
    drug: drug.charAt(0).toUpperCase() + drug.slice(1),
    zipCode: zip,
    queryTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network: NETWORK, price: "$0.002", payTo: PAY_TO },
    prices: sorted.map((p) => ({
      pharmacyName: p.pharmacy, pharmacyId: p.id, price: p.price, distance: p.distance, inStock: true,
    })),
    cheapest: { pharmacyName: cheapest.pharmacy, pharmacyId: cheapest.id, price: cheapest.price, distance: cheapest.distance },
    mostExpensive: { pharmacyName: mostExpensive.pharmacy, pharmacyId: mostExpensive.id, price: mostExpensive.price },
    potentialSavings: +(mostExpensive.price - cheapest.price).toFixed(2),
    savingsPercent: +((1 - cheapest.price / mostExpensive.price) * 100).toFixed(1),
  });
});

app.listen(PORT, () => {
  console.log(`\n💊 Pharmacy Price API running on http://localhost:${PORT}`);
  console.log(`   x402 payment: REQUIRED (${NETWORK})`);
  console.log(`   Facilitator: ${OZ_FACILITATOR_URL}`);
  console.log(`   Pay-to: ${PAY_TO}`);
  console.log(`   Available drugs: ${Object.keys(PRICING_DATABASE).join(", ")}\n`);
});
