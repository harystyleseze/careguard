import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * The unified server (server.ts) must expose the same adherence endpoints as
 * agent/server.ts, backed by the shared helpers in shared/adherence.ts and
 * agent/tools.ts, so medication-adherence tracking is reachable in production.
 */

vi.spyOn(Keypair, "fromSecret").mockImplementation(() => {
  return {
    publicKey: () => "GBQTESTPHARMACY1",
    secret: () => "mock-secret",
  } as any;
});

vi.mock("../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.test/x402",
}));

process.env.LLM_API_KEY = "mock-key";
process.env.AGENT_SECRET_KEY = "S-mock-secret";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTPHARMACY2";
process.env.MPP_SECRET_KEY = "S-mock-secret";
process.env.CAREGIVER_TOKEN = "mock-token";
delete process.env.AGENT_API_KEY;

const { app } = await import("../server.ts");
const { appendAdherenceRecord } = await import("../shared/adherence.ts");

describe("unified server adherence endpoints", () => {
  const recipientId = `adh-test-${Date.now()}`;

  it("lists a due reminder as pending and confirms it", async () => {
    const recordId = appendAdherenceRecord({
      recipientId,
      drug: "Lisinopril",
      dosage: "10mg",
      pharmacy: "Test Pharmacy",
      orderId: "order-1",
      daysSupply: 30,
      orderedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
      status: "pending",
      skippedCount: 0,
    });

    const pendingRes = await request(app)
      .get("/agent/adherence/pending")
      .query({ recipient_id: recipientId });
    expect(pendingRes.status).toBe(200);
    expect(pendingRes.body.recipientId).toBe(recipientId);
    expect(pendingRes.body.count).toBe(1);
    expect(pendingRes.body.pending[0].id).toBe(recordId);

    const statusRes = await request(app)
      .get("/agent/adherence")
      .query({ recipient_id: recipientId });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.pendingReminders).toBe(1);

    const confirmRes = await request(app)
      .post("/agent/adherence/confirm")
      .send({ record_id: recordId });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body).toEqual({ success: true });

    const afterRes = await request(app)
      .get("/agent/adherence/pending")
      .query({ recipient_id: recipientId });
    expect(afterRes.body).toEqual({ pending: [], count: 0, recipientId });
  });

  it("rejects a confirm without record_id", async () => {
    const res = await request(app).post("/agent/adherence/confirm").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "record_id is required" });
  });

  it("reports success: false for an unknown record", async () => {
    const res = await request(app)
      .post("/agent/adherence/confirm")
      .send({ record_id: "adh-does-not-exist" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false });
  });
});
