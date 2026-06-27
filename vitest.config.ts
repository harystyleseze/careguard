import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./dashboard/src"),
      "next/font/google": path.resolve(__dirname, "./dashboard/src/__tests__/__mocks__/next-font-google.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Dashboard component tests need jsdom (DOM APIs + React)
    environmentMatchGlobs: [
      ["dashboard/src/__tests__/**/*.test.tsx", "jsdom"],
    ],
    include: ["**/__tests__/**/*.test.{ts,tsx}", "**/test/**/*.test.{ts,tsx}", "**/evals/**/*.spec.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: [
        "agent/**/*.ts",
        "services/**/*.ts",
        "shared/**/*.ts",
        "scripts/**/*.ts",
        "dashboard/src/**/*.ts",
        "dashboard/src/**/*.tsx",
      ],
      exclude: ["**/*.d.ts", "**/node_modules/**", "**/__tests__/**", "**/test/**"],
    },
  },
});
