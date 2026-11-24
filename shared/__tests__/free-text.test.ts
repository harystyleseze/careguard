import { describe, it, expect } from "vitest";
import {
  freeTextSchema,
  optionalFreeTextSchema,
  zipCodeSchema,
  delimitedFreeTextListSchema,
  MAX_FREE_TEXT_LENGTH,
  MAX_TEXT_LIST_ITEMS,
  MAX_FREE_TEXT_LIST_LENGTH,
} from "../free-text.ts";

describe("shared/free-text.ts schema validation and boundaries (#1315)", () => {
  describe("freeTextSchema", () => {
    const schema = freeTextSchema("medicationName");

    it("accepts valid trimmed text within 80 characters", () => {
      const res = schema.safeParse("  Lisinopril 10mg  ");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toBe("Lisinopril 10mg");
      }
    });

    it("accepts exactly 80 characters", () => {
      const text80 = "a".repeat(80);
      const res = schema.safeParse(text80);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.length).toBe(80);
      }
    });

    it("rejects 81 characters (over MAX_FREE_TEXT_LENGTH)", () => {
      const text81 = "a".repeat(81);
      const res = schema.safeParse(text81);
      expect(res.success).toBe(false);
    });

    it("rejects 1,000 and 10,000 character inputs immediately", () => {
      const text1k = "a".repeat(1000);
      const text10k = "a".repeat(10000);
      expect(schema.safeParse(text1k).success).toBe(false);
      expect(schema.safeParse(text10k).success).toBe(false);
    });

    it("rejects empty strings and whitespace-only strings", () => {
      expect(schema.safeParse("").success).toBe(false);
      expect(schema.safeParse("   ").success).toBe(false);
    });
  });

  describe("optionalFreeTextSchema", () => {
    const schema = optionalFreeTextSchema("notes");

    it("accepts undefined or valid string", () => {
      expect(schema.safeParse(undefined).success).toBe(true);
      expect(schema.safeParse("Take with food").success).toBe(true);
    });

    it("rejects oversized optional text", () => {
      expect(schema.safeParse("a".repeat(81)).success).toBe(false);
    });
  });

  describe("zipCodeSchema", () => {
    it("accepts valid 5-digit US ZIP codes", () => {
      expect(zipCodeSchema.safeParse("90210").success).toBe(true);
      expect(zipCodeSchema.safeParse("  10001 ").success).toBe(true);
    });

    it("rejects non-5-digit strings", () => {
      expect(zipCodeSchema.safeParse("9021").success).toBe(false);
      expect(zipCodeSchema.safeParse("902100").success).toBe(false);
      expect(zipCodeSchema.safeParse("ABCDE").success).toBe(false);
    });
  });

  describe("delimitedFreeTextListSchema", () => {
    const schema = delimitedFreeTextListSchema("drugs", ",");

    it("parses valid comma-delimited items into trimmed array", () => {
      const input = " Lisinopril, Metformin , Amlodipine ";
      const res = schema.safeParse(input);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual(["Lisinopril", "Metformin", "Amlodipine"]);
      }
    });

    it("accepts up to MAX_TEXT_LIST_ITEMS (20) items", () => {
      const items = Array.from({ length: 20 }, (_, i) => `Medication${i}`);
      const input = items.join(",");
      const res = schema.safeParse(input);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toHaveLength(20);
      }
    });

    it("rejects more than 20 items", () => {
      const items = Array.from({ length: 21 }, (_, i) => `Med${i}`);
      const input = items.join(",");
      const res = schema.safeParse(input);
      expect(res.success).toBe(false);
    });

    it("rejects if individual item exceeds 80 characters", () => {
      const longItem = "a".repeat(81);
      const input = `Lisinopril,${longItem}`;
      const res = schema.safeParse(input);
      expect(res.success).toBe(false);
    });

    it("fails fast on 10,000 character input exceeding MAX_FREE_TEXT_LIST_LENGTH", () => {
      const text10k = "a".repeat(10000);
      const res = schema.safeParse(text10k);
      expect(res.success).toBe(false);
    });
  });
});
