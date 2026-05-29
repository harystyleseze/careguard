import { describe, it, expect } from "vitest";
import { buildScrubSession, scrubText } from "../prompt-scrub.ts";

const SESSION = buildScrubSession(["Rosa Garcia"], ["Maria Garcia"]);

describe("buildScrubSession", () => {
  it("maps patient name to Patient A", () => {
    expect(SESSION.realToAlias.get("Rosa Garcia")).toBe("Patient A");
  });

  it("maps caregiver name to Caregiver A", () => {
    expect(SESSION.realToAlias.get("Maria Garcia")).toBe("Caregiver A");
  });

  it("builds inverse table for server-side cross-reference", () => {
    expect(SESSION.aliasToReal.get("Patient A")).toBe("Rosa Garcia");
    expect(SESSION.aliasToReal.get("Caregiver A")).toBe("Maria Garcia");
  });

  it("assigns sequential labels for multiple patients", () => {
    const s = buildScrubSession(["Alice", "Bob"], []);
    expect(s.realToAlias.get("Alice")).toBe("Patient A");
    expect(s.realToAlias.get("Bob")).toBe("Patient B");
  });
});

describe("scrubText", () => {
  it("replaces Rosa Garcia with Patient A consistently across a run", () => {
    const prompt = "Current care recipient: Rosa Garcia (age 78)";
    const scrubbed = scrubText(prompt, SESSION);
    expect(scrubbed).not.toContain("Rosa Garcia");
    expect(scrubbed).toContain("Patient A");
    // Second call with same session produces same result
    expect(scrubText(prompt, SESSION)).toBe(scrubbed);
  });

  it("replaces Maria Garcia with Caregiver A", () => {
    const prompt = "Caregiver: Maria Garcia (daughter)";
    const scrubbed = scrubText(prompt, SESSION);
    expect(scrubbed).not.toContain("Maria Garcia");
    expect(scrubbed).toContain("Caregiver A");
  });

  it("preserves medication names — they are not PII", () => {
    const prompt = "Patient A takes Lisinopril, Metformin, Atorvastatin";
    const scrubbed = scrubText(prompt, SESSION);
    expect(scrubbed).toContain("Lisinopril");
    expect(scrubbed).toContain("Metformin");
    expect(scrubbed).toContain("Atorvastatin");
  });

  it("leaves text unchanged when the session has no mappings", () => {
    const empty = buildScrubSession([], []);
    const text = "Rosa Garcia (age 78)";
    expect(scrubText(text, empty)).toBe(text);
  });

  it("replaces all occurrences in a long prompt", () => {
    const prompt = "Rosa Garcia visited. Rosa Garcia's doctor saw Rosa Garcia.";
    const scrubbed = scrubText(prompt, SESSION);
    expect(scrubbed).not.toContain("Rosa Garcia");
    expect(scrubbed.match(/Patient A/g)?.length).toBe(3);
  });
});
