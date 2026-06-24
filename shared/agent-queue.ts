import { Gauge } from "prom-client";

export const agentQueueDepth = new Gauge({
  name: "agent_queue_depth",
  help: "Total number of agents currently executing",
});

export const agentWaitingJobs = new Gauge({
  name: "agent_waiting_jobs",
  help: "Total number of agent requests waiting in the queue",
});

const AGENT_CONCURRENCY = parseInt(process.env.AGENT_CONCURRENCY || "1", 10);
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || "10", 10);

type QueueJob<T> = {
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
};

class AgentQueue {
  private activeCount = 0;
  private queue: QueueJob<any>[] = [];

  /**
   * Enqueue a job to run the agent.
   * If the queue is full, throws a 429 Error that should be caught and returned as a Retry-After response.
   */
  public async enqueue<T>(execute: () => Promise<T>): Promise<T> {
    if (this.activeCount < AGENT_CONCURRENCY) {
      return this.runJob(execute);
    }

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      const err = new Error("Agent queue is full. Please try again later.");
      (err as any).status = 429;
      (err as any).retryAfter = 10; // seconds
      throw err;
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ execute, resolve, reject });
      this.updateMetrics();
    });
  }

  private async runJob<T>(execute: () => Promise<T>): Promise<T> {
    this.activeCount++;
    this.updateMetrics();

    try {
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
        this.runJob(job.execute)
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
