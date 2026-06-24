/**
 * Per-request async context via AsyncLocalStorage.
 * Threads a ULID request ID through the entire call tree (including tool calls inside runAgent).
 * Echoed to callers as X-Request-Id response header.
 *
 * This module intentionally has no imports from other shared/ modules
 * to avoid circular dependencies.
 */

import { AsyncLocalStorage } from "async_hooks";
import type { RequestHandler } from "express";

interface RequestContext {
  requestId: string;
  agentRunId?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

function generateULID(): string {
  const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let id = "";
  let time = Date.now();
  for (let i = 9; i >= 0; i--) {
    id = crockford[time % 32] + id;
    time = Math.floor(time / 32);
  }
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  for (const b of rand) id += crockford[b % 32];
  return id;
}

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
    const id = (req.headers["x-request-id"] as string | undefined) || generateULID();
    res.setHeader("x-request-id", id);
    als.run({ requestId: id }, () => next());
  };
}
