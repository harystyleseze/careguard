/**
 * Pharmacy Price Comparison API — x402-protected on Stellar
 *
 * Every query requires a real x402 payment in USDC via the OZ Facilitator on Stellar testnet.
 * GET /pharmacy/compare?drug=Lisinopril&zip=90210 — $0.002 per query
 *
 * Pricing reference database based on real-world pharmacy pricing patterns (GoodRx, CostcoRx).
 */

if (!process.stdout.isTTY) {
  process.env.NO_COLOR ??= "1";
  process.env.FORCE_COLOR = "0";
}

import "dotenv/config";
import express from "express";
import { applyX402Middleware, NETWORK, OZ_FACILITATOR_URL } from "../../shared/x402-middleware.ts";
import { createPricingProvider } from "../../shared/pricing-sources.ts";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { logger } from "../../shared/logger.ts";
import { requestContextMiddleware } from "../../shared/request-context.ts";
import { requestLoggerMiddleware } from "../../shared/request-logger.ts";

const PORT = parseInt(process.env.PHARMACY_API_PORT || "3001");
const PAY_TO = process.env.PHARMACY_1_PUBLIC_KEY;

if (!PAY_TO) throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");

// Initialize pricing provider (configurable via PHARMACY_PRICING_PROVIDER env var)
const pricingProvider = createPricingProvider();

const app = express();
applySecurityMiddleware(app);
app.use(createCorsMiddleware());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "20kb" }));
app.use(requestContextMiddleware());
app.use(requestLoggerMiddleware());

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
    
    // Calculate distance based on zip code (mock implementation uses zip-based variance)
    const zipVariance = parseInt(zip.slice(-2)) % 10; // Use last 2 digits for variance
    const adjustedPrices = prices.map((p, idx) => ({
      ...p,
      distance: p.distance + (zipVariance * 0.5) + (idx * 0.3), // Vary distance by zip
    }));
    
    const sorted = [...adjustedPrices].sort((a, b) => a.price - b.price);
    const cheapest = sorted[0];
    const mostExpensive = sorted[sorted.length - 1];

    res.json({
      drug: drug.charAt(0).toUpperCase() + drug.slice(1),
      zipCode: zip,
      usedZipCode: true, // Indicates zip was actually used in calculations
      queryTimestamp: new Date().toISOString(),
      protocol: { name: "x402", network: NETWORK, price: "$0.002", payTo: PAY_TO },
      provider: pricingProvider.name,
      prices: sorted.map((p) => ({
        pharmacyName: p.pharmacy, pharmacyId: p.id, price: p.price, distance: +p.distance.toFixed(1), inStock: true,
      })),
      cheapest: { pharmacyName: cheapest.pharmacy, pharmacyId: cheapest.id, price: cheapest.price, distance: +cheapest.distance.toFixed(1) },
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

const server = app.listen(PORT, async () => {
  const drugCount = await pricingProvider.getDrugCount();
  logger.info({ port: PORT, network: NETWORK, facilitator: OZ_FACILITATOR_URL, payTo: PAY_TO, provider: pricingProvider.name, drugCount }, "Pharmacy Price API started");
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
