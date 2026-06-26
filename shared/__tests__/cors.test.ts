import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { createCorsMiddleware } from "../cors.ts";

function buildApp(nodeEnv: string, allowedOrigins?: string) {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    DASHBOARD_ORIGIN: process.env.DASHBOARD_ORIGIN,
    DASHBOARD_URL: process.env.DASHBOARD_URL,
    PROD_URL: process.env.PROD_URL,
  };

  process.env.NODE_ENV = nodeEnv;
  if (allowedOrigins !== undefined) {
    process.env.ALLOWED_ORIGINS = allowedOrigins;
  } else {
    delete process.env.ALLOWED_ORIGINS;
  }
  delete process.env.DASHBOARD_ORIGIN;
  delete process.env.DASHBOARD_URL;
  delete process.env.PROD_URL;

  try {
    const app = express();
    app.use(createCorsMiddleware());
    app.get("/test", (_req, res) => res.json({ ok: true }));
    return app;
  } finally {
    // Restore env immediately after building
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.ALLOWED_ORIGINS !== undefined) {
      process.env.ALLOWED_ORIGINS = saved.ALLOWED_ORIGINS;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }
    if (saved.DASHBOARD_ORIGIN !== undefined) {
      process.env.DASHBOARD_ORIGIN = saved.DASHBOARD_ORIGIN;
    } else {
      delete process.env.DASHBOARD_ORIGIN;
    }
    if (saved.DASHBOARD_URL !== undefined) {
      process.env.DASHBOARD_URL = saved.DASHBOARD_URL;
    } else {
      delete process.env.DASHBOARD_URL;
    }
    if (saved.PROD_URL !== undefined) {
      process.env.PROD_URL = saved.PROD_URL;
    }
  }
}

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

  it("uses DASHBOARD_ORIGIN when ALLOWED_ORIGINS is unset", async () => {
    const app = withEnv(
      {
        NODE_ENV: "production",
        ALLOWED_ORIGINS: undefined,
        DASHBOARD_ORIGIN: "https://dashboard.careguard.io",
        PROD_URL: undefined,
        DASHBOARD_URL: undefined,
      },
      () => {
        const app = express();
        app.use(createCorsMiddleware());
        app.get("/test", (_req, res) => res.json({ ok: true }));
        return app;
      },
    );

    const allowed = await supertest(app)
      .get("/test")
      .set("Origin", "https://dashboard.careguard.io");
    const blocked = await supertest(app)
      .get("/test")
      .set("Origin", "https://evil.example.com");

    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://dashboard.careguard.io",
    );
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects wildcard CORS origins", () => {
    expect(() => buildApp("production", "*")).toThrow(
      "CORS wildcard origin '*' is not allowed",
    );

    expect(() =>
      withEnv(
        {
          NODE_ENV: "production",
          ALLOWED_ORIGINS: undefined,
          DASHBOARD_ORIGIN: "*",
          PROD_URL: undefined,
          DASHBOARD_URL: undefined,
        },
        () => {
          const app = express();
          app.use(createCorsMiddleware());
          return app;
        },
      ),
    ).toThrow("CORS wildcard origin '*' is not allowed");
  });

  it("allows requests with no Origin header (server-to-server)", async () => {
    const app = buildApp("production", "https://app.careguard.io");
    const res = await supertest(app).get("/test");
    // No Origin header → no ACAO needed, request proceeds
    expect(res.status).toBe(200);
  });
});

describe("createCorsMiddleware — development mode", () => {
  it("pins origins in dev too", async () => {
    const app = buildApp("development", undefined);
    const allowed = await supertest(app)
      .get("/test")
      .set("Origin", "http://localhost:3000");
    const blocked = await supertest(app)
      .get("/test")
      .set("Origin", "http://anything.local");

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
