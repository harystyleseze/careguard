/**
 * Generate OpenAPI 3.1 spec from zod schemas across all service endpoints.
 *
 * Outputs to: docs/openapi.yml
 *
 * Run: npm run gen-openapi
 */

import { z } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  MAX_FREE_TEXT_LENGTH,
  MAX_FREE_TEXT_LIST_LENGTH,
} from "../shared/free-text.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, "../docs");

// Kept in sync with the registry in docs/error-codes.md — that file is the
// source of truth for meaning/remediation; this enum is what clients can
// validate against in the spec itself.
const ERROR_CODES = [
  "VALIDATION_MISSING_FIELD",
  "VALIDATION_INVALID_INPUT",
  "VALIDATION_INSUFFICIENT_SCORE",
  "AUTH_TOKEN_MISSING",
  "AUTH_TOKEN_EXPIRED",
  "AUTH_TOKEN_INVALID",
  "AUTH_ADMIN_REQUIRED",
  "NOT_FOUND_DRUG",
  "NOT_FOUND_PHARMACY",
  "NOT_FOUND_AGENT",
  "BODY_TOO_LARGE",
  "POLICY_DAILY_LIMIT",
  "POLICY_MONTHLY_LIMIT",
  "POLICY_APPROVAL_REQUIRED",
  "POLICY_CATEGORY_BLOCKED",
  "PAYMENT_INSUFFICIENT_FUNDS",
  "PAYMENT_TX_FAILED",
  "PAYMENT_TX_TIMEOUT",
  "RATE_LIMIT_EXCEEDED",
  "UPSTREAM_HORIZON_DOWN",
  "UPSTREAM_LLM_DOWN",
  "UPSTREAM_FACILITATOR_DOWN",
  "UPSTREAM_FACILITATOR_ERROR",
  "UPSTREAM_TIMEOUT",
  "SERVER_DEGRADED",
  "SERVER_INTERNAL_ERROR",
] as const;

/** Standard 4xx/5xx response referencing the shared Error schema. */
function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };
}

/** 402 challenge response for x402-protected routes. */
function paymentRequiredResponse() {
  return {
    description:
      "Payment required. Response is an x402 payment challenge (not the shared Error schema): " +
      "the body describes accepted payment schemes/amounts and an X-PAYMENT-related header " +
      "identifies the facilitator. Retry the request with an X-PAYMENT header containing a " +
      "valid payment proof for one of the accepted schemes.",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/X402PaymentChallenge" },
      },
    },
  };
}

/** 413 response for routes with an explicit body-size limit. */
function bodyTooLargeResponse() {
  return errorResponse(
    "Request body exceeds the configured size limit. `code` is BODY_TOO_LARGE; `details.limit` " +
      "reports the configured maximum in bytes.",
  );
}

const RATE_LIMIT_RESPONSE = errorResponse(
  "Too many requests for this route's rate-limit policy. `code` is RATE_LIMIT_EXCEEDED; " +
    "back off and retry after the `Retry-After` header. See docs/api-examples/rate-limits.md " +
    "for per-endpoint limits, response headers, and retry guidance.",
);

const SERVER_ERROR_RESPONSE = errorResponse(
  "Unhandled server error. `code` is SERVER_INTERNAL_ERROR.",
);

interface OpenAPIInfo {
  title: string;
  version: string;
  description: string;
}

interface OpenAPIPath {
  [method: string]: {
    summary?: string;
    tags?: string[];
    parameters?: Array<Record<string, unknown>>;
    requestBody?: {
      required: boolean;
      content: {
        "application/json": {
          schema: Record<string, unknown>;
        };
      };
    };
    responses: {
      [status: string]: {
        description: string;
        content?: {
          "application/json": {
            schema: Record<string, unknown>;
          };
        };
      };
    };
    security?: Array<Record<string, string[]>>;
  };
}

interface OpenAPISpec {
  openapi: string;
  info: OpenAPIInfo;
  servers: Array<{ url: string; description: string }>;
  security?: Array<Record<string, string[]>>;
  components: {
    securitySchemes: {
      X402Auth: {
        type: string;
        scheme: string;
        description: string;
      };
    };
    schemas: Record<string, Record<string, unknown>>;
    responses?: Record<string, Record<string, unknown>>;
  };
  paths: Record<string, OpenAPIPath>;
}

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const shape = (schema as any)._def;

  if (!shape) {
    return { type: "object" };
  }

  return {
    type: "object",
    properties: {},
  };
}

