/**
 * Shared x402 middleware setup for all services.
 *
 * Handles the OZ facilitator connection in fail-closed mode:
 * - If facilitator sync fails on boot: log critical and exit
 * - If facilitator goes down after boot: protected endpoints return 503
 * - Payment is NEVER skipped
 */

import "dotenv/config";
import type { Application, Request } from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { logger } from "./logger.ts";

const DEFAULT_FACILITATOR_URL = "https://channels.openzeppelin.com/x402/testnet";
const OZ_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
const NETWORK = "stellar:testnet" as const;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;

type ProtectedRoute = { method: string; path: string };

export const x402FacilitatorState = {
  healthy: true,
  lastCheckedAt: undefined as string | undefined,
  lastError: undefined as string | undefined,
};

function getProtectedRoutes(
  routes: Record<string, { accepts: { scheme: string; network: string; payTo: string; price: string }; description: string }>,
): ProtectedRoute[] {
  return Object.keys(routes).map((key) => {
    const [method, path] = key.split(" ");
    return { method: method?.toUpperCase() || "", path: path || "" };
  });
}

function isProtectedRoute(req: Request, protectedRoutes: ProtectedRoute[]) {
  return protectedRoutes.some(
    (r) => r.method === req.method.toUpperCase() && r.path === req.path,
  );
}

export function createX402HealthGate(protectedRoutes: ProtectedRoute[]) {
  return (req: Request, res: any, next: () => void) => {
    if (!isProtectedRoute(req, protectedRoutes)) {
      next();
      return;
    }
    if (x402FacilitatorState.healthy) {
      next();
      return;
    }
    res.status(503).json({
      error: "x402 facilitator unavailable; paid route temporarily disabled",
    });
  };
}

function getErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function isX402FacilitatorError(reason: any) {
  const msg = getErrorMessage(reason);
  return (
    msg.includes("no supported payment kinds") ||
    msg.includes("Failed to initialize") ||
    reason?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    reason?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    msg.includes("facilitator") ||
    msg.includes("supported payment")
  );
}

export async function checkFacilitatorHealth(
  facilitator: Pick<HTTPFacilitatorClient, "getSupported">,
) {
  const supported = await facilitator.getSupported();
  if (!Array.isArray((supported as any).kinds) || (supported as any).kinds.length === 0) {
    throw new Error("x402 facilitator returned no supported payment kinds");
  }
  x402FacilitatorState.healthy = true;
  x402FacilitatorState.lastCheckedAt = new Date().toISOString();
  x402FacilitatorState.lastError = undefined;
  return supported;
}

export function handleX402UnhandledRejection(reason: unknown) {
  const msg = getErrorMessage(reason);
  if (isX402FacilitatorError(reason)) {
    x402FacilitatorState.healthy = false;
    x402FacilitatorState.lastCheckedAt = new Date().toISOString();
    x402FacilitatorState.lastError = msg;
    logger.fatal(
      { msg: msg.slice(0, 500) },
      "critical: x402 facilitator startup sync failed; refusing to start",
    );
    process.exit(1);
    return;
  }

  logger.error({ msg }, "unhandled rejection");
}

export function applyX402Middleware(
  app: Application,
  routes: Record<string, { accepts: { scheme: string; network: string; payTo: string; price: string }; description: string }>,
  opts?: { network?: `${string}:${string}`; facilitatorUrl?: string; apiKey?: string; healthCheckIntervalMs?: number }
) {
  const network = opts?.network ?? NETWORK;
  const facilitatorUrl = opts?.facilitatorUrl ?? OZ_FACILITATOR_URL;
  const apiKey = opts?.apiKey ?? process.env.OZ_FACILITATOR_API_KEY;

  if (!apiKey) {
    const protectedRoutes = getProtectedRoutes(routes);
    app.use((req, res, next) => {
      if (!isProtectedRoute(req, protectedRoutes)) { next(); return; }
      res.status(500).json({ error: "OZ_FACILITATOR_API_KEY missing — x402 payment middleware not configured" });
    });
    return;
  }

  const facilitator = new HTTPFacilitatorClient({
    url: facilitatorUrl,
    createAuthHeaders: async () => {
      const h = { Authorization: `Bearer ${apiKey}` };
      return { verify: h, settle: h, supported: h };
    },
  });

  // Cast route network types for x402
  const typedRoutes: Record<string, any> = {};
  for (const [key, value] of Object.entries(routes)) {
    typedRoutes[key] = {
      ...value,
      accepts: { ...value.accepts, network },
    };
  }

  const protectedRoutes = getProtectedRoutes(routes);
  app.use(createX402HealthGate(protectedRoutes));

  const middleware = paymentMiddlewareFromConfig(
    typedRoutes,
    facilitator,
    [{ network, server: new ExactStellarScheme() }],
    undefined, // paywallConfig
    undefined, // paywall
    true       // syncFacilitatorOnStart — fail process if facilitator sync rejects
  );

  app.use(middleware);

  const intervalMs =
    opts?.healthCheckIntervalMs ??
    (parseInt(process.env.X402_FACILITATOR_HEALTH_INTERVAL_MS || "", 10) ||
      DEFAULT_HEALTH_CHECK_INTERVAL_MS);
  const runHealthCheck = async () => {
    try {
      await checkFacilitatorHealth(facilitator);
    } catch (err: any) {
      x402FacilitatorState.healthy = false;
      x402FacilitatorState.lastCheckedAt = new Date().toISOString();
      x402FacilitatorState.lastError = getErrorMessage(err);
      logger.error(
        { err: x402FacilitatorState.lastError },
        "x402 facilitator health check failed; paid routes will return 503",
      );
    }
  };
  const interval = setInterval(runHealthCheck, intervalMs);
  interval.unref?.();
}

process.on("unhandledRejection", handleX402UnhandledRejection);

export { OZ_FACILITATOR_URL, DEFAULT_FACILITATOR_URL, NETWORK };
