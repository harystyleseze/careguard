/**
 * Drug Interaction Check API — x402-protected on Stellar
 *
 * Every check requires a real x402 payment in USDC via the OZ Facilitator.
 * GET /drug/interactions?meds=Lisinopril,Metformin — $0.001 per check
 *
 * Clinical interaction reference database based on FDA drug interaction data.
 */

if (!process.stdout.isTTY) {
  process.env.NO_COLOR ??= "1";
  process.env.FORCE_COLOR = "0";
}

import "dotenv/config";
import express from "express";
import { applyX402Middleware, NETWORK, OZ_FACILITATOR_URL } from "../../shared/x402-middleware.ts";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { logger } from "../../shared/logger.ts";
import { requestContextMiddleware } from "../../shared/request-context.ts";
import { requestLoggerMiddleware } from "../../shared/request-logger.ts";
import {
  checkInteractions,
  DrugInteractionsQuerySchema,
} from "./logic.ts";
import type { DrugInteractionsQuery } from "./logic.ts";

const PORT = parseInt(process.env.DRUG_INTERACTION_API_PORT || "3003");
const PAY_TO = process.env.PHARMACY_2_PUBLIC_KEY;

if (!PAY_TO) throw new Error("PHARMACY_2_PUBLIC_KEY required in .env");

const app = express();
applySecurityMiddleware(app);
app.use(createCorsMiddleware());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "20kb" }));
app.use(requestContextMiddleware());
app.use(requestLoggerMiddleware());

app.get("/", (_req, res) => {
  res.json({ service: "CareGuard Drug Interaction Check API", version: "1.0.0", protocol: "x402 on Stellar", network: NETWORK, payTo: PAY_TO, price: "$0.001 per check" });
});

// x402 payment middleware
applyX402Middleware(app, {
  "GET /drug/interactions": {
    accepts: { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.001" },
    description: "Drug interaction check — $0.001 USDC",
  },
});

app.get("/drug/interactions", (req, res) => {
  const parsedQuery = DrugInteractionsQuerySchema.safeParse({
    meds: req.query.meds,
  });
  if (!parsedQuery.success) {
    res.status(400).json({
      error: parsedQuery.error.issues[0]?.message ?? "Invalid meds query parameter",
    });
    return;
  }

  const result = checkInteractions(
    (parsedQuery.data as DrugInteractionsQuery).medications,
  );
  res.json({
    checkTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network: NETWORK, price: "$0.001", payTo: PAY_TO },
    ...result,
  });
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
  logger.info({ port: PORT, network: NETWORK, facilitator: OZ_FACILITATOR_URL, payTo: PAY_TO }, "Drug Interaction API started");
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