export function generateSpec(): OpenAPISpec {
  return {
    openapi: "3.1.0",
    info: {
      title: "CareGuard API",
      version: "1.0.0",
      description:
        "OpenAPI spec for CareGuard services: agent spending, pharmacy, bill audit, drug interactions, and payments. " +
        "See docs/api-examples/rate-limits.md for rate-limit behavior, response headers, and retry guidance.",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
      {
        url: "https://api.careguard.xyz",
        description: "Production server",
      },
    ],
    security: [
      {
        CaregiverBearerAuth: [],
      },
    ],
    components: {
      securitySchemes: {
        CaregiverBearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "token",
          description:
            "Bearer token used to authorize caregiver access to /agent/* endpoints. Set CAREGIVER_TOKEN in environment variables.",
        },
        X402Auth: {
          type: "apiKey",
          name: "X-Payment",
          in: "header",
          description: "x402 payment proof header for paid endpoints on Stellar.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error", "code"],
          properties: {
            error: {
              type: "string",
              description: "A human-readable description of the error.",
            },
            code: {
              type: "string",
              description: "A stable, machine-readable uppercase SNAKE_CASE code identifying the specific type of error.",
            },
            details: {
              type: "object",
              description: "Structured metadata or field-level details specific to the error code.",
            },
          },
          required: ["error", "code"],
        },
        X402PaymentChallenge: {
          type: "object",
          description:
            "x402 payment challenge returned on 402 responses from paid routes. Shape is defined by " +
            "the x402 protocol (see docs/setup/x402.md), not the shared Error schema — clients must " +
            "branch on HTTP status 402, not on a `code` field, to detect this response.",
          properties: {
            x402Version: { type: "integer" },
            accepts: {
              type: "array",
              description: "Accepted payment schemes, assets, and amounts for this route.",
              items: { type: "object" },
            },
            error: {
              type: "string",
              description: "Human-readable reason payment is required or was rejected.",
            },
          },
        },
        ReadinessResponse: {
          type: "object",
          description:
            "See docs/observability/health-checks.md for the full schema and check semantics.",
          properties: {
            status: { type: "string", enum: ["ok", "degraded"] },
            checks: {
              type: "object",
              properties: {
                env: { oneOf: [{ type: "boolean" }, { type: "string" }] },
                horizon: { type: "boolean" },
                ozFacilitator: { oneOf: [{ type: "boolean" }, { type: "string" }] },
              },
            },
          },
        },
      },
      responses: {
        BadRequestError: {
          description: "Bad Request / Validation Error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        UnauthorizedError: {
          description: "Missing or invalid authentication credentials",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        ForbiddenError: {
          description: "Forbidden access (e.g., CSRF token mismatch, invalid admin credentials)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        NotFoundError: {
          description: "Requested resource not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        PaymentRequiredError: {
          description: "Payment required (x402 / MPP Challenge)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        ConflictError: {
          description: "Conflict / State violation (e.g., Agent is paused)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        InternalServerError: {
          description: "Internal server error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          summary: "Liveness probe — always fast, no dependency checks",
          tags: ["Observability"],
          security: [],
          responses: {
            "200": {
              description: "Process is up",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", enum: ["ok"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/ready": {
        get: {
          summary: "Readiness probe — checks required env, Horizon, and OZ facilitator status",
          tags: ["Observability"],
          security: [],
          responses: {
            "200": {
              description: "All dependency checks passed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReadinessResponse" },
                },
              },
            },
            "503": {
              description: "Draining, or at least one dependency check failed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReadinessResponse" },
                },
              },
            },
          },
        },
      },
      "/agent/spending": {
        get: {
          summary: "Get agent spending summary",
          tags: ["Agent"],
          responses: {
            "200": {
              description: "Spending summary",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      totalSpent: { type: "number" },
                      categories: { type: "object" },
                    },
                  },
                },
              },
            },
            "401": errorResponse("Missing or invalid CAREGIVER_TOKEN."),
            "403": errorResponse("Caregiver token invalid or insufficient access."),
            "429": RATE_LIMIT_RESPONSE,
            "500": SERVER_ERROR_RESPONSE,
          },
        },
      },
      "/pharmacy/compare": {
        get: {
          summary: "Compare pharmacy prices for a drug",
          tags: ["Pharmacy"],
          security: [{ X402Auth: [] }],
          parameters: [
            {
              in: "query",
              name: "drug",
              required: true,
              schema: {
                type: "string",
                minLength: 1,
                maxLength: MAX_FREE_TEXT_LENGTH,
              },
              description: "Drug name. Maximum length: 80 characters.",
            },
            {
              in: "query",
              name: "dosage",
              required: false,
              schema: {
                type: "string",
                minLength: 1,
                maxLength: MAX_FREE_TEXT_LENGTH,
              },
              description: "Optional dosage string. Maximum length: 80 characters.",
            },
            {
              in: "query",
              name: "zip",
              required: false,
              schema: {
                type: "string",
                pattern: "^\\d{5}$",
              },
              description: "5-digit ZIP code used for distance adjustments.",
            },
          ],
          responses: {
            "200": {
              description: "Pharmacy query results",
            },
            "400": errorResponse(
              "Invalid request. `code` is one of VALIDATION_MISSING_FIELD, VALIDATION_INVALID_INPUT.",
            ),
            "402": paymentRequiredResponse(),
            "404": errorResponse("Drug or pharmacy not found. `code` is NOT_FOUND_DRUG or NOT_FOUND_PHARMACY."),
            "429": RATE_LIMIT_RESPONSE,
            "500": SERVER_ERROR_RESPONSE,
          },
        },
      },
      "/pharmacy/prices": {
        post: {
          summary: "Admin upsert for a drug price at a pharmacy",
          description:
            "Admin-only endpoint to create or update a drug price at a pharmacy. See docs/api-examples/pharmacy-prices-admin.md for detailed authorization rules, sample payloads, and effects on future comparison results.",
          tags: ["Pharmacy"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    drug: {
                      type: "string",
                      minLength: 1,
                      maxLength: MAX_FREE_TEXT_LENGTH,
                    },
                    pharmacyId: {
                      type: "string",
                      minLength: 1,
                      maxLength: MAX_FREE_TEXT_LENGTH,
                    },
                    price: {
                      type: "number",
                      exclusiveMinimum: 0,
                      maximum: 10000,
                    },
                  },
                  required: ["drug", "pharmacyId", "price"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Price created or updated",
            },
            "400": errorResponse(
              "Validation error. `code` is one of VALIDATION_MISSING_FIELD, VALIDATION_INVALID_INPUT.",
            ),
            "401": errorResponse("Missing admin token. `code` is AUTH_TOKEN_MISSING."),
            "403": errorResponse("Admin token invalid or insufficient. `code` is AUTH_TOKEN_INVALID or AUTH_ADMIN_REQUIRED."),
            "500": SERVER_ERROR_RESPONSE,
          },
        },
      },
      "/bill/audit": {
        post: {
          summary: "Audit medical bills",
          tags: ["Bill Audit"],
          security: [{ X402Auth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    lineItems: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          cptCode: { type: "string" },
                          quantity: { type: "integer", minimum: 1, maximum: 999 },
                          chargedAmount: {
                            type: "number",
                            minimum: 0,
                            maximum: 1000000,
                          },
                          description: {
                            type: "string",
                            minLength: 1,
                            maxLength: MAX_FREE_TEXT_LENGTH,
                          },
                        },
                        required: [
                          "cptCode",
                          "quantity",
                          "chargedAmount",
                          "description",
                        ],
                      },
                    },
                  },
                  required: ["lineItems"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Audit results",
            },
            "402": paymentRequiredResponse(),
            "413": bodyTooLargeResponse(),
            "429": RATE_LIMIT_RESPONSE,
            "500": SERVER_ERROR_RESPONSE,
          },
        },
      },
      "/drug/interactions": {
        get: {
          summary: "Check drug interactions for a medication list",
          tags: ["Drug Interactions"],
          security: [{ X402Auth: [] }],
          parameters: [
            {
              in: "query",
              name: "meds",
              required: true,
              schema: {
                type: "string",
                minLength: 1,
                maxLength: MAX_FREE_TEXT_LIST_LENGTH,
              },
              description:
                "Comma-separated medication names. Each medication name is limited to 80 characters.",
            },
          ],
          responses: {
            "200": {
              description: "Drug interaction results",
            },
            "400": errorResponse(
              "Validation error. `code` is one of VALIDATION_MISSING_FIELD, VALIDATION_INVALID_INPUT, VALIDATION_INSUFFICIENT_SCORE.",
            ),
            "402": paymentRequiredResponse(),
            "429": RATE_LIMIT_RESPONSE,
            "500": SERVER_ERROR_RESPONSE,
          },
        },
      },
      "/pharmacy/order": {
        post: {
          summary: "Submit a paid pharmacy order",
          tags: ["Pharmacy Payments"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    drug: {
                      type: "string",
                      minLength: 1,
                      maxLength: MAX_FREE_TEXT_LENGTH,
                    },
                    pharmacy: {
                      type: "string",
                      minLength: 1,
                      maxLength: MAX_FREE_TEXT_LENGTH,
                    },
                    amount: {
                      oneOf: [
                        { type: "number", minimum: 0.01, maximum: 10000 },
                        { type: "string" },
                      ],
                    },
                  },
                  required: ["drug", "pharmacy", "amount"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Order confirmed",
            },
            "400": errorResponse(
              "Validation error. `code` is one of VALIDATION_MISSING_FIELD, VALIDATION_INVALID_INPUT.",
            ),
            "402": paymentRequiredResponse(),
            "429": RATE_LIMIT_RESPONSE,
            "500": errorResponse(
              "Order or payment processing failed. `code` is one of SERVER_INTERNAL_ERROR, PAYMENT_TX_FAILED.",
            ),
            "502": errorResponse(
              "Stellar transaction timed out or an upstream dependency is unreachable. `code` is one of PAYMENT_TX_TIMEOUT, UPSTREAM_HORIZON_DOWN, UPSTREAM_FACILITATOR_DOWN, UPSTREAM_FACILITATOR_ERROR.",
            ),
          },
        },
      },
      "/docs": {
        get: {
          summary: "API documentation UI",
          tags: ["Documentation"],
          responses: {
            "200": {
              description: "Scalar UI serving this OpenAPI spec",
            },
          },
        },
      },
    },
  };
}

