import { expect, test } from "@playwright/test";
import { mockDashboardApis } from "./helpers";

test("security headers are present", async ({ page }) => {
  await mockDashboardApis(page);
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};

  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["content-security-policy-report-only"]).toContain("default-src 'self'");
});
