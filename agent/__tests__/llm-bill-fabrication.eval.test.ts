import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync(resolve("agent/server.ts"), "utf8");

describe("LLM eval: billing amounts are tool-sourced", () => {
  it("tells the agent not to fabricate bill amounts", () => {
    expect(serverSource).toContain(
      "Never invent. The only billing data source is fetch_rosa_bill, which returns a sample bill for the demo. In production this is replaced with real EDI feeds.",
    );
    expect(serverSource).toContain("use fetch_and_audit_bill");
    expect(serverSource).not.toContain("make up bill");
    expect(serverSource).not.toContain("estimate bill amount");
  });
});
