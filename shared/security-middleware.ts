import helmet from "helmet";
import type { Application } from "express";
import { getStellarCspOrigins } from "./stellar-network.ts";

export function applySecurityMiddleware(app: Application): void {
  const isProd = process.env.NODE_ENV === "production";
  const stellarOrigins = getStellarCspOrigins();
  
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: [
            "'self'",
            ...stellarOrigins,
            "https://channels.openzeppelin.com",
            "https://api.groq.com",
          ],
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      hsts: isProd
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    }),
  );
}
