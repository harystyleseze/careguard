import { AGENT_URL } from "./agent-url";

const TOKEN_COOKIE = "caregiver_token=";

function readCaregiverToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const entry = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(TOKEN_COOKIE));
  return entry ? decodeURIComponent(entry.slice(TOKEN_COOKIE.length)) : undefined;
}

/**
 * Fetch wrapper for the care-recipients API (/recipients/...), which is guarded
 * by the caregiver token rather than the agent API key used by agentFetch.
 * Sends the token from the caregiver_token cookie as a Bearer header and marks
 * request bodies as JSON.
 */
export function caregiverFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = readCaregiverToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${AGENT_URL}${path}`, { ...init, headers });
}
