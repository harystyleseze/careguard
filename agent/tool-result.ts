import { randomUUID } from "crypto";

const DEFAULT_RESULT_SIZE_LIMIT = 8 * 1024;
const DEFAULT_SAMPLE_SIZE = 10;

type StoredToolResult = {
  toolName: string;
  result: unknown;
  createdAt: string;
};

const toolResultStore = new Map<string, StoredToolResult>();

export const TOOL_RESULT_MAX_BYTES: Record<string, number> = {
  default: DEFAULT_RESULT_SIZE_LIMIT,
  audit_medical_bill: DEFAULT_RESULT_SIZE_LIMIT,
  fetch_and_audit_bill: DEFAULT_RESULT_SIZE_LIMIT,
};

function getToolResultLimit(toolName: string): number {
  return TOOL_RESULT_MAX_BYTES[toolName] ?? TOOL_RESULT_MAX_BYTES.default;
}

function summarizeLineItemsResult(toolName: string, result: Record<string, unknown>, resultId: string) {
  const lineItems = Array.isArray(result.lineItems) ? result.lineItems : [];
  const firstItems = lineItems.slice(0, DEFAULT_SAMPLE_SIZE);
  const elidedCount = Math.max(0, lineItems.length - firstItems.length);
  const { lineItems: _lineItems, ...rest } = result;

  return {
    ok: true,
    truncated: true,
    tool: toolName,
    resultId,
    summary: `${elidedCount} line items elided; first 10 included`,
    totalLineItems: lineItems.length,
    hasMore: elidedCount > 0,
    ...rest,
    lineItems: firstItems,
  };
}

function summarizeArrayResult(toolName: string, result: unknown[], resultId: string) {
  const firstItems = result.slice(0, DEFAULT_SAMPLE_SIZE);
  const elidedCount = Math.max(0, result.length - firstItems.length);

  return {
    ok: true,
    truncated: true,
    tool: toolName,
    resultId,
    summary: `${elidedCount} items elided; first 10 included`,
    totalItems: result.length,
    hasMore: elidedCount > 0,
    items: firstItems,
  };
}

function summarizeGenericResult(toolName: string, resultId: string, result: unknown) {
  return {
    ok: true,
    truncated: true,
    tool: toolName,
    resultId,
    summary: `Result exceeded ${DEFAULT_RESULT_SIZE_LIMIT} bytes; use fetch_tool_result to fetch the rest`,
    preview: typeof result === "object" && result !== null ? Object.keys(result as Record<string, unknown>).slice(0, 10) : [],
  };
}

export function serializeToolResultForPrompt(toolName: string, result: unknown): string {
  const serialized = JSON.stringify(result) ?? "null";
  const limit = getToolResultLimit(toolName);
  if (Buffer.byteLength(serialized, "utf8") <= limit) {
    return serialized;
  }

  const resultId = `tool-result-${randomUUID()}`;
  toolResultStore.set(resultId, {
    toolName,
    result,
    createdAt: new Date().toISOString(),
  });

  if (Array.isArray(result)) {
    return JSON.stringify(summarizeArrayResult(toolName, result, resultId));
  }

  if (result && typeof result === "object") {
    const objectResult = result as Record<string, unknown>;
    if (Array.isArray(objectResult.lineItems)) {
      return JSON.stringify(summarizeLineItemsResult(toolName, objectResult, resultId));
    }
  }

  return JSON.stringify(summarizeGenericResult(toolName, resultId, result));
}

export function fetchToolResult(
  resultId: string,
  offset = 0,
  limit = DEFAULT_SAMPLE_SIZE,
): Record<string, unknown> {
  const stored = toolResultStore.get(resultId);
  if (!stored) {
    return {
      ok: false,
      reason: "RESULT_NOT_FOUND",
      resultId,
    };
  }

  const result = stored.result;

  if (Array.isArray(result)) {
    const items = result.slice(offset, offset + limit);
    return {
      ok: true,
      resultId,
      tool: stored.toolName,
      offset,
      limit,
      totalItems: result.length,
      hasMore: offset + limit < result.length,
      items,
    };
  }

  if (result && typeof result === "object") {
    const objectResult = result as Record<string, unknown>;
    if (Array.isArray(objectResult.lineItems)) {
      const lineItems = objectResult.lineItems.slice(offset, offset + limit);
      return {
        ok: true,
        resultId,
        tool: stored.toolName,
        offset,
        limit,
        totalLineItems: objectResult.lineItems.length,
        hasMore: offset + limit < objectResult.lineItems.length,
        ...objectResult,
        lineItems,
      };
    }
  }

  if (result && typeof result === "object") {
    return {
      ok: true,
      resultId,
      tool: stored.toolName,
      ...(result as Record<string, unknown>),
    };
  }

  return {
    ok: true,
    resultId,
    tool: stored.toolName,
    value: result,
  };
}

export function clearToolResultStoreForTests() {
  toolResultStore.clear();
}
