import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("dotenv/config", () => ({}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn(() => ({ publicKey: () => "GMOCKAGENTWALLETPUBKEY123456" })),
  },
  Horizon: { Server: vi.fn(() => ({ loadAccount: vi.fn() })) },
}));

vi.mock("../tools.ts", () => ({
  getSpendingSummary: vi.fn(() => ({})),
  getWalletBalance: vi.fn(),
  setSpendingPolicy: vi.fn(),
  getSpendingTracker: vi.fn(() => ({ transactions: [] })),
  resetSpendingTracker: vi.fn(),
  saveSpending: vi.fn(),
  generateDisputeLetter: vi.fn(),
  getAdherenceStatus: vi.fn(),
  confirmAdherenceReminder: vi.fn(),
  setCurrentRecipient: vi.fn(),
  SpendingPolicySchema: { safeParse: vi.fn() },
  previewSpendingPolicy: vi.fn(),
  getDataDir: vi.fn(() => process.env.DATA_DIR ?? "data"),
  approvePendingTransaction: vi.fn(),
}));

vi.mock("../../services/vitals/db.ts", () => ({
  createVitalsStore: vi.fn(() => ({})),
}));
vi.mock("../../services/vitals/routes.ts", () => ({
  createVitalsRouter: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock("../../services/interaction-checks/db.ts", () => ({
  getInteractionCheckStore: vi.fn(() => ({})),
}));
vi.mock("../../services/interaction-checks/routes.ts", () => ({
  createInteractionChecksRouter: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));
vi.mock("../../services/agent-history/db.ts", () => ({
  getAgentHistoryStore: vi.fn(() => ({})),
}));
vi.mock("../../services/agent-history/routes.ts", () => ({
  createAgentHistoryRouter: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));
vi.mock("../../services/care-recipients/db.ts", () => ({
  createCareRecipientsStore: vi.fn(() => ({})),
}));
vi.mock("../../services/care-recipients/delegation.ts", () => ({
  authorizeApprovalActor: vi.fn(),
  createDelegationsRouter: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

process.env.LLM_API_KEY = "test-llm-key";
process.env.AGENT_SECRET_KEY =
  "SCZANGBA5YHTNYVS23C4QSOT45PZCBL2D4ZO5TSRE73UFYS3FMAJNMX";
process.env.CAREGIVER_TOKEN = "test-caregiver-token";
process.env.AGENT_API_KEY = "test-agent-api-key";
process.env.STELLAR_NETWORK = "public";
process.env.WEBHOOK_SECRET = "test-webhook-secret";

const { app } = await import("../server.ts");
const { computeWebhookSignature } = await import("../../shared/verify-webhook.ts");

const auth = { Authorization: "Bearer test-agent-api-key" };

function signedWebhook(body: string, webhookId: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return request(app)
    .post("/webhooks/stellar/deposit")
    .set({
      "content-type": "application/json",
      "x-webhook-id": webhookId,
      "x-webhook-timestamp": timestamp,
      "x-webhook-signature": computeWebhookSignature(
        process.env.WEBHOOK_SECRET!,
        timestamp,
        body,
      ),
    })
    .send(body);
}

describe("agent server root metadata", () => {
  it("reports default metadata from the resolved configuration", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body.network).toBe("stellar:public");
    expect(res.body.recipients).toEqual(["rosa"]);
    expect(res.body.caregiver).toBe("Maria Garcia");
  });

  it("reports recipient IDs added at runtime", async () => {
    const updated = await request(app)
      .put("/agent/recipients/ana")
      .set(auth)
      .send({ name: "Ana Garcia" });
    expect(updated.status).toBe(200);

    const res = await request(app).get("/");

    expect(res.body.recipients).toEqual(["rosa", "ana"]);
  });

  it("reports the mutable caregiver name", async () => {
    const updated = await request(app)
      .patch("/agent/profile")
      .set(auth)
      .send({ caregiver: { name: "Updated Caregiver" } });
    expect(updated.status).toBe(200);

    const res = await request(app).get("/");

    expect(res.body.caregiver).toBe("Updated Caregiver");
  });
});

describe("POST /webhooks/stellar/deposit", () => {
  it("returns a 400 for validly signed malformed JSON", async () => {
    const body = '{"event":';
    const webhookId = "evt-malformed-json";
    const res = await signedWebhook(body, webhookId);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON in webhook payload" });
  });

  it("continues to accept valid signed JSON payloads", async () => {
    const res = await signedWebhook('{"event":"deposit"}', "evt-valid-json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "received" });
  });
});
