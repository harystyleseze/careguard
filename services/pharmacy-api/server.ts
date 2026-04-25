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
import { applyX402Middleware, NETWORK, OZ_FACILITATOR_URL } from "../../shared/x402-middleware.ts";
import { createPricingProvider } from "../../shared/pricing-sources.ts";

const PORT = parseInt(process.env.PHARMACY_API_PORT || "3001");
const PAY_TO = process.env.PHARMACY_1_PUBLIC_KEY;

if (!PAY_TO) throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");

// Initialize pricing provider (configurable via PHARMACY_PRICING_PROVIDER env var)
const pricingProvider = createPricingProvider();

const app = express();
app.use(cors());
app.use(express.json());

// Unprotected endpoints
app.get("/", async (_req, res) => {
  const drugCount = await pricingProvider.getDrugCount();
  res.json({
    service: "CareGuard Pharmacy Price Comparison API",
    version: "1.0.0",
    protocol: "x402 on Stellar",
    network: NETWORK,
    facilitator: OZ_FACILITATOR_URL,
    payTo: PAY_TO,
    price: "$0.002 per query",
    pricingProvider: pricingProvider.name,
    drugCount,
  });
});

app.get("/pharmacy/drugs", async (_req, res) => {
  const drugCount = await pricingProvider.getDrugCount();
  res.json({ 
    provider: pricingProvider.name,
    count: drugCount,
    message: "Use GET /pharmacy/compare?drug=<name>&zip=<code> to query prices"
  });
});

// x402 payment middleware
applyX402Middleware(app, {
  "GET /pharmacy/compare": {
    accepts: { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.002" },
    description: "Pharmacy price comparison query — $0.002 USDC",
  },
});

// x402-protected endpoint
app.get("/pharmacy/compare", async (req, res) => {
  const drug = (req.query.drug as string || "").toLowerCase().trim();
  const zip = req.query.zip as string || "90210";

  if (!drug) { res.status(400).json({ error: "Missing required parameter: drug" }); return; }

  try {
    const prices = await pricingProvider.getPrices(drug, zip);
    
    const sorted = [...prices].sort((a, b) => a.price - b.price);
    const cheapest = sorted[0];
    const mostExpensive = sorted[sorted.length - 1];

    res.json({
      drug: drug.charAt(0).toUpperCase() + drug.slice(1),
      zipCode: zip,
      queryTimestamp: new Date().toISOString(),
      protocol: { name: "x402", network: NETWORK, price: "$0.002", payTo: PAY_TO },
      provider: pricingProvider.name,
      prices: sorted.map((p) => ({
        pharmacyName: p.pharmacy, pharmacyId: p.id, price: p.price, distance: p.distance, inStock: true,
      })),
      cheapest: { pharmacyName: cheapest.pharmacy, pharmacyId: cheapest.id, price: cheapest.price, distance: cheapest.distance },
      mostExpensive: { pharmacyName: mostExpensive.pharmacy, pharmacyId: mostExpensive.id, price: mostExpensive.price },
      potentialSavings: +(mostExpensive.price - cheapest.price).toFixed(2),
      savingsPercent: +((1 - cheapest.price / mostExpensive.price) * 100).toFixed(1),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(404).json({ 
      error: errorMessage,
      provider: pricingProvider.name,
      drugCount: await pricingProvider.getDrugCount()
    });
  }
});

export { app, pricingProvider };

export const server = app.listen(PORT, async () => {
  const drugCount = await pricingProvider.getDrugCount();
  console.log(`\n💊 Pharmacy Price API running on http://localhost:${PORT}`);
  console.log(`   x402 payment: REQUIRED (${NETWORK})`);
  console.log(`   Facilitator: ${OZ_FACILITATOR_URL}`);
  console.log(`   Pay-to: ${PAY_TO}`);
  console.log(`   Pricing Provider: ${pricingProvider.name}`);
  console.log(`   Available drugs: ${drugCount}\n`);
});
server.unref();
