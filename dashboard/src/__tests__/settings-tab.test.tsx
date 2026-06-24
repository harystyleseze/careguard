/**
 * Component tests for SettingsTab (Issue #79).
 * Runs in jsdom via environmentMatchGlobs in vitest.config.ts.
 * Covers: load from props, edit mode, save, cancel, agent status display.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsTab } from "../components/tabs/settings-tab";
import type { SettingsTabProps } from "../components/tabs/settings-tab";

const RECIPIENT = {
  name: "Rosa Garcia",
  age: 78,
  medications: ["Lisinopril", "Metformin"],
  doctor: "Dr. Chen, General Hospital",
  insurance: "Medicare Part D",
};

const CAREGIVER = {
  name: "Maria Garcia",
  relationship: "Daughter",
  location: "Phoenix, AZ",
  notifications: "Email + SMS",
};

function buildProps(overrides: Partial<SettingsTabProps> = {}): SettingsTabProps {
  return {
    recipient: RECIPIENT,
    caregiver: CAREGIVER,
    agentInfo: null,
    agentPaused: false,
    onTogglePause: vi.fn(),
    onUpdateProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("SettingsTab — load from props (Issue #79)", () => {
  it("renders recipient name from props (not hardcoded)", () => {
    render(<SettingsTab {...buildProps()} />);
    expect(screen.getByText("Rosa Garcia")).toBeTruthy();
  });

  it("renders caregiver name from props (not hardcoded)", () => {
    render(<SettingsTab {...buildProps()} />);
    expect(screen.getByText("Maria Garcia")).toBeTruthy();
  });

  it("renders medications from props", () => {
    render(<SettingsTab {...buildProps()} />);
    expect(screen.getByText(/Lisinopril/)).toBeTruthy();
  });

  it("renders doctor from props", () => {
    render(<SettingsTab {...buildProps()} />);
    expect(screen.getByText("Dr. Chen, General Hospital")).toBeTruthy();
  });

  it("renders insurance from props", () => {
    render(<SettingsTab {...buildProps()} />);
    expect(screen.getByText("Medicare Part D")).toBeTruthy();
  });

  it("shows Edit button in display mode", () => {
    render(<SettingsTab {...buildProps()} />);
    expect(screen.getByRole("button", { name: /Edit/i })).toBeTruthy();
  });
});

describe("SettingsTab — edit mode (Issue #79)", () => {
  it("shows inputs when Edit is clicked", () => {
    render(<SettingsTab {...buildProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    expect(screen.getByLabelText(/Recipient Name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Caregiver Name/i)).toBeTruthy();
  });

  it("pre-populates inputs with current prop values", () => {
    render(<SettingsTab {...buildProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    const nameInput = screen.getByLabelText(/Recipient Name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Rosa Garcia");
  });

  it("pre-populates medications as comma-joined string", () => {
    render(<SettingsTab {...buildProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    const medInput = screen.getByLabelText(/Medications/i) as HTMLInputElement;
    expect(medInput.value).toBe("Lisinopril, Metformin");
  });

  it("Cancel reverts to display mode without calling onUpdateProfile", () => {
    const onUpdateProfile = vi.fn();
    render(<SettingsTab {...buildProps({ onUpdateProfile })} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onUpdateProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Edit/i })).toBeTruthy();
  });
});

describe("SettingsTab — save (Issue #79)", () => {
  it("calls onUpdateProfile with updated values on Save", async () => {
    const onUpdateProfile = vi.fn().mockResolvedValue(undefined);
    render(<SettingsTab {...buildProps({ onUpdateProfile })} />);

    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    const nameInput = screen.getByLabelText(/Recipient Name/i);
    fireEvent.change(nameInput, { target: { value: "Rosa M. Garcia" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(onUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: expect.objectContaining({ name: "Rosa M. Garcia" }),
        }),
      );
    });
  });

  it("returns to display mode after successful save", async () => {
    const onUpdateProfile = vi.fn().mockResolvedValue(undefined);
    render(<SettingsTab {...buildProps({ onUpdateProfile })} />);

    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Edit/i })).toBeTruthy();
    });
  });

  it("passes caregiver fields to onUpdateProfile", async () => {
    const onUpdateProfile = vi.fn().mockResolvedValue(undefined);
    render(<SettingsTab {...buildProps({ onUpdateProfile })} />);

    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    const relInput = screen.getByLabelText(/Relationship/i);
    fireEvent.change(relInput, { target: { value: "Son" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(onUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          caregiver: expect.objectContaining({ relationship: "Son" }),
        }),
      );
    });
  });
});

describe("SettingsTab — agent status (Issue #79)", () => {
  it("reads /agent/status via agentPaused prop — shows Paused + Resume button", () => {
    render(<SettingsTab {...buildProps({ agentPaused: true })} />);
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Resume Agent/i })).toBeTruthy();
  });

  it("shows Active when agentPaused is false", () => {
    render(<SettingsTab {...buildProps({ agentPaused: false })} />);
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("calls onTogglePause when pause/resume button clicked", () => {
    const onTogglePause = vi.fn();
    render(<SettingsTab {...buildProps({ onTogglePause })} />);
    fireEvent.click(screen.getByRole("button", { name: /Pause Agent/i }));
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });
});
