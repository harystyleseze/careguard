// Extends vitest's expect with @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// This runs for all test environments; DOM matchers are only useful in jsdom tests.
import "@testing-library/jest-dom/vitest";
