import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("all dashboard tabs render without crashing", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "CareGuard" })).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();

  const tabs = ["Overview", "Medications", "Bills", "Policy", "Wallet", "Activity", "Settings"];
  for (const tab of tabs) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
});
