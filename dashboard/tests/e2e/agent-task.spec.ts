import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("compare medication task updates UI", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Compare Medication Prices" }).click();
  await expect(page.getByText("Compared prices and found cheaper options.")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("tab", { name: "Medications" }).click();
  await expect(page.getByText("Lisinopril")).toBeVisible();
  await expect(page.getByText("Save $11.5/mo")).toBeVisible();
});
