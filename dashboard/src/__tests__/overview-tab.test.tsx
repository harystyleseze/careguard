/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { OverviewTab } from "../components/tabs/overview-tab";

// Mock AdherencePrompt since it does fetching
vi.mock("../components/tabs/overview-tab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/tabs/overview-tab")>();
  return {
    ...actual,
    AdherencePrompt: () => <div data-testid="adherence-prompt" />,
  };
});

describe("OverviewTab Component", () => {
  const mockProps = {
    spending: {
      policy: {
        dailyLimit: 1000,
        monthlyLimit: 2000,
        medicationMonthlyBudget: 500,
        billMonthlyBudget: 500,
        approvalThreshold: 100,
        holdTimeSeconds: 86400,
      },
      spending: {
        medications: 150,
        bills: 200,
        serviceFees: 0.05,
        total: 350.05,
      },
      budgetRemaining: {
        medications: 350,
        bills: 300,
      },
      transactionCount: 5,
      recentTransactions: [],
    },
    agentResult: null,
    agentPaused: false,
    loading: false,
    activeTask: "",
    onRunTask: vi.fn(),
    onCancelTask: vi.fn(),
  };

  it("renders spending and budget cards", () => {
    render(<OverviewTab {...mockProps} />);
    expect(screen.getByText("$350.05")).toBeInTheDocument();
    expect(screen.getByText("of $2000 limit")).toBeInTheDocument();
    expect(screen.getByText("Agent API Costs")).toBeInTheDocument();
    expect(screen.getByText("$0.0500")).toBeInTheDocument();
    expect(screen.getByText("5 queries via x402")).toBeInTheDocument();
  });

  it("displays agent results when provided", () => {
    render(
      <OverviewTab
        {...mockProps}
        agentResult={{
          response: "I found $10.00 in savings.",
          spending: { spending: { serviceFees: 0.05 } } as any,
          toolCalls: [
            { tool: "compare_pharmacy_prices", input: { drug_name: "lisinopril" }, result: { potentialSavings: 10.0 } },
          ],
          llmUsage: { promptTokens: 100, completionTokens: 50 },
        }}
      />
    );
    expect(screen.getByText("$10.00/mo")).toBeInTheDocument();
    expect(screen.getByText("150 tokens")).toBeInTheDocument();
    expect(screen.getByText("I found $10.00 in savings.")).toBeInTheDocument();
  });

  it("shows the iteration-limit banner when the run was capped (Issue #165)", () => {
    render(
      <OverviewTab
        {...mockProps}
        agentResult={{
          response: "Partial result.",
          spending: { spending: { serviceFees: 0.05 } } as any,
          toolCalls: [],
          events: [{ kind: "iteration_limit_reached" }],
        }}
      />
    );
    expect(
      screen.getByText(/Task may be incomplete — agent ran out of steps/i)
    ).toBeInTheDocument();
  });

  it("does not show the iteration-limit banner on a normal run (Issue #165)", () => {
    render(
      <OverviewTab
        {...mockProps}
        agentResult={{
          response: "Done.",
          spending: { spending: { serviceFees: 0.05 } } as any,
          toolCalls: [],
          events: [],
        }}
      />
    );
    expect(
      screen.queryByText(/agent ran out of steps/i)
    ).not.toBeInTheDocument();
  });

  it("calls onRunTask when task buttons are clicked", () => {
    render(<OverviewTab {...mockProps} />);

    const medsBtn = screen.getByRole("button", { name: /Compare Medication Prices/i });
    fireEvent.click(medsBtn);
    expect(mockProps.onRunTask).toHaveBeenCalledWith(
      expect.stringContaining("Compare prices for all of Rosa's medications"),
      "meds"
    );

    const billBtn = screen.getByRole("button", { name: /Audit Hospital Bill/i });
    fireEvent.click(billBtn);
    expect(mockProps.onRunTask).toHaveBeenCalledWith(
      expect.stringContaining("Audit Rosa's hospital bill"),
      "bill"
    );
  });

  it("renders Spanish translations when locale is set to 'es' (Issue #1126)", () => {
    render(<OverviewTab {...mockProps} locale="es" />);
    expect(screen.getByText("Gasto Mensual")).toBeInTheDocument();
    expect(screen.getByText("Ahorros Encontrados")).toBeInTheDocument();
    expect(screen.getByText("Errores de Facturación")).toBeInTheDocument();
    expect(screen.getByText("Costos de API del Agente")).toBeInTheDocument();
    expect(screen.getByText("Estado del Presupuesto")).toBeInTheDocument();
    expect(screen.getByText("Acciones del Agente")).toBeInTheDocument();
    expect(screen.getByText("Comparar Precios de Medicamentos")).toBeInTheDocument();
    expect(screen.getByText("Auditar Factura Hospitalaria")).toBeInTheDocument();
    expect(screen.getByText("Intentar Pago Excedente")).toBeInTheDocument();
  });

  it("shows the generic working text while loading without step data (#1253)", () => {
    render(<OverviewTab {...mockProps} loading activeTask="meds" />);
    expect(screen.getByText("Agent working...")).toBeInTheDocument();
  });

  it("shows the in-flight tool name while loading when step data exists (#1253)", () => {
    render(
      <OverviewTab
        {...mockProps}
        loading
        activeTask="meds"
        activeTool="compare_pharmacy_prices"
      />,
    );
    expect(screen.getByText(/running compare_pharmacy_prices/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Agent working\.\.\.$/i)).not.toBeInTheDocument();
  });

  it("keeps the Cancel button while a task runs with step data (#1253)", () => {
    const onCancel = vi.fn();
    render(
      <OverviewTab
        {...mockProps}
        loading
        activeTask="meds"
        activeTool="audit_medical_bill"
        onCancelTask={onCancel}
      />,
    );
    const cancel = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("OverviewTab — Medication Adherence Check (Issue #1254)", () => {
  const adherenceProps = {
    ...mockProps,
    agentResult: {
      response: "Ordered lisinopril.",
      spending: { spending: { serviceFees: 0.05 } } as any,
      toolCalls: [
        { tool: "pay_for_medication", input: {}, result: { success: true } },
      ],
    },
  };

  function mockPending(exported: Array<{ id: string }>) {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/agent/adherence/pending")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ pending: exported, count: exported.length }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }) as unknown as typeof fetch,
    );
  }

  it("renders the check card after a successful medication payment", () => {
    mockPending([]);
    render(<OverviewTab {...adherenceProps} recipient={{ name: "Rosa" } as any} />);

    expect(screen.getByText("Medication Adherence Check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /yes — taken/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /not yet/i })).toBeInTheDocument();
  });

  it("records 'taken' and disables both buttons with an inline confirmation", async () => {
    mockPending([{ id: "adh-1" }]);
    const user = userEvent.setup();
    render(<OverviewTab {...adherenceProps} recipient={{ name: "Rosa" } as any} />);

    await user.click(screen.getByRole("button", { name: /yes — taken/i }));

    await screen.findByRole("status");
    expect(screen.getByText(/recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /yes — taken/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /not yet/i })).not.toBeInTheDocument();
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/agent/adherence/confirm")),
    ).toBe(true);
  });

  it("records 'not yet' against the adherence skip endpoint", async () => {
    mockPending([{ id: "adh-2" }]);
    const user = userEvent.setup();
    render(<OverviewTab {...adherenceProps} recipient={{ name: "Rosa" } as any} />);

    await user.click(screen.getByRole("button", { name: /not yet/i }));

    await screen.findByRole("status");
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/agent/adherence/skip")),
    ).toBe(true);
  });

  it("still acknowledges the choice when no pending record exists", async () => {
    mockPending([]);
    const user = userEvent.setup();
    render(<OverviewTab {...adherenceProps} recipient={{ name: "Rosa" } as any} />);

    await user.click(screen.getByRole("button", { name: /yes — taken/i }));

    await screen.findByRole("status");
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/agent/adherence/confirm")),
    ).toBe(false);
  });

  it("keeps the buttons enabled when recording fails so the caregiver can retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch,
    );
    const user = userEvent.setup();
    render(<OverviewTab {...adherenceProps} recipient={{ name: "Rosa" } as any} />);

    await user.click(screen.getByRole("button", { name: /yes — taken/i }));

    // The catch path leaves the card unchanged (retryable).
    await screen.findByRole("button", { name: /yes — taken/i });
    expect(screen.getByRole("button", { name: /not yet/i })).toBeInTheDocument();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
