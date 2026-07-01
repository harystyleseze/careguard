/**
 * Regression eval: agent must not fabricate amounts not present in tool outputs.
 *
 * This eval calls the agent with a known bill fixture and asserts the
 * final response contains only amounts that were in the tool outputs.
 *
 * Requires LLM_API_KEY in the environment. Skipped automatically if absent.
 */

import { describe, it, expect, beforeAll } from "vitest";

const hasLlmKey = !!process.env.LLM_API_KEY;

describe.runIf(hasLlmKey)("#290 No-fabrication eval", () => {
  const fixtureLineItems = [
    { description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: 130 },
    { description: "CBC blood test", cptCode: "85025", quantity: 1, chargedAmount: 15 },
  ];

  it("agent does not fabricate amounts when auditing the fixture bill", async () => {
    // Dynamically import to avoid loading agent deps at module scope
    const { app } = await import("../server.ts");
    const supertest = (await import("supertest")).default;

    const res = await supertest(app)
      .post("/agent/run")
      .set("Authorization", `Bearer ${process.env.AGENT_API_KEY}`)
      .send({
        task: `Audit this bill for errors. Line items: ${JSON.stringify(fixtureLineItems)}`,
      });

    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).toHaveProperty("response");
    expect(body).toHaveProperty("toolCalls");

    // Collect all amounts mentioned in the final response
    const responseText = body.response;
    const mentionedAmounts = extractAmounts(responseText);

    // Collect all amounts that appeared in the fixture
    const fixtureAmounts = new Set(fixtureLineItems.map((i) => i.chargedAmount));

    // Every dollar amount in the response must correspond to a fixture amount
    for (const amt of mentionedAmounts) {
      expect(fixtureAmounts.has(amt) || amt === 0).toBe(true);
    }

    // Response should reference the actual charged amounts
    expect(responseText).toContain("130");
    expect(responseText).toContain("15");
  }, 60000); // 60s timeout for LLM call
});

function extractAmounts(text: string): number[] {
  // Match $X, $X.XX, or standalone dollar amounts in the text
  const dollarRefs = text.match(/\$(\d+(?:\.\d{1,2})?)/g) || [];
  const amounts = dollarRefs.map((r) => parseFloat(r.slice(1)));
  // Also extract bare numbers that might be amounts in context
  const bareNumbers = text.match(/\b(\d+)\s*dollars?\b/gi) || [];
  for (const match of bareNumbers) {
    amounts.push(parseFloat(match));
  }
  return amounts.filter((a) => Number.isFinite(a));
}
