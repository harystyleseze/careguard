import { z } from "zod";

const X402ReceiptSchema = z.object({
  transaction: z.string(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  settler: z.string().optional(),
  fee: z.number().optional(),
  timestamp: z.string().optional(),
});

const MPPReceiptSchema = z.object({
  reference: z.string(),
  hash: z.string().optional(),
  orderId: z.string().optional(),
  status: z.string().optional(),
  amount: z.number().optional(),
  pharmacy: z.string().optional(),
});

export type TxSource = "x402" | "mpp" | "direct" | null;

export interface DecodedReceipt {
  hash: string;
  source: TxSource;
}

export function decodeTxReceipt(raw: string): DecodedReceipt {
  if (!raw || raw.length <= 64) {
    return { hash: raw, source: "direct" };
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return { hash: raw, source: "direct" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(atob(raw));
  } catch {
    return { hash: raw, source: null };
  }

  if (typeof decoded !== "object" || decoded === null) {
    return { hash: raw, source: null };
  }

  const d = decoded as Record<string, unknown>;

  if (d.transaction && typeof d.transaction === "string" && /^[0-9a-f]{64}$/i.test(d.transaction)) {
    const result = X402ReceiptSchema.safeParse(decoded);
    if (result.success) {
      return { hash: d.transaction, source: "x402" };
    }
  }

  if (d.reference && typeof d.reference === "string") {
    const result = MPPReceiptSchema.safeParse(decoded);
    if (result.success) {
      const txId = d.hash || d.reference;
      if (typeof txId === "string" && /^[0-9a-f]{64}$/i.test(txId)) {
        return { hash: txId, source: "mpp" };
      }
      return { hash: d.reference, source: "mpp" };
    }
  }

  if (d.hash && typeof d.hash === "string" && /^[0-9a-f]{64}$/i.test(d.hash)) {
    return { hash: d.hash, source: "direct" };
  }

  return { hash: raw, source: null };
}

export function isValidStellarHash(hash: string): boolean {
  return Boolean(hash && /^[0-9a-f]{64}$/i.test(hash));
}