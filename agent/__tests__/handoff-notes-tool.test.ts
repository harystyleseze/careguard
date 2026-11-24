/**
 * get_handoff_notes agent tool (#1180): the agent reads the latest shift
 * handoff notes from the same store the /recipients/:id/handoff-notes routes
 * write to, with PII redacted before the result reaches the LLM.
 */

vi.hoisted(() => {
  process.env.MOCK_NETWORK = "1";
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
});

vi.mock("dotenv/config", () => ({}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUB123", sign: vi.fn() }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: vi.fn(), submitTransaction: vi.fn() }) },
}));
vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn().mockReturnValue({}),
  ExactStellarScheme: vi.fn(),
}));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockImplementation(() => ({})) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
  decodePaymentResponseHeader: vi.fn(),
}));

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { TOOL_DEFINITIONS, validateToolInput } from "../tools.ts";
import { executeTool } from "../runner.ts";
import { DEFAULT_RECIPIENT_ID, getCareRecipientsStore } from "../../services/care-recipients/db.ts";

beforeAll(() => {
  const store = getCareRecipientsStore();
  store.addHandoffNote({ recipient_id: DEFAULT_RECIPIENT_ID, author: "Maria Garcia", text: "Rosa Garcia slept well." });
  store.addHandoffNote({ recipient_id: DEFAULT_RECIPIENT_ID, author: "David", text: "Gave Metformin 500mg late, watch for nausea." });
  store.addHandoffNote({ recipient_id: DEFAULT_RECIPIENT_ID, author: "David", text: "Lunch eaten." });
});

afterEach(() => {
  delete process.env.LLM_PII_SCRUB;
});

describe("get_handoff_notes tool (#1180)", () => {
  it("is declared with a strict schema", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "get_handoff_notes");
    expect(tool?.input_schema.additionalProperties).toBe(false);
    expect(Object.keys(tool!.input_schema.properties)).toEqual(["recipient_id", "limit"]);
  });

  it("returns the latest notes newest first, defaulting to the seeded recipient", async () => {
    const result = (await executeTool("get_handoff_notes", { limit: 2 })) as any;

    expect(result.recipientId).toBe(DEFAULT_RECIPIENT_ID);
    expect(result.count).toBe(2);
    expect(result.notes.map((n: { text: string }) => n.text)).toEqual([
      "Lunch eaten.",
      "Gave [MEDICATION] late, watch for nausea.",
    ]);
  });

  it("redacts known names and drug-plus-dose mentions before they reach the LLM", async () => {
    const result = (await executeTool("get_handoff_notes", { recipient_id: DEFAULT_RECIPIENT_ID })) as any;
    const oldest = result.notes.at(-1);
    expect(oldest.author).toBe("[PATIENT NAME]");
    expect(oldest.text).toBe("[PATIENT NAME] slept well.");
  });

  it("passes notes through unredacted when PHI scrubbing is disabled", async () => {
    process.env.LLM_PII_SCRUB = "false";
    const result = (await executeTool("get_handoff_notes", {})) as any;
    expect(result.notes.at(-1).text).toBe("Rosa Garcia slept well.");
  });

  it("returns an empty list for a recipient without notes", async () => {
    const result = (await executeTool("get_handoff_notes", { recipient_id: "nobody" })) as any;
    expect(result).toEqual({ recipientId: "nobody", count: 0, notes: [] });
  });

  it("rejects out-of-range limits and unknown fields", () => {
    expect(() => validateToolInput("get_handoff_notes", { limit: 11 })).toThrow(/limit/);
    expect(() => validateToolInput("get_handoff_notes", { text: "x" })).toThrow(/unknown field/);
  });
});
