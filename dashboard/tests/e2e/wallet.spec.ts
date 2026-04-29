import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("wallet tab shows mocked horizon balances", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/?tab=wallet");

  const usdcCard = page.getByText("USDC Balance").locator("..");
  await expect(usdcCard.getByText("$123.45")).toBeVisible();
  const xlmCard = page.getByText("XLM Balance").locator("..");
  await expect(xlmCard.getByText("42.00")).toBeVisible();
});
