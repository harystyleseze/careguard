import { z } from "zod";
import {
  freeTextSchema,
  optionalFreeTextSchema,
  zipCodeSchema,
} from "../../shared/free-text.ts";
import {
  type PharmacyPriceRecord,
  toDisplayName,
} from "./db.ts";

export const PharmacyCompareQuerySchema = z
  .object({
    drug: freeTextSchema("drug"),
    dosage: optionalFreeTextSchema("dosage"),
    zip: zipCodeSchema.optional().default("90210"),
  })
  .strict();
export type PharmacyCompareQuery = z.infer<typeof PharmacyCompareQuerySchema>;

export const PharmacyRecordSchema = z
  .object({
    id: freeTextSchema("id"),
    name: freeTextSchema("name"),
    distanceMiles: z.coerce
      .number()
      .min(0, "distanceMiles must be at least 0")
      .max(500, "distanceMiles must be at most 500"),
  })
  .strict();
export type PharmacyRecordInput = z.infer<typeof PharmacyRecordSchema>;

export const DrugRecordSchema = z
  .object({
    name: freeTextSchema("name"),
    displayName: optionalFreeTextSchema("displayName"),
    defaultDosage: optionalFreeTextSchema("defaultDosage"),
  })
  .strict();
export type DrugRecordInput = z.infer<typeof DrugRecordSchema>;

export const PharmacyPriceSchema = z
  .object({
    drug: freeTextSchema("drug"),
    pharmacyId: freeTextSchema("pharmacyId"),
    price: z.coerce
      .number()
      .positive("price must be greater than 0")
      .max(10000, "price must be at most 10000"),
  })
  .strict();
export type PharmacyPriceInput = z.infer<typeof PharmacyPriceSchema>;

export function buildCompareResponse(options: {
  drug: string;
  dosage: string;
  zip: string;
  payTo: string;
  network: string;
  prices: PharmacyPriceRecord[];
  protocolPrice?: string;
}) {
  const zipVariance = parseInt(options.zip.slice(-2), 10) % 10;
  const adjustedPrices = options.prices.map((price, index) => ({
    ...price,
    adjustedDistanceMiles:
      price.distanceMiles + zipVariance * 0.5 + index * 0.3,
  }));

  const sorted = [...adjustedPrices].sort((left, right) => left.price - right.price);
  const cheapest = sorted[0];
  const mostExpensive = sorted[sorted.length - 1];

  return {
    drug:
      sorted[0]?.displayName ||
      toDisplayName(options.drug.trim().toLowerCase()),
    dosage: options.dosage,
    zipCode: options.zip,
    usedZipCode: true,
    queryTimestamp: new Date().toISOString(),
    protocol: {
      name: "x402",
      network: options.network,
      price: options.protocolPrice ?? "$0.002",
      payTo: options.payTo,
    },
    prices: sorted.map((price) => ({
      pharmacyName: price.pharmacy,
      pharmacyId: price.pharmacyId,
      price: price.price,
      distance: +price.adjustedDistanceMiles.toFixed(1),
      inStock: true,
    })),
    cheapest: {
      pharmacyName: cheapest.pharmacy,
      pharmacyId: cheapest.pharmacyId,
      price: cheapest.price,
      distance: +cheapest.adjustedDistanceMiles.toFixed(1),
    },
    mostExpensive: {
      pharmacyName: mostExpensive.pharmacy,
      pharmacyId: mostExpensive.pharmacyId,
      price: mostExpensive.price,
      distance: +mostExpensive.adjustedDistanceMiles.toFixed(1),
    },
    potentialSavings: +(mostExpensive.price - cheapest.price).toFixed(2),
    savingsPercent: +(
      (1 - cheapest.price / mostExpensive.price) *
      100
    ).toFixed(1),
  };
}
