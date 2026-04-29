import { describe, it, expect, beforeEach } from "vitest";
import {
  incCounter,
  getCounterValue,
  observeHistogram,
  getHistogram,
  recordToolCall,
  getToolSummary,
  recordStellarSubmit,
  recordStellarResult,
  recordStellarLatency,
  renderMetrics,
  HISTOGRAM_BUCKETS,
  _resetForTesting,
} from "../metrics.ts";

beforeEach(() => {
  _resetForTesting();
});

// ── Counters ──────────────────────────────────────────────────────────────────

describe("incCounter / getCounterValue", () => {
  it("starts at zero", () => {
    expect(getCounterValue("my_counter")).toBe(0);
  });

  it("increments by 1 each call", () => {
    incCounter("my_counter");
    incCounter("my_counter");
    expect(getCounterValue("my_counter")).toBe(2);
  });

  it("supports label differentiation", () => {
    incCounter("tx_total", { kind: "a" });
    incCounter("tx_total", { kind: "a" });
    incCounter("tx_total", { kind: "b" });
    expect(getCounterValue("tx_total", { kind: "a" })).toBe(2);
    expect(getCounterValue("tx_total", { kind: "b" })).toBe(1);
  });

  it("treats different label sets as distinct keys", () => {
    incCounter("tx", { kind: "x", result: "success" });
    incCounter("tx", { kind: "x", result: "failed" });
    expect(getCounterValue("tx", { kind: "x", result: "success" })).toBe(1);
    expect(getCounterValue("tx", { kind: "x", result: "failed" })).toBe(1);
  });
});

// ── Histograms ────────────────────────────────────────────────────────────────

describe("observeHistogram / getHistogram", () => {
  it("returns undefined before any observation", () => {
    expect(getHistogram("latency_ms")).toBeUndefined();
  });

  it("accumulates sum and count", () => {
    observeHistogram("latency_ms", 100);
    observeHistogram("latency_ms", 200);
    const h = getHistogram("latency_ms")!;
    expect(h.sum).toBe(300);
    expect(h.count).toBe(2);
  });

  it("fills correct bucket when value equals a boundary", () => {
    observeHistogram("latency_ms", 100, { tool: "t" });
    const h = getHistogram("latency_ms", { tool: "t" })!;
    expect(h.buckets.get(100)).toBe(1);
    expect(h.buckets.get(250)).toBe(1);
    expect(h.buckets.get(10)).toBe(0);
  });

  it("fills no bucket when value exceeds the largest bucket", () => {
    const max = HISTOGRAM_BUCKETS[HISTOGRAM_BUCKETS.length - 1];
    observeHistogram("latency_ms", max + 1);
    const h = getHistogram("latency_ms")!;
    for (const b of HISTOGRAM_BUCKETS) {
      expect(h.buckets.get(b)).toBe(0);
    }
    expect(h.count).toBe(1);
  });
});

// ── Tool tracking ─────────────────────────────────────────────────────────────

describe("recordToolCall / getToolSummary", () => {
  it("records calls and computes totals", () => {
    recordToolCall("compare_pharmacy_prices", 120, 0.002);
    recordToolCall("compare_pharmacy_prices", 80, 0.002);
    const summary = getToolSummary();
    expect(summary["compare_pharmacy_prices"].calls).toBe(2);
    expect(summary["compare_pharmacy_prices"].totalLatencyMs).toBe(200);
    expect(summary["compare_pharmacy_prices"].totalCostUsdc).toBeCloseTo(0.004);
  });

  it("computes avgLatencyMs", () => {
    recordToolCall("t", 100);
    recordToolCall("t", 200);
    expect(getToolSummary()["t"].avgLatencyMs).toBe(150);
  });

  it("filters by sinceMs", async () => {
    recordToolCall("t", 50);
    const cutoff = Date.now();
    // small delay so next call is definitly after cutoff
    await new Promise((r) => setTimeout(r, 5));
    recordToolCall("t", 50);
    const summary = getToolSummary(cutoff + 1);
    expect(summary["t"].calls).toBe(1);
  });

  it("returns empty when no calls in window", () => {
    recordToolCall("t", 50);
    const future = Date.now() + 999999;
    expect(getToolSummary(future)).toEqual({});
  });

  it("feeds agent_tool_latency_ms histogram", () => {
    recordToolCall("t", 55);
    const h = getHistogram("agent_tool_latency_ms", { tool: "t" });
    expect(h).toBeDefined();
    expect(h!.count).toBe(1);
  });

  it("increments agent_tool_cost_usdc_calls counter when costUsdc > 0", () => {
    recordToolCall("t", 10, 0.001);
    expect(getCounterValue("agent_tool_cost_usdc_calls", { tool: "t" })).toBe(1);
  });

  it("does not increment cost counter when costUsdc is 0", () => {
    recordToolCall("t", 10, 0);
    expect(getCounterValue("agent_tool_cost_usdc_calls", { tool: "t" })).toBe(0);
  });
});

