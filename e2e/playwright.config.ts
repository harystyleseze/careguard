/**
 * Playwright config for full-stack E2E tests (Issue #51)
 *
 * Boots the Next.js dashboard + unified agent server locally,
 * with injected mock LLM and mocked x402/MPP responses.
 */
import { defineConfig, devices } from "@playwright/test";

const DASHBOARD_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  // Single worker — avoids port conflicts and shared-state races
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    baseURL: DASHBOARD_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        // Start the Next.js dashboard; the agent server is mocked via route intercepts
        command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
        cwd: "../dashboard",
        url: DASHBOARD_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
