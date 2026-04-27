import { Page } from "@playwright/test";
import profile from "../fixtures/profile.json";
import spending from "../fixtures/spending.json";
import transactions from "../fixtures/transactions.json";
import agentRun from "../fixtures/agent-run.json";

export async function mockDashboardApis(page: Page) {
  await page.route("**/agent/profile", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
  });

  await page.route("**/agent/spending", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(spending) });
  });

  await page.route("**/agent/transactions", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(transactions) });
  });

  await page.route("**/agent/run", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agentRun) });
  });

  await page.route("**/agent/policy", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.route("**/agent/reset", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.route("**/horizon-testnet.stellar.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        balances: [
          { asset_code: "USDC", balance: "123.45" },
          { asset_type: "native", balance: "42.0" },
        ],
      }),
    });
  });

  const rootPayload = JSON.stringify({
    service: "agent",
    agentWallet: "GBQTESTWALLET123",
    llm: "mock-llm",
    network: "stellar:testnet",
    paused: false,
  });
  await page.route("**localhost:3004/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: rootPayload });
  });
  await page.route("**127.0.0.1:3004/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: rootPayload });
  });
}
