#!/usr/bin/env tsx

/**
 * #1335 — CLI helper to trigger and inspect a single agent run without the
 * dashboard. Posts to the local /agent/run endpoint using CAREGIVER_TOKEN
 * from .env and prints the tool-call sequence and final response.
 *
 * Usage:
 *   npx tsx scripts/agent-cli.ts "Compare medication prices for aspirin"
 *   npx tsx scripts/agent-cli.ts --scenario drug-interaction
 *   npx tsx scripts/agent-cli.ts --scenario bill-audit --verbose
 */

import { readFileSync } from "fs";
import path from "path";

const SCENARIOS: Record<string, string> = {
  "drug-interaction": "Check for drug interactions between metformin and ibuprofen",
  "bill-audit": "Audit this medical bill for overcharges: 3x CPT 99213 at $250 each",
  "medication-price": "Compare medication prices for atorvastatin 20mg across pharmacies",
  "payment": "Pay $15 to pharmacy 1 for metformin prescription",
  "low-balance": "What is the current USDC balance in the agent wallet?",
};

function loadEnv(): { baseUrl: string; token: string } {
  const envPath = path.join(process.cwd(), ".env");
  let envContent = "";
  try {
    envContent = readFileSync(envPath, "utf-8");
  } catch {
    // Fall back to process.env
  }

  function get(key: string): string {
    // Check process.env first
    if (process.env[key]) return process.env[key]!;
    // Then check .env file
    const match = envContent.match(new RegExp(`^${key}=(.+)$`, "m"));
    return match?.[1]?.trim() || "";
  }

  const token = get("CAREGIVER_TOKEN");
  const port = get("PORT") || "3004";
  const baseUrl = `http://localhost:${port}`;

  if (!token) {
    console.error("Error: CAREGIVER_TOKEN not found. Set it in .env or export it.");
    process.exit(1);
  }

  return { baseUrl, token };
}

async function runAgent(
  prompt: string,
  token: string,
  baseUrl: string,
  verbose: boolean,
): Promise<void> {
  const body = JSON.stringify({ prompt });

  console.log(`\n📤 Sending prompt: "${prompt}"\n`);

  const startTime = Date.now();
  try {
    const res = await fetch(`${baseUrl}/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const text = await res.text();
      console.error(`❌ HTTP ${res.status}: ${text}`);
      process.exit(1);
    }

    const data = await res.json() as {
      toolCalls?: Array<{ tool: string; args?: unknown; result?: unknown }>;
      response?: string;
      iterations?: number;
    };

    if (verbose) {
      console.log("📋 Full response:");
      console.log(JSON.stringify(data, null, 2));
      console.log();
    }

    if (data.toolCalls && data.toolCalls.length > 0) {
      console.log(`🔧 Tool calls (${data.toolCalls.length}):`);
      for (const tc of data.toolCalls) {
        console.log(`  → ${tc.tool}`);
        if (verbose && tc.args) {
          console.log(`    args: ${JSON.stringify(tc.args)}`);
        }
        if (tc.result) {
          const resultStr = typeof tc.result === "string"
            ? tc.result
            : JSON.stringify(tc.result);
          const truncated = resultStr.length > 200 ? resultStr.slice(0, 200) + "..." : resultStr;
          console.log(`    result: ${truncated}`);
        }
      }
      console.log();
    }

    if (data.response) {
      console.log(`💬 Response: ${data.response}`);
    }

    if (data.iterations) {
      console.log(`\n⏱️  Completed in ${elapsed}ms (${data.iterations} iteration${data.iterations === 1 ? "" : "s"})`);
    }
  } catch (err: any) {
    if (err?.code === "ECONNREFUSED") {
      console.error(`❌ Cannot connect to ${baseUrl}. Is the server running? Start it with: npm run dev`);
    } else {
      console.error(`❌ Error: ${err?.message || err}`);
    }
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose") || args.includes("-v");
  const scenarioFlag = args.includes("--scenario");
  const filteredArgs = args.filter((a) => a !== "--verbose" && a !== "-v" && a !== "--scenario");

  let prompt: string;

  if (scenarioFlag && filteredArgs.length > 0) {
    const scenarioKey = filteredArgs[0];
    prompt = SCENARIOS[scenarioKey];
    if (!prompt) {
      console.error(`Unknown scenario: ${scenarioKey}`);
      console.error(`Available scenarios: ${Object.keys(SCENARIOS).join(", ")}`);
      process.exit(1);
    }
    console.log(`📋 Using scenario "${scenarioKey}"`);
  } else if (filteredArgs.length > 0) {
    prompt = filteredArgs.join(" ");
  } else {
    console.log("CareGuard Agent CLI\n");
    console.log("Usage:");
    console.log("  npx tsx scripts/agent-cli.ts \"your prompt here\"");
    console.log("  npx tsx scripts/agent-cli.ts --scenario <name>");
    console.log("  npx tsx scripts/agent-cli.ts --scenario <name> --verbose\n");
    console.log("Available scenarios:");
    for (const [key, desc] of Object.entries(SCENARIOS)) {
      console.log(`  ${key.padEnd(20)} ${desc}`);
    }
    process.exit(0);
  }

  const { baseUrl, token } = loadEnv();
  void runAgent(prompt, token, baseUrl, verbose);
}

main();
