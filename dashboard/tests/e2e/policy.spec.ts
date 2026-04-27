import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("policy save sends API request", async ({ page }) => {
  let policyCalls = 0;
  await mockDashboardApis(page);
  await page.route("**/agent/policy", async (route) => {
    policyCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/?tab=policy");
  await page.locator("input[type='number']").first().fill("120");
  await page.getByRole("button", { name: "Update Policy" }).click();
  await expect.poll(() => policyCalls).toBeGreaterThan(0);
});
