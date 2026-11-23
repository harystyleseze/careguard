import type { ErrorRequestHandler } from "express";

function isMalformedJsonBodyError(err: unknown): err is SyntaxError & {
  status: number;
  type: string;
  body?: unknown;
} {
  if (!(err instanceof SyntaxError)) return false;
  const candidate = err as { status?: unknown; type?: unknown; body?: unknown };
  return (
    candidate.status === 400 &&
    candidate.type === "entity.parse.failed" &&
    "body" in candidate
  );
}

export function createJsonBodyErrorHandler(options?: {
  code?: string;
  includeDetails?: boolean;
}): ErrorRequestHandler {
  const code = options?.code ?? "INVALID_JSON";
  const includeDetails = options?.includeDetails ?? false;

  return (err, _req, res, next) => {
    if (err?.type === "entity.too.large") {
      const payload: Record<string, unknown> = {
        error: "Request body too large",
      };
      if (includeDetails) {
        payload.code = "BODY_TOO_LARGE";
        payload.details = { limit: err.limit };
      } else {
        payload.limit = err.limit;
      }
      return res.status(413).json(payload);
    }

    if (isMalformedJsonBodyError(err)) {
      const payload: Record<string, unknown> = {
        error: "Invalid JSON body",
      };
      if (includeDetails) {
        payload.code = code;
        payload.details = { message: "Malformed JSON in request body" };
      } else {
        payload.code = code;
      }
      return res.status(400).json(payload);
    }

    next(err);
  };
}
