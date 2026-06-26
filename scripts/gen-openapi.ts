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
import { fileURLToPath } from "url";
import {
  MAX_FREE_TEXT_LENGTH,
  MAX_FREE_TEXT_LIST_LENGTH,
} from "../shared/free-text.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, "../docs");

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

function generateSpec(): OpenAPISpec {
  return {
    openapi: "3.1.0",
    info: {
      title: "CareGuard API",
      version: "1.0.0",
      description:
        "OpenAPI spec for CareGuard services: agent spending, pharmacy, bill audit, drug interactions, and payments.",
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
        X402Auth: [],
      },
    ],
    components: {
      securitySchemes: {
        X402Auth: {
          type: "http",
          scheme: "bearer",
          description:
            "x402 payment protocol. Include X-PAYMENT header with payment proof on protected routes.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            details: { type: "object" },
          },
        },
      },
    },
    paths: {
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
            "400": {
              description: "Invalid request",
            },
          },
        },
      },
      "/pharmacy/prices": {
        post: {
          summary: "Admin upsert for a drug price at a pharmacy",
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
            "400": {
              description: "Validation error",
            },
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
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      errors: { type: "array" },
                    },
                  },
                },
              },
            },
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
            "400": {
              description: "Validation error",
            },
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
            "400": {
              description: "Validation error",
            },
            "402": {
              description: "Payment required",
            },
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

function saveSpec() {
  mkdirSync(docsDir, { recursive: true });

  const spec = generateSpec();
  const yaml = specToYaml(spec);

  const filePath = path.resolve(docsDir, "openapi.yml");
  writeFileSync(filePath, yaml, "utf-8");

  console.log(`✓ OpenAPI spec generated: ${filePath}`);
}

function specToYaml(obj: unknown, indent = 0): string {
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

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, value]) => {
        const valueStr = specToYaml(value, indent + 2);
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

saveSpec();
