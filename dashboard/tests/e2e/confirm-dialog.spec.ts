import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("Reset All requires confirmation before calling /agent/reset", async ({ page }) => {
  let resetCalls = 0;
  await mockDashboardApis(page);
  await page.route("**/agent/reset", async (route) => {
    resetCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  await page.goto("/?tab=activity");
  await page.getByRole("button", { name: "Reset All" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This will delete");
  await expect(dialog).toContainText("This cannot be undone.");

  // Cancel the dialog — no reset call should be made.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  expect(resetCalls).toBe(0);

  // Open again and confirm — call goes through.
  await page.getByRole("button", { name: "Reset All" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect.poll(() => resetCalls).toBeGreaterThan(0);
});

test("Reset All confirm dialog cancels on Escape", async ({ page }) => {
  let resetCalls = 0;
  await mockDashboardApis(page);
  await page.route("**/agent/reset", async (route) => {
    resetCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });

  await page.goto("/?tab=activity");
  await page.getByRole("button", { name: "Reset All" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(resetCalls).toBe(0);
});
