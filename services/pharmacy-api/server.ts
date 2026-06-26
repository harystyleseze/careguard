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
import express from "express";
import { pathToFileURL } from "url";
import { applyX402Middleware, NETWORK, OZ_FACILITATOR_URL } from "../../shared/x402-middleware.ts";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { logger } from "../../shared/logger.ts";
import { requestContextMiddleware } from "../../shared/request-context.ts";
import { requestLoggerMiddleware } from "../../shared/request-logger.ts";
import type { PharmacyPricingStore } from "./db.ts";
import { createPharmacyPricingStore } from "./db.ts";
import { resolveRequestedDosage } from "./dosage.ts";
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

const PORT = parseInt(process.env.PHARMACY_API_PORT || "3001");
const PAY_TO = process.env.PHARMACY_1_PUBLIC_KEY;

export interface PharmacyAppOptions {
  payTo: string;
  pricingStore?: PharmacyPricingStore;
  adminToken?: string;
  enablePayments?: boolean;
}

function createAdminMiddleware(adminToken?: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!adminToken) {
      res.status(503).json({ error: "PHARMACY_ADMIN_TOKEN not configured" });
      return;
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res
        .status(401)
        .setHeader("WWW-Authenticate", "Bearer")
        .json({ error: "Missing admin token" });
      return;
    }

    if (auth.slice("Bearer ".length) !== adminToken) {
      res.status(403).json({ error: "Invalid admin token" });
      return;
    }

    next();
  };
}

function sendCrudNotFound(res: express.Response, message: string) {
  res.status(404).json({ error: message });
}

export function createPharmacyApp(options: PharmacyAppOptions) {
  const pricingStore = options.pricingStore ?? createPharmacyPricingStore();
  const adminToken = options.adminToken ?? process.env.PHARMACY_ADMIN_TOKEN;
  const app = express();
  let isDraining = false;

  applySecurityMiddleware(app);
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "20kb" }));
  app.use(requestContextMiddleware());
  app.use(requestLoggerMiddleware());

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

  const requireAdmin = createAdminMiddleware(adminToken);

  app.post("/pharmacy/drugs", requireAdmin, (req, res) => {
    const parsedBody = DrugRecordSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: parsedBody.error.issues[0]?.message ?? "Invalid drug payload",
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
      sendCrudNotFound(res, `Drug not found: ${drugName}`);
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
      sendCrudNotFound(res, `Pharmacy not found: ${pharmacyId}`);
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
      });
      return;
    }

    const query = parsedQuery.data as PharmacyCompareQuery;
    const drug = query.drug.trim().toLowerCase();
    const dosage = resolveRequestedDosage(drug, query.dosage);

    try {
      const prices = pricingStore.getPrices(drug);
      res.json(
        buildCompareResponse({
          drug,
          dosage,
          zip: query.zip,
          payTo: options.payTo,
          network: NETWORK,
          prices,
        }),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(404).json({
        error: errorMessage,
        provider: "sqlite",
        drugCount: pricingStore.getDrugCount(),
      });
    }
  });

  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body too large", limit: err.limit });
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

export const defaultPharmacyApp = PAY_TO
  ? createPharmacyApp({ payTo: PAY_TO })
  : undefined;

const entrypointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === entrypointUrl) {
  if (!PAY_TO) {
    throw new Error("PHARMACY_1_PUBLIC_KEY required in .env");
  }

  const startedApp = defaultPharmacyApp ?? createPharmacyApp({ payTo: PAY_TO });
  const server = startedApp.app.listen(PORT, () => {
    logger.info(
      {
        port: PORT,
        network: NETWORK,
        facilitator: OZ_FACILITATOR_URL,
        payTo: PAY_TO,
        provider: "sqlite",
        drugCount: startedApp.pricingStore.getDrugCount(),
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
