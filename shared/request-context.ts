/**
 * Per-request async context via AsyncLocalStorage.
 * Threads a UUID request ID through the entire call tree (including tool calls inside runAgent).
 * Echoed to callers as X-Request-ID response header.
 *
 * This module intentionally has no imports from other shared/ modules
 * to avoid circular dependencies.
 */

import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import type { RequestHandler } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

interface RequestContext {
  requestId: string;
  agentRunId?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(id: string, fn: () => T): T {
  return als.run({ requestId: id }, fn);
}

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

export function setAgentRunId(agentRunId: string): void {
  const store = als.getStore();
  if (store) store.agentRunId = agentRunId;
}

export function getAgentRunId(): string | undefined {
  return als.getStore()?.agentRunId;
}

export function requestContextMiddleware(): RequestHandler {
  return (req, res, next) => {
    const id = (req.headers["x-request-id"] as string | undefined) || randomUUID();
    req.requestId = id;
    res.setHeader("X-Request-ID", id);
    als.run({ requestId: id }, () => next());
  };
}
