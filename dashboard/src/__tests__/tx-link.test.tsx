import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TxLink } from "../components/primitives/tx-link";

const LOWER_HASH =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const UPPER_HASH = LOWER_HASH.toUpperCase();
const SHORT_HASH = "0123456789abcdef0123456789abcdef";

function encodeReceipt(payload: Record<string, string>) {
  return globalThis.btoa(JSON.stringify(payload));
}

function expectTxLink(hash: string, label = `${hash.slice(0, 8)}...`) {
  const link = screen.getByRole("link", { name: label });
  expect(link.getAttribute("href")).toBe(
    `https://stellar.expert/explorer/testnet/tx/${hash}`,
  );
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(link.getAttribute("title")).toBe(`View on Stellar Explorer: ${hash}`);
}

function expectPlainText(text: string) {
  expect(screen.getByText(text).textContent).toBe(text);
  expect(screen.queryByRole("link")).toBeNull();
}

describe("TxLink", () => {
  it("renders a Stellar explorer link for 64-character lowercase hex hashes", () => {
    render(<TxLink hash={LOWER_HASH} />);

    expectTxLink(LOWER_HASH);
  });

  it("renders a Stellar explorer link for 64-character uppercase hex hashes", () => {
    render(<TxLink hash={UPPER_HASH} />);

    expectTxLink(UPPER_HASH);
  });

  it("decodes base64 receipts with a transaction hash", () => {
    render(<TxLink hash={encodeReceipt({ transaction: LOWER_HASH })} />);

    expectTxLink(LOWER_HASH);
  });

  it("decodes MPP receipts with a reference hash", () => {
    render(<TxLink hash={encodeReceipt({ reference: LOWER_HASH })} />);

    expectTxLink(LOWER_HASH);
  });

  it("renders order IDs as plain non-link text", () => {
    render(<TxLink hash="order-1775720261932" />);

    expectPlainText("order-1775720261932");
  });

  it("renders a dash for missing hashes", () => {
    render(<TxLink />);

    expectPlainText("-");
  });

  it("renders wrong-length hex strings as plain non-link text", () => {
    render(<TxLink hash={SHORT_HASH} />);

    expectPlainText(SHORT_HASH);
  });

  it("renders base64 receipts without a valid hash as plain non-link text", () => {
    const receipt = encodeReceipt({ reference: SHORT_HASH });

    render(<TxLink hash={receipt} />);

    expectPlainText(receipt);
  });

  it("renders base64 JSON without receipt hash fields as plain non-link text", () => {
    const receipt = encodeReceipt({ status: "paid" });

    render(<TxLink hash={receipt} />);

    expectPlainText(receipt);
  });
});
