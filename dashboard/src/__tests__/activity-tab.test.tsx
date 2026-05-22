import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TransactionRows } from "../components/tabs/activity-tab";
import type { Transaction } from "../lib/types";

const transactions: Transaction[] = [
  {
    id: "tx-1",
    timestamp: "2026-04-27T11:00:00.000Z",
    type: "medication",
    description: "Lisinopril order",
    amount: 12.5,
    recipient: "Pharmacy",
    stellarTxHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "completed",
    category: "medication",
  },
];

function Harness({ onRowsRender }: { onRowsRender: () => void }) {
  const [count, setCount] = useState(0);

  return (
    <>
      <button onClick={() => setCount((value) => value + 1)}>
        Parent render {count}
      </button>
      <table>
        <tbody>
          <TransactionRows
            transactions={transactions}
            onRender={onRowsRender}
          />
        </tbody>
      </table>
    </>
  );
}

describe("TransactionRows", () => {
  it("does not re-render rows when unrelated parent state changes", () => {
    const onRowsRender = vi.fn();

    render(<Harness onRowsRender={onRowsRender} />);
    expect(onRowsRender).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /parent render/i }));

    expect(onRowsRender).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Lisinopril order")).toBeInTheDocument();
  });
});
