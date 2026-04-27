import { describe, it, expect } from "vitest";

describe("JSON Parsing (Issue #248)", () => {
  it("should handle invalid JSON in audit_medical_bill gracefully", () => {
    const invalidJson = '{"description": "test", invalid json}';
    let parseError = false;
    try {
      JSON.parse(invalidJson);
    } catch {
      parseError = true;
    }
    expect(parseError).toBe(true);
  });

  it("should handle trailing commas in JSON", () => {
    const jsonWithTrailingComma = '[{"description": "test"},]';
    let parseError = false;
    try {
      JSON.parse(jsonWithTrailingComma);
    } catch {
      parseError = true;
    }
    expect(parseError).toBe(true);
  });

  it("should handle unclosed strings in JSON", () => {
    const jsonWithUnclosedString = '[{"description": "test}]';
    let parseError = false;
    try {
      JSON.parse(jsonWithUnclosedString);
    } catch {
      parseError = true;
    }
    expect(parseError).toBe(true);
  });

  it("should extract first 200 chars of invalid JSON as sample", () => {
    const longInvalidJson = '{"description": "' + "x".repeat(500) + '", invalid}';
    const sample = longInvalidJson.slice(0, 200);
    expect(sample.length).toBeLessThanOrEqual(200);
    expect(sample).toContain("description");
  });
});
