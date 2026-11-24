import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

vi.mock("dotenv/config", () => ({}));
vi.mock("../shared/x402-verify-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.invalid/facilitator",
}));
vi.mock("../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.invalid/facilitator",
}));

vi.spyOn(Keypair, "fromSecret").mockImplementation(() => Keypair.random());

process.env.LLM_API_KEY = "mock-key";
process.env.AGENT_SECRET_KEY = "S-mock-secret";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTPHARMACY2";
process.env.MPP_SECRET_KEY = "S-mock-secret";
process.env.CAREGIVER_TOKEN = "mock-token";
process.env.BILL_AUDIT_API_PORT = "0";

const { app: unifiedApp } = await import("../server.ts");
const { app: standaloneApp } = await import(
  "../services/bill-audit-api/server.ts"
);

describe("bill-audit configuration parity", () => {
  it("applies the configured CPT threshold in unified and standalone modes", async () => {
    const bill = {
      lineItems: [
        {
          description: "Physical therapy",
          cptCode: "97110",
          quantity: 1,
          chargedAmount: 90,
        },
      ],
    };

    const [unified, standalone] = await Promise.all([
      request(unifiedApp).post("/bill/audit").send(bill),
      request(standaloneApp).post("/bill/audit").send(bill),
    ]);

    expect(unified.status).toBe(200);
    expect(standalone.status).toBe(200);
    expect(unified.body.lineItems[0].status).toBe("valid");
    expect(unified.body.lineItems[0].status).toBe(
      standalone.body.lineItems[0].status,
    );
    expect(unified.body.errorCount).toBe(standalone.body.errorCount);
  });
});
