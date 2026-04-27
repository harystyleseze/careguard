import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("wallet tab shows mocked horizon balances", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/?tab=wallet");

  await expect(page.getByText("$123.45")).toBeVisible();
  await expect(page.getByText("42.00")).toBeVisible();
});
