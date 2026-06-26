import { test, expect, type Page } from "@playwright/test";

const DRUGS = ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"] as const;

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

const MOCK_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

const MOCK_AGENT_RUN_BLOCKED = {
  response: "Payment blocked — $600 exceeds the $500 monthly bill budget.",
  toolCalls: [
    {
      tool: "pay_for_medication",
      input: { pharmacy_id: "general-hospital", pharmacy_name: "General Hospital", drug_name: "Surgery Follow-up", amount: 600 },
      result: { success: false, error: "Payment blocked by spending policy: $600 exceeds billMonthlyBudget of $500" },
    },
  ],
  spending: {
    policy: { ...MOCK_POLICY },
    spending: { medications: 14.0, bills: 0, serviceFees: 0.002, total: 14.002 },
    budgetRemaining: { medications: 286.0, bills: 500 },
    transactionCount: 1,
    recentTransactions: [],
  },
  llmUsage: { promptTokens: 50, completionTokens: 30 },
};

const MOCK_TRANSACTIONS_BLOCKED = {
  transactions: [
    {
      id: "tx-blocked-1",
      timestamp: new Date().toISOString(),
      type: "medication",
      description: "Surgery Follow-up from General Hospital",
      amount: 600,
      recipient: "general-hospital",
      status: "blocked",
      category: "bills",
    },
  ],
  pagination: { total: 1, limit: 25, offset: 0, hasMore: false, hasPrevious: false },
};

const MOCK_AGENT_RUN_OK = {
  response: "Compared prices and found cheaper options.",
  toolCalls: DRUGS.map((drug) => ({
    tool: "compare_pharmacy_prices",
    input: { drug_name: drug },
    result: {
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
    },
  })),
  spending: {
    policy: { ...MOCK_POLICY },
    spending: { medications: 14.0, bills: 0, serviceFees: 0.008, total: 14.008 },
    budgetRemaining: { medications: 286.0, bills: 500 },
    transactionCount: 4,
    recentTransactions: [],
  },
  llmUsage: { promptTokens: 100, completionTokens: 60 },
};

const MOCK_POLICY_UPDATED = {
  ...MOCK_POLICY,
  billMonthlyBudget: 400,
};

async function mockAgentApis(page: Page, policy = MOCK_POLICY) {
  await page.route("**/agent/profile", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_PROFILE) }),
  );
  await page.route("**/agent/spending", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ policy, spending: { medications: 14.0, bills: 0, serviceFees: 0.008, total: 14.008 }, budgetRemaining: { medications: 286.0, bills: 500 }, transactionCount: 0, recentTransactions: [] }) }),
  );
  await page.route("**/agent/transactions**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ transactions: [], pagination: { total: 0, limit: 25, offset: 0, hasMore: false, hasPrevious: false } }) }),
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
  await page.route("**/agent/wallet", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ usdc: "100.00", xlm: "42.0" }) }),
  );
  await page.route("**/horizon-testnet.stellar.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balances: [{ asset_code: "USDC", asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", balance: "100.00" }, { asset_type: "native", balance: "42.0" }] }) }),
  );
  const rootPayload = JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: false });
  await page.route("**localhost:3004/", (route) => route.fulfill({ status: 200, contentType: "application/json", body: rootPayload }));
  await page.route("**127.0.0.1:3004/", (route) => route.fulfill({ status: 200, contentType: "application/json", body: rootPayload }));
}

