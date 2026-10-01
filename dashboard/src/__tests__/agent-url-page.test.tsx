import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const useAgentStateMock = vi.fn();

function setEnv(name: "NODE_ENV" | "NEXT_PUBLIC_API_URL", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  Object.defineProperty(process.env, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

function installPageMocks() {
  vi.doMock("next/navigation", () => ({
    usePathname: () => "/",
    useSearchParams: () => ({ get: () => null }),
  }));
  vi.doMock("../hooks/use-agent-state", () => ({
    useAgentState: useAgentStateMock,
  }));
  vi.doMock("../lib/useProfile", () => ({
    useProfile: () => ({
      recipient: { name: "Rosa Garcia" },
      caregiver: { name: "Maria Garcia" },
      updateProfile: vi.fn(),
    }),
  }));
  vi.doMock("../lib/use-recipients", () => ({
    useRecipients: () => ({
      recipients: [],
      selectedId: null,
      selectRecipient: vi.fn(),
      error: null,
    }),
  }));
  vi.doMock("../components/dashboard-footer", () => ({
    DashboardFooter: () => <footer />,
  }));
  vi.doMock("../components/dashboard-header", () => ({
    DashboardHeader: () => <header>Dashboard header</header>,
  }));
  vi.doMock("../components/dashboard-tabs-nav", () => ({
    DashboardTabsNav: () => <nav />,
  }));
  vi.doMock("../components/low-balance-banner", () => ({
    LowBalanceBanner: () => <div />,
  }));
  vi.doMock("../components/primitives/live-region", () => ({
    LiveRegion: () => <div />,
  }));
  vi.doMock("../components/tabs/activity-tab", () => ({
    ActivityTab: () => <section />,
  }));
  vi.doMock("../components/tabs/bills-tab", () => ({
    BillsTab: () => <section />,
  }));
  vi.doMock("../components/tabs/medications-tab", () => ({
    MedicationsTab: () => <section />,
  }));
  vi.doMock("../components/tabs/overview-tab", () => ({
    OverviewTab: () => <main>Overview</main>,
  }));
  vi.doMock("../components/tabs/approvals-tab", () => ({
    ApprovalsTab: () => <section />,
  }));
  vi.doMock("../components/tabs/policy-tab", () => ({
    PolicyTab: () => <section />,
  }));
  vi.doMock("../components/tabs/settings-tab", () => ({
    SettingsTab: () => <section />,
  }));
  vi.doMock("../components/tabs/wallet-tab", () => ({
    WalletTab: () => <section />,
  }));
  vi.doMock("../components/types", () => ({
    DASHBOARD_TABS: [
      "overview",
      "medications",
      "bills",
      "approvals",
      "policy",
      "wallet",
      "activity",
      "settings",
    ],
  }));
}

async function importDashboard(nodeEnv: string, apiUrl?: string) {
  vi.resetModules();
  useAgentStateMock.mockReset();
  useAgentStateMock.mockReturnValue({
    liveMessage: "",
    agentPausedReason: null,
    walletBalance: null,
    walletXlm: null,
    togglePause: vi.fn(),
    agentInfo: null,
    agentConnected: false,
    agentPaused: false,
    spending: null,
    agentResult: null,
    loading: false,
    activeTask: "",
    runAgentTask: vi.fn(),
    cancelAgentTask: vi.fn(),
    policyForm: {},
    setPolicyForm: vi.fn(),
    setPolicyDirty: vi.fn(),
    policySaved: false,
    updatePolicy: vi.fn(),
    fetchSpending: vi.fn(),
    agentLog: [],
    setAgentLog: vi.fn(),
    allTransactions: [],
    auditEvents: [],
    pagination: null,
    currentPage: 0,
    setCurrentPage: vi.fn(),
    pageSize: 25,
    setPageSize: vi.fn(),
    resetAgent: vi.fn(),
  });
  setEnv("NODE_ENV", nodeEnv);
  setEnv("NEXT_PUBLIC_API_URL", apiUrl);
  installPageMocks();
  return import("../app/page");
}

describe("Dashboard API URL config gate", () => {
  afterEach(() => {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_API_URL", originalApiUrl);
    vi.restoreAllMocks();
  });

  it("renders a production configuration error when NEXT_PUBLIC_API_URL is missing", async () => {
    const { default: Dashboard } = await importDashboard("production");

    render(<Dashboard />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Configuration Error")).toBeTruthy();
    expect(screen.getByText("NEXT_PUBLIC_API_URL")).toBeTruthy();
    expect(useAgentStateMock).not.toHaveBeenCalled();
  });

  it("keeps the localhost fallback in development", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { default: Dashboard } = await importDashboard("development");

    render(<Dashboard />);

    expect(screen.getByText("Overview")).toBeTruthy();
    expect(useAgentStateMock).toHaveBeenCalledWith({ activeTab: "overview" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("NEXT_PUBLIC_API_URL is not set"),
    );
  });
});