export function saveSpec() {
  mkdirSync(docsDir, { recursive: true });

  const spec = generateSpec();
  const yaml = specToYaml(spec);

  const filePath = path.resolve(docsDir, "openapi.yml");
  writeFileSync(filePath, yaml, "utf-8");

  console.log(`✓ OpenAPI spec generated: ${filePath}`);
}

/** True for `[]` and `{}` — containers YAML must keep inline after a key. */
function isEmptyContainer(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object" && value !== null) {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }
  return false;
}

export function specToYaml(obj: unknown, indent = 0): string {
  const spaces = " ".repeat(indent);

  if (obj === null || obj === undefined) {
    return "null";
  }

  if (typeof obj === "string") {
    return `'${obj.replace(/'/g, "''")}'`;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((item) => `${spaces}- ${specToYaml(item, indent + 2).trim()}`)
      .join("\n");
  }

  if (typeof obj === "object" && isEmptyContainer(obj)) {
    return "{}";
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, value]) => {
        const valueStr = specToYaml(value, indent + 2);
        // Empty arrays/objects serialize to "[]"/"{}" with no indentation, so
        // they must stay on the key's line — emitting them on the next line
        // puts a bare "[]" in column 0 and makes the document unparseable.
        if (isEmptyContainer(value)) {
          return `${spaces}${key}: ${valueStr}`;
        }
        if (
          valueStr.includes("\n") ||
          (typeof value === "object" && value !== null)
        ) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr.trim()}`;
      })
      .join("\n");
  }

  return String(obj);
}

// Only write the file when run directly (`npm run gen-openapi`); importing this
// module — e.g. from the CI validator — must have no side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  saveSpec();
}
