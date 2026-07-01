import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "agent/**/__tests__/**/*.test.{ts,tsx}",
      "agent/**/evals/**/*.spec.{ts,tsx}",
      "services/**/__tests__/**/*.test.{ts,tsx}",
      "shared/**/__tests__/**/*.test.{ts,tsx}",
      "scripts/**/__tests__/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: [
        "agent/**/*.ts",
        "services/**/*.ts",
        "shared/**/*.ts",
        "scripts/**/*.ts",
        "server.ts",
      ],
      exclude: ["**/*.d.ts", "**/node_modules/**", "**/__tests__/**", "**/test/**"],
    },
  },
});
