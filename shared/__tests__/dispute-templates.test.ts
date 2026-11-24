import { describe, it, expect } from "vitest";
import {
  DISPUTE_REASON_TEMPLATES,
  DISPUTE_TEMPLATES,
  inferDisputeTemplate,
  formatDisputeLetter,
  formatDisputeHtml,
  type DisputeReasonTemplate,
} from "../dispute-templates.ts";

describe("Issue #1224: Selectable Appeal Letter Templates with Legal Citations", () => {
  it("defines all 5 required dispute reason templates with statutory legal citations", () => {
    expect(DISPUTE_REASON_TEMPLATES).toEqual([
      "duplicate_charge",
      "coding_error",
      "balance_billing",
      "unbundling",
      "general_dispute",
    ]);

    for (const reason of DISPUTE_REASON_TEMPLATES) {
      const template = DISPUTE_TEMPLATES[reason];
      expect(template).toBeDefined();
      expect(template.id).toBe(reason);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.legalBasis.length).toBeGreaterThan(0);
      expect(template.summaryClause.length).toBeGreaterThan(0);
      expect(template.demandedRemedy.length).toBeGreaterThan(0);
    }

    // Specific statutory citation checks
    expect(
      DISPUTE_TEMPLATES.balance_billing.legalBasis.some((b) => b.includes("45 CFR § 149") || b.includes("No Surprises Act"))
    ).toBe(true);
    expect(
      DISPUTE_TEMPLATES.duplicate_charge.legalBasis.some((b) => b.includes("31 U.S.C. § 3729") || b.includes("False Claims Act"))
    ).toBe(true);
    expect(
      DISPUTE_TEMPLATES.unbundling.legalBasis.some((b) => b.includes("NCCI") || b.includes("Unbundl"))
    ).toBe(true);
    expect(
      DISPUTE_TEMPLATES.coding_error.legalBasis.some((b) => b.includes("CPT") || b.includes("NCCI"))
    ).toBe(true);
  });

  it("correctly infers dispute templates from audit findings text", () => {
    expect(
      inferDisputeTemplate(["Duplicate billing detected for CPT 99214 on same date of service"])
    ).toBe("duplicate_charge");

    expect(
      inferDisputeTemplate(["Line items 80053 and 80048 constitute unbundled panels under NCCI"])
    ).toBe("unbundling");

    expect(
      inferDisputeTemplate(["Emergency care balance billed out-of-network in violation of NSA"])
    ).toBe("balance_billing");

    expect(
      inferDisputeTemplate(["CPT code 99285 does not match medical record documentation"])
    ).toBe("coding_error");

    expect(
      inferDisputeTemplate(["Fee exceeds regional median benchmark by 450%"])
    ).toBe("general_dispute");

    expect(inferDisputeTemplate([])).toBe("general_dispute");
  });

  it("formats dispute letter with dynamic parameters and legal citations", () => {
    const letter = formatDisputeLetter("balance_billing", {
      hospitalName: "Memorial Regional Hospital",
      patientName: "Rosa Garcia",
      accountNumber: "ACC-99210",
      dateOfService: "2026-09-15",
      totalBilled: 1250.0,
      correctedAmount: 150.0,
      disputedItems: [
        {
          cptCode: "99284",
          description: "Emergency Department Visit",
          chargedAmount: 1250.0,
          expectedAmount: 150.0,
          reason: "Out-of-network balance billing prohibited under federal No Surprises Act",
        },
      ],
    });

    expect(letter).toContain("ATTN: Billing & Patient Financial Services");
    expect(letter).toContain("Memorial Regional Hospital");
    expect(letter).toContain("Rosa Garcia");
    expect(letter).toContain("ACC-99210");
    expect(letter).toContain("45 CFR § 149");
    expect(letter).toContain("No Surprises Act");
    expect(letter).toContain("$1,250.00");
    expect(letter).toContain("$150.00");
    expect(letter).toContain("FORMAL WRITTEN DISPUTE");
  });

  it("generates rich HTML dispute letter for patient records and email", () => {
    const html = formatDisputeHtml("unbundling", {
      hospitalName: "City General Hospital",
      patientName: "John Doe",
      accountNumber: "JD-12345",
      dateOfService: "2026-08-01",
      totalBilled: 450.0,
      correctedAmount: 200.0,
      disputedItems: [
        {
          cptCode: "80053",
          description: "Comprehensive Metabolic Panel",
          chargedAmount: 250.0,
          expectedAmount: 100.0,
          reason: "Unbundled component tests",
        },
      ],
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("City General Hospital");
    expect(html).toContain("CMS National Correct Coding Initiative (NCCI)");
    expect(html).toContain("JD-12345");
  });
});
