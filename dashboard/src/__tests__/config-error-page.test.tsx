/**
 * Tests for Issue #1260 — ConfigErrorPage serves both audiences.
 *
 * Verifies:
 *  1. A plain-language message aimed at non-technical caregivers is shown.
 *  2. The technical instructions for the deploying developer remain intact.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConfigErrorPage } from "../components/config-error-page";

describe("ConfigErrorPage — caregiver guidance (Issue #1260)", () => {
  it("shows a plain-language message for non-technical viewers", () => {
    render(<ConfigErrorPage />);
    expect(screen.getByTestId("caregiver-guidance")).toBeTruthy();
    expect(
      screen.getByText(/contact whoever set up this dashboard/i),
    ).toBeTruthy();
    expect(screen.getByText(/No action is needed from you/i)).toBeTruthy();
  });

  it("keeps the technical instructions for the deploying developer", () => {
    render(<ConfigErrorPage />);
    expect(screen.getByText("NEXT_PUBLIC_API_URL")).toBeTruthy();
    expect(
      screen.getByText(/deployment environment or/i),
    ).toBeTruthy();
    expect(screen.getByText(/dashboard\/.env.local/i)).toBeTruthy();
  });

  it("reads clearly to both audiences at once", () => {
    const { container } = render(<ConfigErrorPage />);
    expect(
      screen.getByText(/contact whoever set up this dashboard/i),
    ).toBeTruthy();
    expect(container.textContent).toContain("NEXT_PUBLIC_API_URL");
    expect(container.textContent).toContain(
      "for all required environment variables",
    );
  });
});
