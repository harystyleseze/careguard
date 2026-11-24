import { describe, it, expect } from "vitest";
import {
  parseBillTextToLineItems,
  extractLineItemsFromBillImage,
} from "../bill-ocr.ts";

describe("Medical Bill OCR Extraction (Issue #1229)", () => {
  it("parses raw OCR invoice text into structured line items with CPT codes", () => {
    const sampleOcrText = `
      METRO HEALTHCARE SYSTEM
      Patient: Rosa Garcia
      Date of Service: 2026-03-12

      Office visit moderate 99213 1 $130.00
      Metabolic Panel 80053 $85.50
      Chest X-ray Single View 71045 $120.00
      TOTAL BALANCE DUE: $335.50
    `;

    const items = parseBillTextToLineItems(sampleOcrText);
    expect(items.length).toBe(3);

    expect(items[0].cptCode).toBe("99213");
    expect(items[0].chargedAmount).toBe(130);

    expect(items[1].cptCode).toBe("80053");
    expect(items[1].chargedAmount).toBe(85.5);

    expect(items[2].cptCode).toBe("71045");
    expect(items[2].chargedAmount).toBe(120);
  });

  it("extracts line items from photographed bill images with high confidence", async () => {
    const dummyBase64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/";
    const result = await extractLineItemsFromBillImage(dummyBase64);

    expect(result.ok).toBe(true);
    expect(result.lineItems.length).toBeGreaterThan(0);
    expect(result.totalCharged).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0.7);

    for (const item of result.lineItems) {
      expect(item.description).toBeDefined();
      expect(item.chargedAmount).toBeGreaterThan(0);
      expect(item.quantity).toBeGreaterThanOrEqual(1);
    }
  });
});
