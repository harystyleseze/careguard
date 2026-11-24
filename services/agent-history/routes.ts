import { Router } from "express";
import type { AgentHistoryStore } from "./db.ts";

function recipientIdOf(query: Record<string, unknown>): string {
  return typeof query.recipient_id === "string" && query.recipient_id
    ? query.recipient_id
    : "rosa";
}

function stringParam(value: unknown, max = 100): string | undefined {
  return typeof value === "string" && value ? value.slice(0, max) : undefined;
}

/**
 * Agent tool invocation history, mounted under /agent so it shares the agent
 * API key guard with the runs that produce it.
 *
 * GET /agent/history?recipient_id=rosa&tool=pay_bill&from=2026-10-01&to=2026-10-19&limit=25&offset=0
 * GET /agent/history/tools?recipient_id=rosa
 */
export function createAgentHistoryRouter(store: AgentHistoryStore): Router {
  const router = Router();

  router.get("/history", (req, res) => {
    const recipientId = recipientIdOf(req.query);
    const page = store.list(recipientId, {
      tool: stringParam(req.query.tool),
      from: stringParam(req.query.from, 40),
      to: stringParam(req.query.to, 40),
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      offset: req.query.offset === undefined ? undefined : Number(req.query.offset),
    });
    res.json({ recipientId, ...page });
  });

  router.get("/history/tools", (req, res) => {
    const recipientId = recipientIdOf(req.query);
    res.json({ recipientId, tools: store.tools(recipientId) });
  });

  return router;
}
