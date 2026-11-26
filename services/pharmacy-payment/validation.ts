import { z } from "zod";
import { freeTextSchema } from "../../shared/free-text.ts";
import { PRICING_DATABASE } from "../../shared/pharmacy-pricing.ts";

export const OrderAmountSchema = z
  .union([z.number(), z.string()])
  .transform<number>((value, ctx) => {
    let parsed: number;
    if (typeof value === "number") {
      parsed = value;
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      parsed = Number(value);
    } else {
      ctx.addIssue({
        code: "custom",
        message: "amount must be a valid number",
      });
      return z.NEVER;
    }
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({
        code: "custom",
        message: "amount must be a valid number",
      });
      return z.NEVER;
    }
    if (parsed < 0.01) {
      ctx.addIssue({
        code: "custom",
        message: "amount must be at least $0.01",
      });
      return z.NEVER;
    }
    if (parsed > 10000) {
      ctx.addIssue({
        code: "custom",
        message: "amount must not exceed $10,000",
      });
      return z.NEVER;
    }
    return parsed;
  });

export const MedicationOrderSchema = z
  .object({
    drug: freeTextSchema("drug"),
    pharmacy: freeTextSchema("pharmacy"),
    amount: OrderAmountSchema,
  })
  .strict();

export type MedicationOrderInput = z.infer<typeof MedicationOrderSchema>;

// Known (drug, pharmacy) pairs drawn from the shared pharmacy pricing catalog.
// Used to reject orders for drugs/pharmacies that do not exist before any
// payment is initiated (Issue #927).
const KNOWN_DRUG_PHARMACY_PAIRS = new Set(
  Object.entries(PRICING_DATABASE).flatMap(([drug, byZip]) =>
    Object.values(byZip).flatMap((prices) =>
      prices.map((p) => `${drug.toLowerCase()}::${p.pharmacy.toLowerCase()}`),
    ),
  ),
);

export function isKnownDrugPharmacyPair(drug: string, pharmacy: string): boolean {
  const key = `${String(drug ?? "").trim().toLowerCase()}::${String(pharmacy ?? "").trim().toLowerCase()}`;
  return KNOWN_DRUG_PHARMACY_PAIRS.has(key);
}
