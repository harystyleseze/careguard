import { createHash } from "crypto";

export function isMockNetwork(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MOCK_NETWORK === "1";
}

export function assertMockNetworkAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (isMockNetwork(env) && env.NODE_ENV === "production") {
    throw new Error("MOCK_NETWORK=1 is forbidden when NODE_ENV=production");
  }
}

export function createMockReceipt(
  kind: string,
  payload: Record<string, unknown>,
) {
  const digest = createHash("sha256")
    .update(kind)
    .update(":")
    .update(JSON.stringify(payload))
    .digest("hex");

  return {
    mockNetwork: true,
    receiptId: `mock-${kind.replace(/[^a-z0-9]+/gi, "-")}-${digest.slice(0, 12)}`,
    stellarTxHash: digest,
  };
}
