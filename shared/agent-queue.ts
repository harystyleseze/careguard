import { Gauge } from "prom-client";
import { performance } from "node:perf_hooks";
import { registry } from "./metrics.ts";

export const agentQueueDepth = new Gauge({
  name: "agent_queue_depth",
  help: "Total number of agents currently executing",
  registers: [registry],
});

export const agentWaitingJobs = new Gauge({
  name: "agent_waiting_jobs",
  help: "Total number of agent requests waiting in the queue",
  registers: [registry],
});

agentQueueDepth.set(0);
agentWaitingJobs.set(0);

function positiveIntegerEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw?.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const AGENT_CONCURRENCY = positiveIntegerEnv(process.env.AGENT_CONCURRENCY, 1);
const MAX_QUEUE_SIZE = positiveIntegerEnv(process.env.MAX_QUEUE_SIZE, 10);

type QueueJob<T> = {
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  enqueuedAt: number;
  onStart?: (queueWaitMs: number) => void;
};

class AgentQueue {
  private activeCount = 0;
  private queue: QueueJob<any>[] = [];

  /**
   * Enqueue a job to run the agent.
   * If the queue is full, throws a 429 Error that should be caught and returned as a Retry-After response.
   */
  public async enqueue<T>(
    execute: () => Promise<T>,
    onStart?: (queueWaitMs: number) => void,
  ): Promise<T> {
    const enqueuedAt = performance.now();
    if (this.activeCount < AGENT_CONCURRENCY) {
      return this.runJob(execute, onStart, enqueuedAt);
    }

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      const err = new Error("Agent queue is full. Please try again later.");
      (err as any).status = 429;
      (err as any).retryAfter = 10;
      throw err;
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ execute, resolve, reject, enqueuedAt, onStart });
      this.updateMetrics();
    });
  }

  private async runJob<T>(
    execute: () => Promise<T>,
    onStart?: (queueWaitMs: number) => void,
    enqueuedAt: number = performance.now(),
  ): Promise<T> {
    this.activeCount++;
    this.updateMetrics();

    try {
      onStart?.(Math.max(0, performance.now() - enqueuedAt));
      return await execute();
    } finally {
      this.activeCount--;
      this.updateMetrics();
      this.processNextJob();
    }
  }

  private processNextJob() {
    if (this.queue.length > 0 && this.activeCount < AGENT_CONCURRENCY) {
      const job = this.queue.shift();
      this.updateMetrics();

      if (job) {
        this.runJob(job.execute, job.onStart, job.enqueuedAt)
          .then(job.resolve)
          .catch(job.reject);
      }
    }
  }

  private updateMetrics() {
    agentQueueDepth.set(this.activeCount);
    agentWaitingJobs.set(this.queue.length);
  }
}

export const agentQueue = new AgentQueue();
