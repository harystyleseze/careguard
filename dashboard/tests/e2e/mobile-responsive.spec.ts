import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

const viewports = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 14 Pro", width: 393, height: 852 },
  { name: "Pixel 5", width: 393, height: 851 },
  { name: "iPad", width: 768, height: 1024 },
];

for (const viewport of viewports) {
  test(`activity and bill tables are scrollable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockDashboardApis(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Audit Hospital Bill" }).click();
    await page.getByRole("tab", { name: "Bills" }).click();
    await expect(page.locator(".overflow-x-auto").first()).toBeVisible();

    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.locator("table.min-w-\\[640px\\]")).toBeVisible();
  });
}
