/**
 * E2E: Full agent run from the dashboard (Issue #51)
 *
 * Flow:
 *   1. Open /
 *   2. Click "Compare Medication Prices"
 *   3. Assert Medications tab shows 4 drugs with price data
 *   4. Assert Activity tab shows 4+ service-fee transactions + 4 medication orders
 *
 * All agent API calls are intercepted and fulfilled with mock data so the test
 * runs headless in CI without real Stellar/LLM credentials.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock fixtures
// ---------------------------------------------------------------------------

const DRUGS = ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"] as const;

function makePriceResult(drug: string) {
  return {
    drug,
    zipCode: "90210",
    queryTimestamp: new Date().toISOString(),
    prices: [
      { pharmacyName: "Costco Pharmacy", pharmacyId: "costco-001", price: 3.5, distance: "2.1 mi", inStock: true },
      { pharmacyName: "CVS Pharmacy", pharmacyId: "cvs-001", price: 12.99, distance: "0.5 mi", inStock: true },
    ],
    cheapest: { pharmacyName: "Costco Pharmacy", pharmacyId: "costco-001", price: 3.5, distance: "2.1 mi" },
    mostExpensive: { pharmacyName: "CVS Pharmacy", pharmacyId: "cvs-001", price: 12.99 },
    potentialSavings: 9.49,
    savingsPercent: 73.1,
  };
}

function makeOrderTransaction(drug: string, index: number) {
  return {
    id: `tx-order-${index}`,
    timestamp: new Date().toISOString(),
    type: "medication",
    description: `${drug} from Costco Pharmacy [MPP Charge]`,
    amount: 3.5,
    recipient: "costco-001",
    stellarTxHash: "a".repeat(64),
    status: "completed",
    category: "medications",
  };
}

function makeServiceFeeTransaction(drug: string, index: number) {
  return {
    id: `tx-fee-${index}`,
    timestamp: new Date().toISOString(),
    type: "service_fee",
    description: `x402 query: pharmacy prices for ${drug}`,
    amount: 0.002,
    recipient: "pharmacy-price-api",
    status: "completed",
    category: "service_fees",
  };
}

const MOCK_AGENT_RUN = {
  response: "Compared prices and found cheaper options.",
  toolCalls: [
    // 4 price comparisons (one per drug)
    ...DRUGS.map((drug) => ({
      tool: "compare_pharmacy_prices",
      input: { drug_name: drug },
      result: makePriceResult(drug),
    })),
    // drug interaction check
    {
      tool: "check_drug_interactions",
      input: { medications: [...DRUGS] },
      result: {
        checkTimestamp: new Date().toISOString(),
        medications: [...DRUGS],
        interactionCount: 1,
        severeCount: 0,
        moderateCount: 1,
        mildCount: 0,
        interactions: [
          {
            drug1: "Amlodipine",
            drug2: "Atorvastatin",
            severity: "mild",
            description: "Amlodipine slightly increases atorvastatin levels",
            recommendation: "Safe at standard doses",
          },
        ],
        overallRisk: "low",
        summary: "Found 1 interaction(s): 0 severe, 0 moderate, 1 mild.",
      },
    },
    // 4 medication orders
    ...DRUGS.map((drug, i) => ({
      tool: "pay_for_medication",
      input: { pharmacy_id: "costco-001", pharmacy_name: "Costco Pharmacy", drug_name: drug, amount: 3.5 },
      result: { success: true, transaction: makeOrderTransaction(drug, i) },
    })),
  ],
  spending: {
    policy: { dailyLimit: 100, monthlyLimit: 500, medicationMonthlyBudget: 300, billMonthlyBudget: 500, approvalThreshold: 75 },
    spending: { medications: 14.0, bills: 0, serviceFees: 0.008, total: 14.008 },
    budgetRemaining: { medications: 286.0, bills: 500 },
    transactionCount: 9,
    recentTransactions: [],
  },
};

const MOCK_TRANSACTIONS = {
  transactions: [
    // 4 service-fee transactions
    ...DRUGS.map((drug, i) => makeServiceFeeTransaction(drug, i)),
    // 4 medication order transactions
    ...DRUGS.map((drug, i) => makeOrderTransaction(drug, i)),
    // 1 drug interaction fee
    {
      id: "tx-fee-interactions",
      timestamp: new Date().toISOString(),
      type: "service_fee",
      description: "x402 query: drug interactions",
      amount: 0.001,
      recipient: "drug-interaction-api",
      status: "completed",
      category: "service_fees",
    },
  ],
  pagination: { total: 9, limit: 25, offset: 0, hasMore: false, hasPrevious: false },
};

const MOCK_PROFILE = {
  recipient: {
    name: "Rosa Garcia",
    age: 78,
    medications: [...DRUGS],
    doctor: "Dr. Chen, General Hospital",
    insurance: "Medicare Part D",
  },
  caregiver: { name: "Maria Garcia", relationship: "Daughter", location: "Phoenix, AZ", notifications: "Email + SMS" },
};

const MOCK_SPENDING = MOCK_AGENT_RUN.spending;

// ---------------------------------------------------------------------------
// Route mock helper
// ---------------------------------------------------------------------------

async function mockAgentApis(page: Page) {
  await page.route("**/agent/profile", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_PROFILE) }),
  );
  await page.route("**/agent/spending", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SPENDING) }),
  );
  await page.route("**/agent/transactions**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_TRANSACTIONS) }),
  );
  await page.route("**/agent/run", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_AGENT_RUN) }),
  );
  await page.route("**/agent/policy", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
  );
  await page.route("**/agent/reset", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
  );
  await page.route("**/agent/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: false }) }),
  );
  // Mock Horizon balance check
  await page.route("**/horizon-testnet.stellar.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        balances: [
          { asset_code: "USDC", asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", balance: "100.00" },
          { asset_type: "native", balance: "42.0" },
        ],
      }),
    }),
  );
  // Mock root info endpoint
  const rootPayload = JSON.stringify({
    service: "agent",
    agentWallet: "GBQTESTWALLET123",
    llm: "mock-llm",
    network: "stellar:testnet",
    paused: false,
  });
  await page.route("**localhost:3004/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: rootPayload }),
  );
  await page.route("**127.0.0.1:3004/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: rootPayload }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Full agent run from dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await mockAgentApis(page);
    await page.goto("/");
  });

  test("dashboard loads and shows Rosa Garcia", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "CareGuard" })).toBeVisible();
    await expect(page.getByText("Rosa Garcia")).toBeVisible();
  });

  test("Compare Medication Prices completes within 30s and populates Medications tab with 4 drugs", async ({ page }) => {
    const start = Date.now();

    // Trigger the agent task
    await page.getByRole("button", { name: "Compare Medication Prices" }).click();

    // Wait for the agent response to appear
    await expect(page.getByText("Compared prices and found cheaper options.")).toBeVisible({
      timeout: 30_000,
    });

    expect(Date.now() - start).toBeLessThan(30_000);

    // Navigate to Medications tab
    await page.getByRole("tab", { name: "Medications" }).click();

    // All 4 drugs must be visible
    for (const drug of DRUGS) {
      await expect(page.getByText(drug)).toBeVisible();
    }

    // Each drug should show savings
    const savingsLocators = page.getByText(/Save \$[\d.]+\/mo/);
    await expect(savingsLocators).toHaveCount(4);
  });

  test("Activity tab shows 4+ service-fee transactions and 4 medication orders", async ({ page }) => {
    // Trigger agent run first
    await page.getByRole("button", { name: "Compare Medication Prices" }).click();
    await expect(page.getByText("Compared prices and found cheaper options.")).toBeVisible({
      timeout: 30_000,
    });

    // Navigate to Activity tab
    await page.getByRole("tab", { name: "Activity" }).click();

    // Should show medication order transactions
    const orderCount = await page.getByText(/Costco Pharmacy \[MPP Charge\]|MPP Charge/).count();
    expect(orderCount).toBeGreaterThanOrEqual(4);

    // Should show service fee transactions
    const feeCount = await page.getByText(/x402 query|service.fee|service_fee/i).count();
    expect(feeCount).toBeGreaterThanOrEqual(4);
  });
});
