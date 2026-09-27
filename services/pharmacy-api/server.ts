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
import path from "path";
import express, { type Express } from "express";
import { pathToFileURL } from "url";
import { applyX402Middleware, NETWORK, OZ_FACILITATOR_URL } from "../../shared/x402-middleware.ts";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { createPharmacyAdminAuth } from "../../shared/pharmacy-admin-auth.ts";
import { logger } from "../../shared/logger.ts";
import { requestLifecycleMiddleware } from "../../shared/request-lifecycle.ts";
import { pharmacyUnknownDrugTotal } from "../../shared/metrics.ts";
import type { PharmacyPricingStore } from "./db.ts";
import { createPharmacyPricingStore } from "./db.ts";
import { resolveRequestedDosage } from "./dosage.ts";
import { PRICING_DATABASE, getPharmacyPrices, getAvailableDrugs } from "../../shared/pharmacy-pricing.ts";
import {
  buildCompareResponse,
  DrugRecordSchema,
  PharmacyCompareQuerySchema,
  PharmacyPriceSchema,
  PharmacyRecordSchema,
} from "./logic.ts";
import type {
  DrugRecordInput,
  PharmacyCompareQuery,
  PharmacyPriceInput,
  PharmacyRecordInput,
} from "./logic.ts";

const PORT = parseInt(process.env.PHARMACY_API_PORT || "3001", 10);
const PAY_TO = process.env.PHARMACY_1_PUBLIC_KEY;

if (!PAY_TO) throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");

export interface PharmacyAppOptions {
  payTo: string;
  pricingStore?: PharmacyPricingStore;
  adminToken?: string;
  enablePayments?: boolean;
}

function sendCrudNotFound(res: express.Response, message: string, code: string = "NOT_FOUND") {
  res.status(404).json({ error: message, code });
}

