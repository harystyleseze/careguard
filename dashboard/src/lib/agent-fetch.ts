import { AGENT_URL } from "./agent-url";

/**
 * Custom fetch wrapper for making authenticated requests to the CareGuard agent.
 * Automatically injects the Authorization header with the NEXT_PUBLIC_AGENT_API_KEY Bearer token
 * and resolves relative /agent paths to AGENT_URL.
 */
export async function agentFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const apiKey = process.env.NEXT_PUBLIC_AGENT_API_KEY;
  const headers = new Headers(init?.headers);
  if (apiKey && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  let target = input;
  if (typeof input === "string" && input.startsWith("/agent") && AGENT_URL) {
    target = `${AGENT_URL}${input}`;
  }

  return fetch(target, { ...init, headers });
}
