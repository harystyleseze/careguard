import { describe, it, expect } from "vitest";
import { sanitizeUserString } from "../sanitize.ts";

describe("sanitizeUserString", () => {
  it("passes through clean alphanumeric strings", () => {
    expect(sanitizeUserString("Lisinopril")).toBe("Lisinopril");
    expect(sanitizeUserString("CVS Pharmacy (Main St)")).toBe("CVS Pharmacy (Main St)");
  });

  it("strips newline characters", () => {
    expect(sanitizeUserString("Drug\nName")).toBe("DrugName");
    expect(sanitizeUserString("Drug\r\nName")).toBe("DrugName");
  });

  it("strips Unicode RTL marks", () => {
    // U+200F RIGHT-TO-LEFT MARK, U+202B RIGHT-TO-LEFT EMBEDDING
    expect(sanitizeUserString("Drug\u200FName")).toBe("DrugName");
    expect(sanitizeUserString("Drug\u202BName")).toBe("DrugName");
  });

  it("strips null bytes and other control characters", () => {
    expect(sanitizeUserString("Drug\x00Name")).toBe("DrugName");
    expect(sanitizeUserString("Drug\x07Name")).toBe("DrugName");
  });

  it("strips characters outside the allowed set", () => {
    expect(sanitizeUserString("Drug<Name>")).toBe("DrugName");
    expect(sanitizeUserString("Drug{Name}")).toBe("DrugName");
    expect(sanitizeUserString("Drug@Name!")).toBe("DrugName");
  });

  it("caps length to 80 characters", () => {
    const long = "A".repeat(100);
    expect(sanitizeUserString(long)).toHaveLength(80);
  });

  it("returns empty string for non-string input", () => {
    expect(sanitizeUserString(null)).toBe("");
    expect(sanitizeUserString(undefined)).toBe("");
    expect(sanitizeUserString(123)).toBe("");
  });

  it("trims whitespace", () => {
    expect(sanitizeUserString("  Drug  ")).toBe("Drug");
  });

  it("allows hyphens and parentheses", () => {
    expect(sanitizeUserString("Drug-Name (10mg)")).toBe("Drug-Name (10mg)");
  });
});