// ── Stellar helpers ───────────────────────────────────────────────────────────

describe("Stellar metric helpers", () => {
  it("recordStellarSubmit increments stellar_tx_submitted_total", () => {
    recordStellarSubmit("usdc_transfer");
    recordStellarSubmit("usdc_transfer");
    expect(getCounterValue("stellar_tx_submitted_total", { kind: "usdc_transfer" })).toBe(2);
  });

  it("recordStellarSubmit tracks different kinds independently", () => {
    recordStellarSubmit("mpp_charge");
    recordStellarSubmit("change_trust");
    expect(getCounterValue("stellar_tx_submitted_total", { kind: "mpp_charge" })).toBe(1);
    expect(getCounterValue("stellar_tx_submitted_total", { kind: "change_trust" })).toBe(1);
  });

  it("recordStellarResult increments stellar_tx_result_total with result label", () => {
    recordStellarResult("usdc_transfer", "success");
    recordStellarResult("usdc_transfer", "tx_bad_seq");
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "success" })
    ).toBe(1);
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "tx_bad_seq" })
    ).toBe(1);
  });

  it("recordStellarLatency populates stellar_submit_latency_ms histogram", () => {
    recordStellarLatency("usdc_transfer", 350);
    const h = getHistogram("stellar_submit_latency_ms", { kind: "usdc_transfer" });
    expect(h).toBeDefined();
    expect(h!.sum).toBe(350);
    expect(h!.count).toBe(1);
    expect(h!.buckets.get(500)).toBe(1);
    expect(h!.buckets.get(250)).toBe(0);
  });
});

// ── renderMetrics ─────────────────────────────────────────────────────────────

describe("renderMetrics", () => {
  it("returns empty string when nothing has been recorded", () => {
    expect(renderMetrics()).toBe("");
  });

  it("includes counter lines", () => {
    incCounter("stellar_tx_submitted_total", { kind: "usdc_transfer" });
    const out = renderMetrics();
    expect(out).toContain("stellar_tx_submitted_total");
    expect(out).toContain('kind="usdc_transfer"');
    expect(out).toContain("# TYPE stellar_tx_submitted_total counter");
  });

  it("includes histogram _bucket, _sum, _count lines", () => {
    observeHistogram("stellar_submit_latency_ms", 200, { kind: "usdc_transfer" });
    const out = renderMetrics();
    expect(out).toContain("stellar_submit_latency_ms_bucket");
    expect(out).toContain("stellar_submit_latency_ms_sum");
    expect(out).toContain("stellar_submit_latency_ms_count");
    expect(out).toContain('le="+Inf"');
  });

  it("includes agent_tool_cost_usdc_total gauge for tools with cost > 0", () => {
    recordToolCall("compare_pharmacy_prices", 100, 0.002);
    const out = renderMetrics();
    expect(out).toContain("agent_tool_cost_usdc_total");
    expect(out).toContain('tool="compare_pharmacy_prices"');
  });

  it("omits agent_tool_cost_usdc_total for tools with cost == 0", () => {
    recordToolCall("pay_bill", 500, 0);
    const out = renderMetrics();
    expect(out).not.toContain('agent_tool_cost_usdc_total{tool="pay_bill"}');
  });
});
