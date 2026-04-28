const EXPLORER_URL = "https://stellar.expert/explorer/testnet/tx";

export interface TxLinkProps {
  hash?: string;
}

export function TxLink({ hash }: TxLinkProps) {
  if (!hash) return <span className="text-xs text-slate-300">-</span>;

  let displayHash = hash;
  let explorerHash = hash;
  let decodeFailed = false;

  if (hash.length > 64 && !hash.match(/^[0-9a-f]{64}$/i)) {
    try {
      const decoded = JSON.parse(atob(hash));
      const txId = decoded.transaction || decoded.reference || decoded.hash;
      if (txId) {
        explorerHash = txId;
        displayHash = txId;
      }
    } catch {
      decodeFailed = true;
    }
  }

  const isValidHash = /^[0-9a-f]{64}$/i.test(explorerHash);

  if (isValidHash) {
    return (
      <a
        href={`${EXPLORER_URL}/${explorerHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-sky-600 hover:text-sky-800 underline font-mono"
        title={`View on Stellar Explorer: ${explorerHash}`}
      >
        {explorerHash.slice(0, 8)}...
      </a>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <span className="text-xs text-slate-400 font-mono" title={hash}>
        {displayHash.slice(0, 12)}...
      </span>
      <span
        className="text-[10px] leading-none text-slate-500 border border-slate-300 rounded-full w-4 h-4 inline-flex items-center justify-center"
        title={
          decodeFailed
            ? "Couldn't extract a Stellar tx hash. The receipt may be in a different format."
            : "Not a Stellar transaction hash."
        }
        aria-label="Transaction link info"
      >
        ?
      </span>
    </span>
  );
}
