import { EXPLORER_TX_URL } from "../../lib/stellar-network";

// Backend guarantees stellarTxHash is always a real 64-char hex hash or
// undefined (#14) — no more base64/receipt decoding needed here.
const STELLAR_TX_HASH_RE = /^[0-9a-f]{64}$/i;

export interface TxLinkProps {
  hash?: string;
}

export function TxLink({ hash }: TxLinkProps) {
  if (!hash || !STELLAR_TX_HASH_RE.test(hash)) {
    return <span className="text-xs text-slate-300">-</span>;
  }

  return (
    <a
      href={`${EXPLORER_TX_URL}/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-sky-600 hover:text-sky-800 underline font-mono"
      title={`View on Stellar Explorer: ${hash}`}
    >
      {hash.slice(0, 8)}...
    </a>
  );
}
