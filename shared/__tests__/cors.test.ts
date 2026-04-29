import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { createCorsMiddleware } from "../cors.ts";

function buildApp(nodeEnv: string, allowedOrigins?: string) {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    PROD_URL: process.env.PROD_URL,
  };

  process.env.NODE_ENV = nodeEnv;
  if (allowedOrigins !== undefined) {
    process.env.ALLOWED_ORIGINS = allowedOrigins;
  } else {
    delete process.env.ALLOWED_ORIGINS;
  }
  delete process.env.PROD_URL;

  const app = express();
  app.use(createCorsMiddleware());
  app.get("/test", (_req, res) => res.json({ ok: true }));

  // Restore env immediately after building
  process.env.NODE_ENV = saved.NODE_ENV;
  if (saved.ALLOWED_ORIGINS !== undefined) {
    process.env.ALLOWED_ORIGINS = saved.ALLOWED_ORIGINS;
  } else {
    delete process.env.ALLOWED_ORIGINS;
  }
  if (saved.PROD_URL !== undefined) {
    process.env.PROD_URL = saved.PROD_URL;
  }

  return app;
}

describe("createCorsMiddleware — production mode", () => {
  it("sets Access-Control-Allow-Origin for an allowed origin", async () => {
    const app = buildApp("production", "https://app.careguard.io");
    const res = await supertest(app)
      .get("/test")
      .set("Origin", "https://app.careguard.io");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.careguard.io",
    );
  });

  it("omits Access-Control-Allow-Origin for a disallowed origin", async () => {
    const app = buildApp("production", "https://app.careguard.io");
    const res = await supertest(app)
      .get("/test")
      .set("Origin", "https://evil.example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows multiple origins from comma-separated ALLOWED_ORIGINS", async () => {
    const app = buildApp(
      "production",
      "https://app.careguard.io,https://staging.careguard.io",
    );

    const res1 = await supertest(app)
      .get("/test")
      .set("Origin", "https://app.careguard.io");
    expect(res1.headers["access-control-allow-origin"]).toBe(
      "https://app.careguard.io",
    );

    const res2 = await supertest(app)
      .get("/test")
      .set("Origin", "https://staging.careguard.io");
    expect(res2.headers["access-control-allow-origin"]).toBe(
      "https://staging.careguard.io",
    );
  });

  it("allows preflight OPTIONS for an allowed origin", async () => {
    const app = buildApp("production", "https://app.careguard.io");
    const res = await supertest(app)
      .options("/test")
      .set("Origin", "https://app.careguard.io")
      .set("Access-Control-Request-Method", "GET");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.careguard.io",
    );
  });

  it("omits Access-Control-Allow-Origin on preflight for a disallowed origin", async () => {
    const app = buildApp("production", "https://app.careguard.io");
    const res = await supertest(app)
      .options("/test")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "GET");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows requests with no Origin header (server-to-server)", async () => {
    const app = buildApp("production", "https://app.careguard.io");
    const res = await supertest(app).get("/test");
    // No Origin header → no ACAO needed, request proceeds
    expect(res.status).toBe(200);
  });
});

describe("createCorsMiddleware — development mode", () => {
  it("allows any origin in dev (wildcard behaviour)", async () => {
    const app = buildApp("development", undefined);
    const res = await supertest(app)
      .get("/test")
      .set("Origin", "http://anything.local");

    expect(res.status).toBe(200);
    // cors() with wildcard sets '*' or reflects origin
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
  });
});