export function createPharmacyApp(options: PharmacyAppOptions) {
  const pricingStore = options.pricingStore ?? createPharmacyPricingStore();
  const adminToken = options.adminToken ?? process.env.PHARMACY_ADMIN_TOKEN;
  const app: Express = express();
  let isDraining = false;

  applySecurityMiddleware(app);
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "20kb" }));
  app.use(requestLifecycleMiddleware());

  app.get("/", (_req, res) => {
    res.json({
      service: "CareGuard Pharmacy Price Comparison API",
      version: "1.0.0",
      protocol: "x402 on Stellar",
      network: NETWORK,
      facilitator: OZ_FACILITATOR_URL,
      payTo: options.payTo,
      price: "$0.002 per query",
      pricingProvider: "sqlite",
      drugCount: pricingStore.getDrugCount(),
    });
  });

  app.get("/pharmacy/drugs", (_req, res) => {
    const drugs = pricingStore.listDrugs();
    res.json({
      provider: "sqlite",
      count: drugs.length,
      drugs,
      message:
        "Use GET /pharmacy/compare?drug=<name>&zip=<code> to query prices",
    });
  });

  app.get("/pharmacy/pharmacies", (_req, res) => {
    res.json({ pharmacies: pricingStore.listPharmacies() });
  });

  if (options.enablePayments !== false) {
    applyX402Middleware(app, {
      "GET /pharmacy/compare": {
        accepts: {
          scheme: "exact",
          network: NETWORK,
          payTo: options.payTo,
          price: "$0.002",
        },
        description: "Pharmacy price comparison query — $0.002 USDC",
      },
    });
  }

  const requireAdmin = createPharmacyAdminAuth(adminToken);

  app.post("/pharmacy/drugs", requireAdmin, (req, res) => {
    const parsedBody = DrugRecordSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: parsedBody.error.issues[0]?.message ?? "Invalid drug payload",
        code: "VALIDATION_INVALID_INPUT",
      });
      return;
    }

    const drug = pricingStore.upsertDrug(parsedBody.data as DrugRecordInput);
    res.status(201).json({ drug });
  });

  app.put("/pharmacy/drugs/:drugName", requireAdmin, (req, res) => {
    const drugName = Array.isArray(req.params.drugName)
      ? req.params.drugName[0]
      : req.params.drugName;
    const parsedBody = DrugRecordSchema.safeParse({
      ...req.body,
      name: drugName,
    });
    if (!parsedBody.success) {
      res.status(400).json({
        error: parsedBody.error.issues[0]?.message ?? "Invalid drug payload",
        code: "VALIDATION_INVALID_INPUT",
      });
      return;
    }

    const drug = pricingStore.upsertDrug(parsedBody.data as DrugRecordInput);
    res.json({ drug });
  });

  app.delete("/pharmacy/drugs/:drugName", requireAdmin, (req, res) => {
    const drugName = Array.isArray(req.params.drugName)
      ? req.params.drugName[0]
      : req.params.drugName;
    if (!pricingStore.deleteDrug(drugName)) {
      sendCrudNotFound(res, `Drug not found: ${drugName}`, "NOT_FOUND_DRUG");
      return;
    }

    res.status(204).send();
  });

  app.post("/pharmacy/pharmacies", requireAdmin, (req, res) => {
    const parsedBody = PharmacyRecordSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error:
          parsedBody.error.issues[0]?.message ?? "Invalid pharmacy payload",
        code: "VALIDATION_INVALID_INPUT",
      });
      return;
    }

    const pharmacy = pricingStore.upsertPharmacy(
      parsedBody.data as PharmacyRecordInput,
    );
    res.status(201).json({ pharmacy });
  });

  app.put("/pharmacy/pharmacies/:pharmacyId", requireAdmin, (req, res) => {
    const pharmacyId = Array.isArray(req.params.pharmacyId)
      ? req.params.pharmacyId[0]
      : req.params.pharmacyId;
    const parsedBody = PharmacyRecordSchema.safeParse({
      ...req.body,
      id: pharmacyId,
    });
    if (!parsedBody.success) {
      res.status(400).json({
        error:
          parsedBody.error.issues[0]?.message ?? "Invalid pharmacy payload",
        code: "VALIDATION_INVALID_INPUT",
      });
      return;
    }

    const pharmacy = pricingStore.upsertPharmacy(
      parsedBody.data as PharmacyRecordInput,
    );
    res.json({ pharmacy });
  });

  app.delete("/pharmacy/pharmacies/:pharmacyId", requireAdmin, (req, res) => {
    const pharmacyId = Array.isArray(req.params.pharmacyId)
      ? req.params.pharmacyId[0]
      : req.params.pharmacyId;
    if (!pricingStore.deletePharmacy(pharmacyId)) {
      sendCrudNotFound(res, `Pharmacy not found: ${pharmacyId}`, "NOT_FOUND_PHARMACY");
      return;
    }

    res.status(204).send();
  });

  app.post("/pharmacy/prices", requireAdmin, (req, res) => {
    const parsedBody = PharmacyPriceSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error:
          parsedBody.error.issues[0]?.message ?? "Invalid pharmacy price payload",
        code: "VALIDATION_INVALID_INPUT",
      });
      return;
    }

    try {
      const price = pricingStore.upsertPrice(
        parsedBody.data as PharmacyPriceInput,
      );
      res.json({ price });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to upsert price";
      res.status(404).json({ error: message });
    }
  });

  app.get("/pharmacy/compare", (req, res) => {
    const parsedQuery = PharmacyCompareQuerySchema.safeParse({
      drug: req.query.drug,
      dosage: req.query.dosage,
      zip: req.query.zip,
    });
    if (!parsedQuery.success) {
      res.status(400).json({
        error:
          parsedQuery.error.issues[0]?.message ?? "Invalid pharmacy query parameters",
        code: "VALIDATION_INVALID_INPUT",
      });
      return;
    }

    const query = parsedQuery.data as any;
    const drug = query.drug.trim().toLowerCase();
    const dosage = resolveRequestedDosage(drug, query.dosage);

    try {
      const { prices, usedZipCode, isFallbackZip } = getPharmacyPrices(drug, query.zip);
      res.json(
        buildCompareResponse({
          drug,
          dosage,
          zip: query.zip,
          usedZipCode,
          isFallbackZip,
          payTo: options.payTo,
          network: NETWORK,
          prices,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("No pricing records found")) {
        pharmacyUnknownDrugTotal.inc({ drug });
        res.status(404).json({
          error: `No pricing records found for drug: ${drug}`,
          code: "NO_PRICES_FOUND",
        });
      } else {
        logger.error({ err: error, drug, requestId: (req as any).requestId }, "pharmacy compare handler error");
        res.status(500).json({
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        });
      }
    }
  });

  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({
        error: "Request body too large",
        code: "BODY_TOO_LARGE",
        details: { limit: err.limit },
      });
    }
    next(err);
  });

  app.get("/ready", (_req, res) => {
    if (isDraining) {
      res.status(503).send("Service Unavailable");
      return;
    }
    res.send("OK");
  });

  return {
    app,
    pricingStore,
    setDraining(draining: boolean) {
      isDraining = draining;
    },
  };
}

export const defaultPharmacyApp: ReturnType<typeof createPharmacyApp> = createPharmacyApp({
  payTo: PAY_TO,
});

const entrypointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === entrypointUrl) {
  const startedApp = defaultPharmacyApp;
  const server = startedApp.app.listen(PORT, () => {
    logger.info(
      {
        port: PORT,
        network: NETWORK,
        facilitator: OZ_FACILITATOR_URL,
        payTo: PAY_TO,
        provider: "sqlite",
        drugCount: startedApp.pricingStore.getDrugCount(),
        availableDrugs: getAvailableDrugs(),
      },
      "Pharmacy Price API started",
    );
  });

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received. Draining server...");
    startedApp.setDraining(true);
    server.close(() => {
      logger.info("Server closed. Exiting process.");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Graceful shutdown timeout. Forcing exit.");
      process.exit(1);
    }, 30000);
  });
}
