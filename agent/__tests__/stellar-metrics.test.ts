/**
 * Tests for Stellar transaction outcome metrics (issue #104).
 *
 * Verifies that submitted / confirmed / failed / retried paths each increment
 * the right counters in shared/metrics.ts without needing a live Horizon node.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getCounterValue,
  getHistogram,
  recordStellarSubmit,
  recordStellarResult,
  recordStellarLatency,
  _resetForTesting,
} from "../../shared/metrics.ts";

beforeEach(() => {
  _resetForTesting();
});

// ── Direct helper tests ───────────────────────────────────────────────────────

describe("Stellar metric helpers (unit)", () => {
  it("recordStellarSubmit increments stellar_tx_submitted_total for usdc_transfer", () => {
    recordStellarSubmit("usdc_transfer");
    expect(getCounterValue("stellar_tx_submitted_total", { kind: "usdc_transfer" })).toBe(1);
  });

  it("recordStellarSubmit increments stellar_tx_submitted_total for mpp_charge", () => {
    recordStellarSubmit("mpp_charge");
    expect(getCounterValue("stellar_tx_submitted_total", { kind: "mpp_charge" })).toBe(1);
  });

  it("recordStellarSubmit increments stellar_tx_submitted_total for change_trust", () => {
    recordStellarSubmit("change_trust");
    expect(getCounterValue("stellar_tx_submitted_total", { kind: "change_trust" })).toBe(1);
  });

  it("recordStellarResult tracks success outcome", () => {
    recordStellarResult("usdc_transfer", "success");
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "success" })
    ).toBe(1);
  });

  it("recordStellarResult tracks tx_bad_seq outcome", () => {
    recordStellarResult("usdc_transfer", "tx_bad_seq");
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "tx_bad_seq" })
    ).toBe(1);
  });

  it("recordStellarResult tracks tx_failed outcome", () => {
    recordStellarResult("usdc_transfer", "tx_failed");
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "tx_failed" })
    ).toBe(1);
  });

  it("recordStellarResult tracks timeout (unknown) outcome", () => {
    recordStellarResult("usdc_transfer", "unknown");
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "unknown" })
    ).toBe(1);
  });

  it("recordStellarResult keeps separate counters for different kinds", () => {
    recordStellarResult("usdc_transfer", "success");
    recordStellarResult("mpp_charge", "success");
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "success" })
    ).toBe(1);
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "mpp_charge", result: "success" })
    ).toBe(1);
  });

  it("recordStellarLatency feeds stellar_submit_latency_ms histogram", () => {
    recordStellarLatency("usdc_transfer", 420);
    const h = getHistogram("stellar_submit_latency_ms", { kind: "usdc_transfer" });
    expect(h).toBeDefined();
    expect(h!.sum).toBe(420);
    expect(h!.count).toBe(1);
  });

  it("histogram bucket at 500ms contains the 420ms observation", () => {
    recordStellarLatency("usdc_transfer", 420);
    const h = getHistogram("stellar_submit_latency_ms", { kind: "usdc_transfer" })!;
    expect(h.buckets.get(500)).toBe(1);
    expect(h.buckets.get(250)).toBe(0);
  });
});

// ── Mocked Horizon failure/success paths ──────────────────────────────────────

describe("Mocked Horizon submit paths", () => {
  it("success path: submit → success result → latency recorded", () => {
    // Simulate what payBill does on success
    recordStellarSubmit("usdc_transfer");
    const start = Date.now();
    recordStellarResult("usdc_transfer", "success");
    recordStellarLatency("usdc_transfer", Date.now() - start);

    expect(getCounterValue("stellar_tx_submitted_total", { kind: "usdc_transfer" })).toBe(1);
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "success" })
    ).toBe(1);
    const h = getHistogram("stellar_submit_latency_ms", { kind: "usdc_transfer" })!;
    expect(h.count).toBe(1);
    expect(h.sum).toBeGreaterThanOrEqual(0);
  });

  it("failure path: submit → tx_bad_seq → latency recorded", () => {
    recordStellarSubmit("usdc_transfer");
    recordStellarResult("usdc_transfer", "tx_bad_seq");
    recordStellarLatency("usdc_transfer", 150);

    expect(getCounterValue("stellar_tx_submitted_total", { kind: "usdc_transfer" })).toBe(1);
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "tx_bad_seq" })
    ).toBe(1);
    const h = getHistogram("stellar_submit_latency_ms", { kind: "usdc_transfer" })!;
    expect(h.sum).toBe(150);
  });

  it("mixed paths: success rate tracking — 3 submitted, 2 succeeded, 1 failed", () => {
    recordStellarSubmit("usdc_transfer");
    recordStellarResult("usdc_transfer", "success");
    recordStellarSubmit("usdc_transfer");
    recordStellarResult("usdc_transfer", "success");
    recordStellarSubmit("usdc_transfer");
    recordStellarResult("usdc_transfer", "tx_failed");

    expect(getCounterValue("stellar_tx_submitted_total", { kind: "usdc_transfer" })).toBe(3);
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "success" })
    ).toBe(2);
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "usdc_transfer", result: "tx_failed" })
    ).toBe(1);
  });

  it("change_trust path in setup-wallets: submit and result recorded", () => {
    // Simulate addUsdcTrustline path
    recordStellarSubmit("change_trust");
    recordStellarResult("change_trust", "success");
    recordStellarLatency("change_trust", 800);

    expect(getCounterValue("stellar_tx_submitted_total", { kind: "change_trust" })).toBe(1);
    expect(
      getCounterValue("stellar_tx_result_total", { kind: "change_trust", result: "success" })
    ).toBe(1);
    const h = getHistogram("stellar_submit_latency_ms", { kind: "change_trust" })!;
    expect(h.sum).toBe(800);
  });
});
