import { EXPLORER_TX_URL } from "../../lib/stellar-network";

const STELLAR_TX_HASH_RE = /^[0-9a-f]{64}$/i;

export interface TxLinkProps {
  hash?: string;
}

function decodeReceipt(value: string): unknown {
  try {
    return JSON.parse(globalThis.atob(value));
  } catch {
    return null;
  }
}

function resolveTxHash(value: string): string | null {
  if (STELLAR_TX_HASH_RE.test(value)) {
    return value;
  }

  const receipt = decodeReceipt(value);
  if (!receipt || typeof receipt !== "object") {
    return null;
  }

  const candidate =
    "transaction" in receipt
      ? receipt.transaction
      : "reference" in receipt
        ? receipt.reference
        : null;

  return typeof candidate === "string" && STELLAR_TX_HASH_RE.test(candidate)
    ? candidate
    : null;
}

export function TxLink({ hash }: TxLinkProps) {
  if (!hash) {
    return <span className="text-xs text-slate-300">-</span>;
  }

  const txHash = resolveTxHash(hash);
  if (!txHash) {
    return <span className="text-xs text-slate-500 font-mono break-all">{hash}</span>;
  }

  return (
    <a
      href={`${EXPLORER_TX_URL}/${txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-sky-600 hover:text-sky-800 underline font-mono"
      title={`View on Stellar Explorer: ${txHash}`}
    >
      {txHash.slice(0, 8)}...
    </a>
  );
}
