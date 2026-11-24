/**
 * Benchmark: shared/free-text.ts parsing cost (#1315)
 *
 * Measures parsing time and memory overhead for freeTextSchema and
 * delimitedFreeTextListSchema across 100, 1,000, and 10,000 character inputs.
 * Analyzes dominant costs (regex, string allocations, transformations).
 *
 * Run: npx tsx benchmarks/free-text-parsing.ts
 */

import { z } from "zod";
import {
  freeTextSchema,
  optionalFreeTextSchema,
  zipCodeSchema,
  delimitedFreeTextListSchema,
  MAX_FREE_TEXT_LENGTH,
  MAX_TEXT_LIST_ITEMS,
  MAX_FREE_TEXT_LIST_LENGTH,
} from "../shared/free-text.ts";
import { TaskInputSchema, validateTask } from "../shared/task-validation.ts";

const ITERATIONS = 10_000;

interface BenchmarkResult {
  name: string;
  inputLength: number;
  iterations: number;
  totalMs: number;
  avgPerCallNs: number;
  p50Ns: number;
  p95Ns: number;
  p99Ns: number;
  opsPerSec: number;
  success: boolean;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function bench(name: string, inputLength: number, iterations: number, fn: () => void): BenchmarkResult {
  const timesNs: number[] = [];
  let success = true;

  // Warmup
  for (let i = 0; i < 500; i++) {
    try {
      fn();
    } catch {
      success = false;
    }
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    try {
      fn();
    } catch {
      success = false;
    }
    timesNs.push((performance.now() - t0) * 1_000_000);
  }
  const totalMs = performance.now() - start;
  const sorted = [...timesNs].sort((a, b) => a - b);

  return {
    name,
    inputLength,
    iterations,
    totalMs,
    avgPerCallNs: (totalMs * 1_000_000) / iterations,
    p50Ns: percentile(sorted, 50),
    p95Ns: percentile(sorted, 95),
    p99Ns: percentile(sorted, 99),
    opsPerSec: (iterations / totalMs) * 1000,
    success,
  };
}

function generateInput(length: number, delimiter = ", "): string {
  const words = [
    "Lisinopril", "Metformin", "Amlodipine", "Levothyroxine", "Atorvastatin",
    "Metoprolol", "Omeprazole", "Losartan", "Albuterol", "Gabapentin",
    "Hydrochlorothiazide", "Sertraline", "Simvastatin", "Montelukast", "Escitalopram"
  ];
  let res = "";
  let idx = 0;
  while (res.length < length) {
    const w = words[idx % words.length];
    if (res.length > 0) res += delimiter;
    res += w;
    idx++;
  }
  return res.slice(0, length);
}

function printHeader(title: string) {
  console.log(`\n========================================================================`);
  console.log(`  ${title}`);
  console.log(`========================================================================`);
}

function printResult(r: BenchmarkResult) {
  console.log(
    `  ${r.name.padEnd(42)} | len=${String(r.inputLength).padStart(5)} | avg=${r.avgPerCallNs.toFixed(0).padStart(6)} ns | p95=${r.p95Ns.toFixed(0).padStart(6)} ns | ${r.opsPerSec.toFixed(0).padStart(9)} ops/s | status=${r.success ? "OK" : "ERR"}`,
  );
}

async function main() {
  console.log(`\nFree-Text Parsing Benchmark (#1315)`);
  console.log(`Node: ${process.version} | Iterations: ${ITERATIONS.toLocaleString()}\n`);

  const input100 = generateInput(100);
  const input1000 = generateInput(1000);
  const input10000 = generateInput(10000);

  // 1. Zod FreeTextSchema parsing
  printHeader("1. freeTextSchema(name) - Fixed Cap MAX_FREE_TEXT_LENGTH (80 chars)");
  const nameSchema = freeTextSchema("drugName");
  printResult(bench("freeTextSchema (valid 50 chars)", 50, ITERATIONS, () => {
    nameSchema.safeParse("Lisinopril 10mg daily after meal");
  }));
  printResult(bench("freeTextSchema (100 chars - over limit)", 100, ITERATIONS, () => {
    nameSchema.safeParse(input100);
  }));
  printResult(bench("freeTextSchema (1,000 chars - over limit)", 1000, ITERATIONS, () => {
    nameSchema.safeParse(input1000);
  }));
  printResult(bench("freeTextSchema (10,000 chars - over limit)", 10000, ITERATIONS, () => {
    nameSchema.safeParse(input10000);
  }));

  // 2. Delimited Free Text List Schema
  printHeader("2. delimitedFreeTextListSchema(name) - Transform & Split");
  const listSchema = delimitedFreeTextListSchema("medications", ",");
  const validList100 = "Lisinopril, Metformin, Amlodipine, Atorvastatin, Losartan"; // valid list within 20 items & 1619 chars
  printResult(bench("delimitedList (valid ~55 chars)", 55, ITERATIONS, () => {
    listSchema.safeParse(validList100);
  }));
  printResult(bench("delimitedList (100 chars)", 100, ITERATIONS, () => {
    listSchema.safeParse(input100);
  }));
  printResult(bench("delimitedList (1,000 chars)", 1000, ITERATIONS, () => {
    listSchema.safeParse(input1000);
  }));
  printResult(bench("delimitedList (10,000 chars - over max)", 10000, ITERATIONS, () => {
    listSchema.safeParse(input10000);
  }));

  // 3. Unconstrained Schema Simulation (What if no length cap was present?)
  printHeader("3. Unconstrained Delimited Split & Transform (Simulated No-Cap)");
  const unconstrainedDelimited = (input: string) => {
    return input
      .trim()
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  };
  printResult(bench("unconstrained split+map (100 chars)", 100, ITERATIONS, () => {
    unconstrainedDelimited(input100);
  }));
  printResult(bench("unconstrained split+map (1,000 chars)", 1000, ITERATIONS, () => {
    unconstrainedDelimited(input1000);
  }));
  printResult(bench("unconstrained split+map (10,000 chars)", 10000, ITERATIONS, () => {
    unconstrainedDelimited(input10000);
  }));

  // 4. Task Input Validation & Sanitization (validateTask / TaskInputSchema)
  printHeader("4. validateTask() - Control Char Stripping, JSON Parsing & Blocklist Search");
  printResult(bench("validateTask (100 chars)", 100, ITERATIONS, () => {
    validateTask(input100);
  }));
  printResult(bench("validateTask (1,000 chars)", 1000, ITERATIONS, () => {
    validateTask(input1000);
  }));
  printResult(bench("validateTask (10,000 chars - exceeds 5000 cap)", 10000, ITERATIONS, () => {
    validateTask(input10000);
  }));

  // 5. Breakdown of Micro-operations
  printHeader("5. Micro-Operation Cost Breakdown on 10,000 chars");
  const ctrlRe = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;
  printResult(bench("Regex replace control chars (10k)", 10000, ITERATIONS, () => {
    input10000.replace(ctrlRe, "");
  }));
  printResult(bench("String.prototype.trim (10k)", 10000, ITERATIONS, () => {
    input10000.trim();
  }));
  printResult(bench("String.prototype.toLowerCase (10k)", 10000, ITERATIONS, () => {
    input10000.toLowerCase();
  }));
  const blocklist = ["ignore all instructions", "jailbreak", "act as if", "dan "];
  const lower10k = input10000.toLowerCase();
  printResult(bench("Blocklist token search (10k)", 10000, ITERATIONS, () => {
    blocklist.find((token) => lower10k.includes(token));
  }));
  printResult(bench("JSON.parse attempt on non-JSON (10k)", 10000, ITERATIONS, () => {
    try { JSON.parse(input1000); } catch {}
  }));

  console.log(`\n========================================================================`);
  console.log(`Benchmark Run Complete.`);
}

main().catch(console.error);
