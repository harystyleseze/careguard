/**
 * Lightweight in-memory metric registry — Prometheus-compatible text output.
 *
 * Provides counters and histograms for:
 *   - Stellar transaction outcomes  (issue #104)
 *   - Per-tool latency + USDC cost  (issue #102)
 */

type Labels = Record<string, string>;

function keyOf(name: string, labels: Labels): string {
  const pairs = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
  return pairs.length ? `${name}{${pairs.join(",")}}` : name;
}

// ── Counters ──────────────────────────────────────────────────────────────────
const _counters = new Map<string, number>();

export function incCounter(name: string, labels: Labels = {}): void {
  const key = keyOf(name, labels);
  _counters.set(key, (_counters.get(key) ?? 0) + 1);
}

export function getCounterValue(name: string, labels: Labels = {}): number {
  return _counters.get(keyOf(name, labels)) ?? 0;
}

// ── Histograms ────────────────────────────────────────────────────────────────
export const HISTOGRAM_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export interface Histogram {
  sum: number;
  count: number;
  buckets: Map<number, number>;
}

const _histograms = new Map<string, Histogram>();

export function observeHistogram(name: string, value: number, labels: Labels = {}): void {
  const key = keyOf(name, labels);
  let h = _histograms.get(key);
  if (!h) {
    h = { sum: 0, count: 0, buckets: new Map(HISTOGRAM_BUCKETS.map((b) => [b, 0])) };
    _histograms.set(key, h);
  }
  h.sum += value;
  h.count++;
  for (const b of HISTOGRAM_BUCKETS) {
    if (value <= b) h.buckets.set(b, (h.buckets.get(b) ?? 0) + 1);
  }
}

export function getHistogram(name: string, labels: Labels = {}): Histogram | undefined {
  return _histograms.get(keyOf(name, labels));
}

// ── Per-tool call tracking ────────────────────────────────────────────────────
interface ToolEntry {
  ts: number;
  latencyMs: number;
  costUsdc: number;
}

const _toolEntries = new Map<string, ToolEntry[]>();

export function recordToolCall(tool: string, latencyMs: number, costUsdc = 0): void {
  const entry: ToolEntry = { ts: Date.now(), latencyMs, costUsdc };
  const bucket = _toolEntries.get(tool) ?? [];
  bucket.push(entry);
  _toolEntries.set(tool, bucket);
  observeHistogram("agent_tool_latency_ms", latencyMs, { tool });
  if (costUsdc > 0) incCounter("agent_tool_cost_usdc_calls", { tool });
}

export interface ToolSummaryEntry {
  calls: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalCostUsdc: number;
}

export function getToolSummary(sinceMs = 0): Record<string, ToolSummaryEntry> {
  const out: Record<string, ToolSummaryEntry> = {};
  for (const [tool, entries] of _toolEntries) {
    const filtered = sinceMs > 0 ? entries.filter((e) => e.ts >= sinceMs) : entries;
    if (!filtered.length) continue;
    const totalLatencyMs = filtered.reduce((s, e) => s + e.latencyMs, 0);
    const totalCostUsdc = filtered.reduce((s, e) => s + e.costUsdc, 0);
    out[tool] = {
      calls: filtered.length,
      totalLatencyMs,
      avgLatencyMs: +(totalLatencyMs / filtered.length).toFixed(1),
      totalCostUsdc: +totalCostUsdc.toFixed(6),
    };
  }
  return out;
}

// ── Stellar-specific helpers ──────────────────────────────────────────────────
export function recordStellarSubmit(kind: string): void {
  incCounter("stellar_tx_submitted_total", { kind });
}

export function recordStellarResult(kind: string, result: string): void {
  incCounter("stellar_tx_result_total", { kind, result });
}

export function recordStellarLatency(kind: string, ms: number): void {
  observeHistogram("stellar_submit_latency_ms", ms, { kind });
}

// ── Prometheus text output ────────────────────────────────────────────────────
export function renderMetrics(): string {
  const lines: string[] = [];

  // Counters — grouped by metric family name
  const cfamilies = new Map<string, Array<[string, number]>>();
  for (const [key, val] of _counters) {
    const name = key.includes("{") ? key.slice(0, key.indexOf("{")) : key;
    const list = cfamilies.get(name) ?? [];
    list.push([key, val]);
    cfamilies.set(name, list);
  }
  for (const [family, entries] of cfamilies) {
    lines.push(`# TYPE ${family} counter`);
    for (const [key, val] of entries) lines.push(`${key} ${val}`);
  }

  // Histograms — grouped by metric family name
  const hfamilies = new Map<string, Array<[string, Histogram]>>();
  for (const [key, h] of _histograms) {
    const name = key.includes("{") ? key.slice(0, key.indexOf("{")) : key;
    const list = hfamilies.get(name) ?? [];
    list.push([key, h]);
    hfamilies.set(name, list);
  }
  for (const [family, entries] of hfamilies) {
    lines.push(`# TYPE ${family} histogram`);
    for (const [key, h] of entries) {
      const lStr = key.includes("{") ? key.slice(key.indexOf("{")) : "";
      const lBase = lStr ? lStr.slice(1, -1) : "";
      for (const [le, c] of h.buckets) {
        const label = lBase ? `{${lBase},le="${le}"}` : `{le="${le}"}`;
        lines.push(`${family}_bucket${label} ${c}`);
      }
      const infLabel = lBase ? `{${lBase},le="+Inf"}` : `{le="+Inf"}`;
      lines.push(`${family}_bucket${infLabel} ${h.count}`);
      lines.push(`${family}_sum${lStr} ${h.sum}`);
      lines.push(`${family}_count${lStr} ${h.count}`);
    }
  }

  // Per-tool USDC cost gauge
  if (_toolEntries.size > 0) {
    lines.push("# TYPE agent_tool_cost_usdc_total gauge");
    for (const [tool, entries] of _toolEntries) {
      const total = entries.reduce((s, e) => s + e.costUsdc, 0);
      if (total > 0) lines.push(`agent_tool_cost_usdc_total{tool="${tool}"} ${total.toFixed(6)}`);
    }
  }

  return lines.join("\n") + (lines.length ? "\n" : "");
}

// ── Test helpers ──────────────────────────────────────────────────────────────
export function _resetForTesting(): void {
  _counters.clear();
  _histograms.clear();
  _toolEntries.clear();
}
