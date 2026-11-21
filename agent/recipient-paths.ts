import { fileURLToPath } from "url";

/** Resolve the configurable root used for per-recipient persisted data. */
export function getDataDir(): string {
  return process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
}

export function getRecipientDir(recipientId: string): string {
  return `${getDataDir()}/recipients/${recipientId}`;
}

export function getRecipientFile(recipientId: string, name: string): string {
  return `${getRecipientDir(recipientId)}/${name}`;
}
