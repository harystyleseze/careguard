import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { redact, redactString } from "../redact.ts";

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