test.describe("Policy update + over-budget payment block", () => {
  test.beforeEach(async ({ page }) => {
    await mockAgentApis(page);
    await page.goto("/");
  });

  test("Edit all 5 policy fields, click Update Policy, verify Policy Saved appears", async ({ page }) => {
    // Navigate to Policy tab
    await page.getByRole("tab", { name: "Policy" }).click();
    await expect(page.getByRole("tabpanel", { name: "Policy" })).toBeVisible();

    // Clear and fill each field
    const fields = [
      { id: "policy-dailyLimit", value: "150" },
      { id: "policy-monthlyLimit", value: "600" },
      { id: "policy-medicationMonthlyBudget", value: "350" },
      { id: "policy-billMonthlyBudget", value: "400" },
      { id: "policy-approvalThreshold", value: "100" },
    ];

    for (const field of fields) {
      const input = page.locator(`#${field.id}`);
      await input.click();
      await input.fill(field.value);
    }

    // Submit
    await page.getByRole("button", { name: "Update Policy" }).click();

    // Should show "Policy Saved"
    await expect(page.getByRole("button", { name: "Policy Saved" })).toBeVisible({ timeout: 5_000 });
  });

  test("Form values persist across a page reload (loaded from backend)", async ({ page }) => {
    // Set policy to updated values on the backend
    await mockAgentApis(page, MOCK_POLICY_UPDATED);

    // Navigate to Policy tab
    await page.getByRole("tab", { name: "Policy" }).click();
    await expect(page.getByRole("tabpanel", { name: "Policy" })).toBeVisible();

    // Verify initial values from backend
    const billBudgetInput = page.locator("#policy-billMonthlyBudget");
    await expect(billBudgetInput).toHaveValue("400");

    // Reload — values should persist (mock still returns updated policy)
    await page.reload();
    await page.getByRole("tab", { name: "Policy" }).click();
    await expect(billBudgetInput).toHaveValue("400");
  });

  test("Click the over-budget demo button -> log entry shows the blocked reason", async ({ page }) => {
    // First set billMonthlyBudget to $400
    await page.route("**/agent/spending", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ policy: MOCK_POLICY_UPDATED, spending: { medications: 14.0, bills: 0, serviceFees: 0.008, total: 14.008 }, budgetRemaining: { medications: 286.0, bills: 400 }, transactionCount: 0, recentTransactions: [] }) }),
    );

    // Navigate to Policy tab and update
    await page.getByRole("tab", { name: "Policy" }).click();
    const billBudgetInput = page.locator("#policy-billMonthlyBudget");
    await billBudgetInput.click();
    await billBudgetInput.fill("400");
    await page.getByRole("button", { name: "Update Policy" }).click();
    await expect(page.getByRole("button", { name: "Policy Saved" })).toBeVisible({ timeout: 5_000 });

    // Go back to Overview
    await page.getByRole("tab", { name: "Overview" }).click();

    // Re-mock /agent/run to return blocked response
    await page.route("**/agent/run", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_AGENT_RUN_BLOCKED) }),
    );

    // Click Try Over-Budget Payment
    await page.getByRole("button", { name: "Try Over-Budget Payment" }).click();

    // Wait for agent response showing blocked reason
    await expect(page.getByText(/blocked|exceeds|Policy|budget/i)).toBeVisible({ timeout: 15_000 });
  });

  test("Activity tab transaction row for blocked attempt shows blocked chip", async ({ page }) => {
    // Mock transactions to include a blocked one
    await page.route("**/agent/transactions**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_TRANSACTIONS_BLOCKED) }),
    );

    // Run over-budget task to populate transactions
    await page.route("**/agent/run", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_AGENT_RUN_BLOCKED) }),
    );

    await page.getByRole("button", { name: "Try Over-Budget Payment" }).click();
    await expect(page.getByText(/blocked|exceeds/i)).toBeVisible({ timeout: 15_000 });

    // Navigate to Activity tab
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByRole("tabpanel", { name: "Activity" })).toBeVisible();

    // Check for blocked status chip
    const blockedChip = page.locator("span:has-text('blocked')");
    await expect(blockedChip.first()).toBeVisible();
  });

  test("Policy regression after pause/resume", async ({ page }) => {
    // Navigate to Policy tab
    await page.getByRole("tab", { name: "Policy" }).click();
    await expect(page.getByRole("tabpanel", { name: "Policy" })).toBeVisible();

    // Fill policy fields
    const billBudgetInput = page.locator("#policy-billMonthlyBudget");
    await billBudgetInput.click();
    await billBudgetInput.fill("400");

    // Submit
    await page.getByRole("button", { name: "Update Policy" }).click();
    await expect(page.getByRole("button", { name: "Policy Saved" })).toBeVisible({ timeout: 5_000 });

    // Pause the agent
    await page.route("**/agent/pause", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: true }) }),
    );
    await page.route("**/agent/resume", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: false }) }),
    );
    await page.route("**localhost:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );
    await page.route("**127.0.0.1:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused")).toBeVisible({ timeout: 12_000 });

    // Resume
    await page.route("**localhost:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: false }) }),
    );
    await page.route("**127.0.0.1:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: false }) }),
    );
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("Active")).toBeVisible({ timeout: 12_000 });

    // Go back to Policy tab — values should still be $400
    await page.getByRole("tab", { name: "Policy" }).click();
    await expect(billBudgetInput).toHaveValue("400");
  });
});
