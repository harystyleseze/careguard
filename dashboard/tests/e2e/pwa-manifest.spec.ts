import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("links the web app manifest for install-to-home-screen", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/");

  await expect(page.locator("link[rel='manifest']")).toHaveAttribute(
    "href",
    /manifest\.json$/,
  );
});

test("manifest.json is served with the expected PWA fields", async ({ page }) => {
  const response = await page.request.get("/manifest.json");
  expect(response.ok()).toBe(true);

  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toBe("#0ea5e9");
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
    ]),
  );
});
