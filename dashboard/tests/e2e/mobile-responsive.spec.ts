import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test.use({
  locale: "en-US",
  timezoneId: "UTC",
});

const viewports = [
  { name: "375px", width: 375, height: 667 },
  { name: "768px", width: 768, height: 1024 },
  { name: "1024px", width: 1024, height: 768 },
  { name: "1280px", width: 1280, height: 800 },
];

const tabs = ["Overview", "Medications", "Bills", "Policy", "Wallet", "Activity", "Settings"];

for (const viewport of viewports) {
  test(`dashboard screenshots stay responsive at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockDashboardApis(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "CareGuard" })).toBeVisible();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    for (const tab of tabs) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.locator(`#tabpanel-${tab.toLowerCase()}`)).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${viewport.name}-${tab.toLowerCase()}.png`,
        {
          animations: "disabled",
          caret: "hide",
        },
      );
    }
  });
}
