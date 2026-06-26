// Extends vitest's expect with @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// This runs for all test environments; DOM matchers are only useful in jsdom tests.
import "@testing-library/jest-dom/vitest";

// Silence pino output in tests
process.env.LOG_LEVEL = "silent";
process.env.CAREGIVER_TOKEN = process.env.CAREGIVER_TOKEN || "test-caregiver-token";
