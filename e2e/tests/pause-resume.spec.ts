import { test, expect, type Page } from "@playwright/test";

const MOCK_PROFILE = {
  recipient: {
    name: "Rosa Garcia",
    age: 78,
    medications: ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"],
    doctor: "Dr. Chen, General Hospital",
    insurance: "Medicare Part D",
  },
  caregiver: { name: "Maria Garcia", relationship: "Daughter", location: "Phoenix, AZ", notifications: "Email + SMS" },
};

const MOCK_SPENDING = {
  policy: { dailyLimit: 100, monthlyLimit: 500, medicationMonthlyBudget: 300, billMonthlyBudget: 500, approvalThreshold: 75 },
  spending: { medications: 14.0, bills: 0, serviceFees: 0.008, total: 14.008 },
  budgetRemaining: { medications: 286.0, bills: 500 },
  transactionCount: 0,
  recentTransactions: [],
};

const MOCK_AGENT_RUN = {
  response: "Task completed.",
  toolCalls: [],
  spending: MOCK_SPENDING,
  llmUsage: { promptTokens: 50, completionTokens: 30 },
};

async function mockAgentApis(page: Page, paused = false) {
  await page.route("**/agent/profile", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_PROFILE) }),
  );
  await page.route("**/agent/spending", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SPENDING) }),
  );
  await page.route("**/agent/transactions**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ transactions: [], pagination: { total: 0, limit: 25, offset: 0, hasMore: false, hasPrevious: false } }) }),
  );
  await page.route("**/agent/run", (route) =>
    route.fulfill({ status: paused ? 409 : 200, contentType: "application/json", body: paused ? JSON.stringify({ error: "Agent is paused" }) : JSON.stringify(MOCK_AGENT_RUN) }),
  );
  await page.route("**/agent/policy", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
  );
  await page.route("**/agent/reset", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
  );
  await page.route("**/agent/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused }) }),
  );
  await page.route("**/agent/wallet", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ usdc: "100.00", xlm: "42.0" }) }),
  );
  await page.route("**/horizon-testnet.stellar.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balances: [{ asset_code: "USDC", asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", balance: "100.00" }, { asset_type: "native", balance: "42.0" }] }) }),
  );
  const rootPayload = JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused });
  await page.route("**localhost:3004/", (route) => route.fulfill({ status: 200, contentType: "application/json", body: rootPayload }));
  await page.route("**127.0.0.1:3004/", (route) => route.fulfill({ status: 200, contentType: "application/json", body: rootPayload }));
}

test.describe("Pause/Resume behaviour from header", () => {
  test.beforeEach(async ({ page }) => {
    await mockAgentApis(page, false);
    await page.goto("/");
  });

  test("Pause button toggles chip text and colour (Active -> Paused)", async ({ page }) => {
    // Initially shows Active status
    await expect(page.getByText("Active")).toBeVisible();

    const pauseBtn = page.getByRole("button", { name: "Pause" });
    await expect(pauseBtn).toBeVisible();

    // Intercept the pause API call
    await page.route("**/agent/pause", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: true }) }),
    );
    await page.route("**/agent/resume", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: false }) }),
    );

    // Re-mock root endpoint to reflect paused state
    await page.route("**localhost:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );
    await page.route("**127.0.0.1:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );

    // Click Pause
    await pauseBtn.click();

    // After pause polling, the chip should show "Paused"
    await expect(page.getByText("Paused")).toBeVisible({ timeout: 12_000 });
    // Resume button should appear
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  test("Clicking a demo action while paused shows Agent is paused in log", async ({ page }) => {
    // Click Pause first
    await page.route("**/agent/pause", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: true }) }),
    );
    await page.route("**localhost:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );
    await page.route("**127.0.0.1:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused")).toBeVisible({ timeout: 12_000 });

    // Re-mock /agent/run to return 409
    await page.route("**/agent/run", (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Agent is paused" }) }),
    );

    // Click a demo action
    await page.getByRole("button", { name: "Compare Medication Prices" }).click();

    // The button should be disabled/busy since agent is paused
    // Wait for the error log message
    await expect(page.getByText(/Agent is paused|409/i)).toBeVisible({ timeout: 5_000 });
  });

  test("Resume -> tasks run again", async ({ page }) => {
    // Intercept pause/resume
    await page.route("**/agent/pause", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: true }) }),
    );
    await page.route("**/agent/resume", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: false }) }),
    );

    // Pause first
    await page.route("**localhost:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );
    await page.route("**127.0.0.1:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused")).toBeVisible({ timeout: 12_000 });

    // Now resume
    await page.route("**localhost:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: false }) }),
    );
    await page.route("**127.0.0.1:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: false }) }),
    );

    await page.getByRole("button", { name: "Resume" }).click();

    // Should show Active again
    await expect(page.getByText("Active")).toBeVisible({ timeout: 12_000 });

    // Now run a task — should succeed
    await page.route("**/agent/run", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_AGENT_RUN) }),
    );
    await page.getByRole("button", { name: "Compare Medication Prices" }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 15_000 });
  });

  test("State survives page reload", async ({ page }) => {
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

    // Pause
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused")).toBeVisible({ timeout: 12_000 });

    // Reload — the mock still returns paused: true
    await page.reload();

    // Wait for polling to re-fetch agent info
    await expect(page.getByText("Paused")).toBeVisible({ timeout: 15_000 });
  });

  test("Pause state reflects across two tabs within 10s poll interval", async ({ page, context }) => {
    await page.route("**/agent/pause", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paused: true }) }),
    );

    await page.route("**localhost:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: false }) }),
    );
    await page.route("**127.0.0.1:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: false }) }),
    );

    // Open second tab
    const page2 = await context.newPage();
    await mockAgentApis(page2, false);
    await page2.goto("/");

    // Both show Active initially
    await expect(page.getByText("Active")).toBeVisible();

    // In tab 1: change mock to paused
    await page.route("**localhost:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );
    await page.route("**127.0.0.1:3004/", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ service: "agent", agentWallet: "GBQTESTWALLET123", llm: "mock-llm", network: "stellar:testnet", paused: true }) }),
    );

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused")).toBeVisible({ timeout: 12_000 });

    // The second tab should also reflect paused within 10s poll interval
    await expect(page2.getByText("Paused")).toBeVisible({ timeout: 12_000 });
  });
});
