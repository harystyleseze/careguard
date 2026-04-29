/**
 * Shared x402 middleware setup for all services.
 *
 * Handles the OZ facilitator connection with resilient startup:
 * - If facilitator is reachable: x402 payment enforcement active immediately
 * - If facilitator is temporarily unreachable: process doesn't crash, retries on each request
 * - Payment is NEVER skipped — if facilitator is down, protected endpoints return 500
 */

import "dotenv/config";
import type { Application } from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const DEFAULT_FACILITATOR_URL = "https://channels.openzeppelin.com/x402/testnet";
const OZ_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;

export function applyX402Middleware(
  app: Application,
  routes: Record<string, { accepts: { scheme: string; network: string; payTo: string; price: string }; description: string }>,
  opts?: { network?: `${string}:${string}`; facilitatorUrl?: string; apiKey?: string }
) {
  const network = opts?.network ?? ("stellar:testnet" as `${string}:${string}`);
  const facilitatorUrl = opts?.facilitatorUrl ?? OZ_FACILITATOR_URL;
  const apiKey = opts?.apiKey ?? process.env.OZ_FACILITATOR_API_KEY;

  if (!apiKey) {
    const protectedRoutes = Object.keys(routes).map((key) => {
      const [method, path] = key.split(" ");
      return { method: method?.toUpperCase() || "", path: path || "" };
    });
    app.use((req, res, next) => {
      const isProtected = protectedRoutes.some((r) => r.method === req.method.toUpperCase() && r.path === req.path);
      if (!isProtected) { next(); return; }
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

  const middleware = paymentMiddlewareFromConfig(
    typedRoutes,
    facilitator,
    [{ network, server: new ExactStellarScheme() }],
    undefined, // paywallConfig
    undefined, // paywall
    true       // syncFacilitatorOnStart — but we catch the rejection below
  );

  // The middleware internally creates an init promise that, if it rejects,
  // causes an unhandled promise rejection and crashes the process.
  // We apply the middleware and add a global unhandled rejection handler
  // that logs instead of crashing — the middleware handles retry on each request.
  app.use(middleware);
}

// Prevent unhandled promise rejection from crashing the process
// when the x402 facilitator is temporarily unreachable on startup.
process.on("unhandledRejection", (reason: any) => {
  const msg = reason?.message || String(reason);
  if (
    msg.includes("no supported payment kinds") ||
    msg.includes("Failed to initialize") ||
    reason?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    msg.includes("bazaar")
  ) {
    console.warn(`  ⚠ x402 startup: ${msg.slice(0, 120)}`);
    return;
  }
  // Log other rejections but don't crash — Express handles errors per-request
  console.error("Unhandled rejection:", msg);
});

export { OZ_FACILITATOR_URL, DEFAULT_FACILITATOR_URL };
