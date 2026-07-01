import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("no sensitive data is persisted to localStorage or sessionStorage (#96)", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/");

  const tabs = ["Overview", "Medications", "Bills", "Policy", "Wallet", "Activity", "Settings"];
  for (const tab of tabs) {
    await page.getByRole("tab", { name: tab }).click();
  }

  const storageBeforeReload = await page.evaluate(() => ({
    localStorage: Object.keys(window.localStorage),
    sessionStorage: Object.keys(window.sessionStorage),
  }));
  expect(storageBeforeReload.localStorage).toEqual([]);
  expect(storageBeforeReload.sessionStorage).toEqual([]);

  await page.reload();

  const storageAfterReload = await page.evaluate(() => ({
    localStorage: Object.keys(window.localStorage),
    sessionStorage: Object.keys(window.sessionStorage),
  }));
  expect(storageAfterReload.localStorage).toEqual([]);
  expect(storageAfterReload.sessionStorage).toEqual([]);
});
