import { describe, expect, it } from "vitest";
import { agentQueue, agentQueueDepth, agentWaitingJobs } from "../agent-queue.ts";
import { registry } from "../metrics.ts";

async function metricValue(metric: { get(): Promise<{ values: Array<{ value: number }> }> }): Promise<number> {
  const result = await metric.get();
  return result.values[0]?.value ?? 0;
}

describe("agentQueue", () => {
  it("drains queued jobs and reports wait timing and depth", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waitTimes: number[] = [];
    const first = agentQueue.enqueue(async () => {
      await gate;
      return "first";
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = agentQueue.enqueue(
      async () => "second",
      (waitMs) => waitTimes.push(waitMs),
    );

    expect(await metricValue(agentQueueDepth)).toBe(1);
    expect(await metricValue(agentWaitingJobs)).toBe(1);
    release();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(waitTimes).toHaveLength(1);
    expect(waitTimes[0]).toBeGreaterThanOrEqual(0);
    expect(await metricValue(agentQueueDepth)).toBe(0);
    expect(await metricValue(agentWaitingJobs)).toBe(0);
    expect(await registry.metrics()).toContain("agent_queue_depth");
    expect(await registry.metrics()).toContain("agent_waiting_jobs");
  });
});
