/**
 * #1334 — Mock LLM provider implementing a minimal OpenAI-compatible
 * /chat/completions endpoint that returns scripted tool-call responses.
 * Allows fully offline agent development without API keys.
 *
 * Usage:
 *   npx tsx services/mock-llm/server.ts
 *   # Then set LLM_BASE_URL=http://localhost:3005 in .env
 *
 * The mock inspects the user message and returns deterministic tool calls
 * matching the agent's known tool names (compare_prices, check_interactions,
 * audit_bill, get_balance, send_payment).
 */

import http from "node:http";

const PORT = parseInt(process.env.MOCK_LLM_PORT || "3005", 10);
const RESPONSE_DELAY_MS = Math.max(
  0,
  Number(process.env.MOCK_LLM_DELAY_MS || 0),
);

const MOCK_TOOLS: Record<string, { tool: string; args: Record<string, unknown>; result: string }> = {
  "price|medication|aspirin|compare": {
    tool: "compare_medication_prices",
    args: { medication: "aspirin", dosage: "81mg" },
    result: JSON.stringify({
      pharmacy_1: { price_usdc: 5.99, available: true },
      pharmacy_2: { price_usdc: 6.49, available: true },
      pharmacy_3: { price_usdc: 4.99, available: true },
    }),
  },
  "interaction|drug|metformin|ibuprofen": {
    tool: "check_drug_interactions",
    args: { drug_a: "metformin", drug_b: "ibuprofen" },
    result: JSON.stringify({
      interactions: [
        { severity: "moderate", description: "NSAIDs may reduce renal function, increasing metformin accumulation risk" },
      ],
    }),
  },
  "bill|audit|overcharge|cpt": {
    tool: "audit_bill",
    args: { line_items: [{ cpt: "99213", amount: 250, quantity: 3 }] },
    result: JSON.stringify({
      total_billed: 750,
      suggested: 450,
      overcharges: [{ cpt: "99213", billed: 250, suggested: 150, reason: "upcoded from 99212" }],
    }),
  },
  "balance|wallet|usdc|xlm": {
    tool: "get_balance",
    args: {},
    result: JSON.stringify({ usdc: 85.5, xlm: 12.3 }),
  },
  "pay|send|transfer|payment": {
    tool: "send_payment",
    args: { recipient: "PHARMACY_1", amount_usdc: 15, memo: "metformin" },
    result: JSON.stringify({ success: true, tx_hash: "mock_tx_hash_abc123" }),
  },
};

function matchTool(userMessage: string): { tool: string; args: Record<string, unknown>; result: string } {
  const lower = userMessage.toLowerCase();

  for (const [pattern, response] of Object.entries(MOCK_TOOLS)) {
    const keywords = pattern.split("|");
    if (keywords.every((kw) => lower.includes(kw))) {
      return response;
    }
  }

  // Default: echo back as a text response
  return {
    tool: "none",
    args: {},
    result: `Mock LLM received: "${userMessage}". Configure specific mock responses in services/mock-llm/server.ts for this scenario.`,
  };
}

const server = http.createServer((req, res) => {
  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const respond = () => {
      try {
        const parsed = JSON.parse(body);
        const messages = parsed.messages || [];
        const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === "user");
        const userContent = lastUserMsg?.content || "";

        const match = matchTool(userContent);

        // Determine if we should return a tool call or a text response
        if (match.tool !== "none") {
          // Return as a tool call in OpenAI format
          const response = {
            id: `mock-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: parsed.model || "mock-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: `call_mock_${Date.now()}`,
                      type: "function",
                      function: {
                        name: match.tool,
                        arguments: JSON.stringify(match.args),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          };

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        } else {
          // Return as a text response
          const response = {
            id: `mock-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: parsed.model || "mock-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: match.result,
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          };

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid request body" } }));
      }
      };
      if (RESPONSE_DELAY_MS > 0) {
        setTimeout(respond, RESPONSE_DELAY_MS);
      } else {
        respond();
      }
    });
    return;
  }

  // Health check
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "mock-llm" }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "Not found" } }));
});

server.listen(PORT, () => {
  console.log(`🤖 Mock LLM server running on http://localhost:${PORT}`);
  console.log(`   Set LLM_BASE_URL=http://localhost:${PORT} in .env to use it`);
  console.log(`   Supports: /v1/chat/completions (OpenAI-compatible)`);
  console.log(`   Known tools: compare_medication_prices, check_drug_interactions, audit_bill, get_balance, send_payment`);
});
