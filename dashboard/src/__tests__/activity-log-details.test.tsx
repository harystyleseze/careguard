import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityTab } from "../components/tabs/activity-tab";

const { copyTextMock } = vi.hoisted(() => ({
  copyTextMock: vi.fn().mockResolvedValue("ok" as const),
}));

vi.mock("../lib/clipboard", () => ({
  copyText: copyTextMock,
}));

vi.mock("../app/pdf", () => ({
  downloadTransactionPDF: vi.fn(),
}));

function renderActivityLog(details: string) {
  return render(
    <ActivityTab
      recipient={{ name: "Rosa Garcia" }}
      agentLog={[
        {
          id: "log-1",
          timestamp: Date.now(),
          message: "  -> pay_bill ERROR: Stellar USDC transfer failed: tx_bad_seq...",
          details,
        },
      ]}
      setAgentLog={vi.fn()}
      allTransactions={[]}
      auditEvents={[]}
      pagination={null}
      currentPage={0}
      setCurrentPage={vi.fn()}
      pageSize={25}
      setPageSize={vi.fn()}
      spending={null}
      onResetAgent={vi.fn()}
    />,
  );
}

describe("ActivityTab tool error details", () => {
  it("expands, collapses, and copies full tool-call errors", async () => {
    const fullError =
      'Stellar USDC transfer failed: {"transaction":"tx_bad_seq","operations":["op_bad_auth"]}';

    renderActivityLog(fullError);

    expect(screen.getAllByText(/tx_bad_seq\.\.\./).length).toBeGreaterThan(0);
    expect(screen.queryByText(fullError)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Show details"));

    expect(screen.getByText("Hide details")).toBeInTheDocument();
    expect(screen.getByText(fullError)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledWith(fullError));

    fireEvent.click(screen.getByText("Hide details"));
    expect(screen.queryByText(fullError)).not.toBeInTheDocument();
  });
});
