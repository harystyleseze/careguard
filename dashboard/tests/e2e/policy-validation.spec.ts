import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("Policy form blocks negative values and disables Update Policy", async ({ page }) => {
  let policyCalls = 0;
  await mockDashboardApis(page);
  await page.route("**/agent/policy", async (route) => {
    policyCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  await page.goto("/?tab=policy");

  const dailyLimit = page.locator("#policy-dailyLimit");
  await dailyLimit.fill("-1");
  await dailyLimit.blur();

  await expect(page.getByText(/must be greater than 0/i)).toBeVisible();

  const updateButton = page.getByRole("button", { name: "Update Policy" });
  await expect(updateButton).toBeDisabled();

  await updateButton.click({ force: true }).catch(() => {});
  expect(policyCalls).toBe(0);

  // Restore a valid value — button re-enables.
  await dailyLimit.fill("90");
  await dailyLimit.blur();
  await expect(updateButton).toBeEnabled();

  await updateButton.click();
  await expect.poll(() => policyCalls).toBeGreaterThan(0);
});

test("Policy form rejects dailyLimit greater than monthlyLimit", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/?tab=policy");

  await page.locator("#policy-dailyLimit").fill("9999");
  await page.locator("#policy-dailyLimit").blur();

  await expect(page.getByText(/cannot exceed monthly limit/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Update Policy" })).toBeDisabled();
});

test("Policy form rejects approvalThreshold greater than dailyLimit", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/?tab=policy");

  await page.locator("#policy-approvalThreshold").fill("9999");
  await page.locator("#policy-approvalThreshold").blur();

  await expect(page.getByText(/cannot exceed daily limit/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Update Policy" })).toBeDisabled();
});
