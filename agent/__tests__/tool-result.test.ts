import { describe, expect, it, beforeEach } from "vitest";
import {
  clearToolResultStoreForTests,
  fetchToolResult,
  serializeToolResultForPrompt,
} from "../tool-result.ts";

describe("tool result serialization", () => {
  beforeEach(() => {
    clearToolResultStoreForTests();
  });

  it("summarizes oversized bill audits under the 8 KB cap", () => {
    const lineItems = Array.from({ length: 10_000 }, (_, index) => ({
      description: `Line ${index + 1}`,
      cptCode: "99213",
      quantity: 1,
      chargedAmount: 130,
    }));

    const payload = {
      ok: true,
      lineItems,
      totalOvercharge: 0,
      errorCount: 0,
    };

    const serialized = serializeToolResultForPrompt("audit_medical_bill", payload);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(8 * 1024);

    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.summary).toBe("9990 line items elided; first 10 included");
    expect(Array.isArray(parsed.lineItems)).toBe(true);
    expect((parsed.lineItems as unknown[]).length).toBe(10);
    expect(parsed.resultId).toBeTruthy();
  });

  it("lets the follow-up tool page through stored results", () => {
    const lineItems = Array.from({ length: 1_000 }, (_, index) => ({
      description: `Line ${index + 1}`,
      cptCode: "99213",
      quantity: 1,
      chargedAmount: 130,
    }));

    const serialized = serializeToolResultForPrompt("audit_medical_bill", {
      ok: true,
      lineItems,
      totalOvercharge: 0,
      errorCount: 0,
    });
    const parsed = JSON.parse(serialized) as { resultId: string };

    const page = fetchToolResult(parsed.resultId, 10, 10);
    expect(page.ok).toBe(true);
    expect(page.hasMore).toBe(true);
    expect((page.lineItems as unknown[]).length).toBe(10);
  });
});
