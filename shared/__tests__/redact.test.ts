import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { redact, redactString, redactPII, hashTask } from "../redact.ts";

const FAKE_SECRET = Keypair.random().secret(); // 56 chars, S + 55 base32

describe("redactString", () => {
  it("redacts Stellar secret seeds (S + 55 base32 chars)", () => {
    const input = `key=${FAKE_SECRET} and more`;
    const output = redactString(input);
    expect(output).not.toContain(FAKE_SECRET);
    expect(output).toContain("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
    const output = redactString(input);
    expect(output).toMatch(/Bearer \[REDACTED\]/);
  });

  it("leaves plain text alone", () => {
    expect(redactString("hello world")).toBe("hello world");
  });
});

describe("redact (object)", () => {
  it("redacts known secret field names", () => {
    const input = {
      task: "Refill Rosa's lisinopril",
      AGENT_SECRET_KEY: "SCZANGBA...whatever",
      drug: "Lisinopril",
    };
    const out = redact(input);
    expect(out.task).toBe("[REDACTED]");
    expect(out.AGENT_SECRET_KEY).toBe("[REDACTED]");
    expect(out.drug).toBe("Lisinopril");
  });

  it("redacts secret seeds inside nested string values", () => {
    const input = {
      logs: [`wallet=${FAKE_SECRET}`],
    };
    const out = redact(input);
    expect(out.logs[0]).not.toContain(FAKE_SECRET);
  });

  it("handles arrays", () => {
    const out = redact([{ task: "leak" }, { drug: "ok" }]);
    expect(out[0].task).toBe("[REDACTED]");
    expect(out[1].drug).toBe("ok");
  });

  it("redacts Authorization header field", () => {
    const out = redact({ headers: { Authorization: "Bearer abc.def.ghi-1234567890" } });
    expect(out.headers.Authorization).toBe("[REDACTED]");
  });

  it("returns primitives unchanged", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(true)).toBe(true);
  });

  it("does not crash on cyclic-shaped deep objects (depth-limited)", () => {
    const deep: any = {};
    let cur = deep;
    for (let i = 0; i < 50; i++) {
      cur.next = { v: "x" };
      cur = cur.next;
    }
    expect(() => redact(deep)).not.toThrow();
  });
});

describe("redactPII", () => {
  it("redacts patient names (two consecutive capitalized words)", () => {
    const input = "Please refill Rosa Garcia's prescription";
    const output = redactPII(input);
    expect(output).not.toContain("Rosa Garcia");
    expect(output).toContain("[PATIENT NAME]");
  });

  it("redacts drug specifics (drug name with dosage)", () => {
    const input = "Order Lisinopril 10mg for the patient";
    const output = redactPII(input);
    expect(output).not.toContain("Lisinopril 10mg");
    expect(output).toContain("[MEDICATION]");
  });

  it("redacts both patient names and drug specifics in the same string", () => {
    const input = "Refill Metformin 500mg for Rosa Garcia";
    const output = redactPII(input);
    expect(output).not.toContain("Rosa Garcia");
    expect(output).not.toContain("Metformin 500mg");
    expect(output).toContain("[PATIENT NAME]");
    expect(output).toContain("[MEDICATION]");
  });

  it("leaves non-PII text unchanged", () => {
    const input = "Check the spending policy summary";
    expect(redactPII(input)).toBe(input);
  });

  it("redacts all occurrences in a long string", () => {
    const input = "Rosa Garcia needs Rosa Garcia's medications";
    const output = redactPII(input);
    expect(output.match(/\[PATIENT NAME\]/g)?.length).toBe(2);
  });
});

describe("hashTask", () => {
  it("produces a deterministic SHA-256 hash", () => {
    const task = "Refill Rosa Garcia's prescription";
    const hash = hashTask(task);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces the same hash for the same input", () => {
    const task = "Check spending for Rosa Garcia";
    expect(hashTask(task)).toBe(hashTask(task));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashTask("Task A")).not.toBe(hashTask("Task B"));
  });

  it("logs a hash while redacting the patient name from the task", () => {
    const task = "Rosa Garcia needs Metformin 500mg";
    const hash = hashTask(task);
    const redacted = redactPII(task);

    expect(hash).toHaveLength(64);
    expect(redacted).not.toContain("Rosa Garcia");
    expect(redacted).not.toContain("Metformin 500mg");
    expect(redacted).toContain("[PATIENT NAME]");
    expect(redacted).toContain("[MEDICATION]");

    const task2 = "Someone else needs something else";
    expect(hashTask(task2)).not.toBe(hash);
  });
});
