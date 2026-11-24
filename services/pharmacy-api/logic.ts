import { z } from "zod";
import {
  freeTextSchema,
  optionalFreeTextSchema,
  zipCodeSchema,
} from "../../shared/free-text.ts";
import { DEFAULT_ZIP_CODE } from "../../shared/pharmacy-pricing.ts";
import { toDisplayName } from "./db.ts";

export const PharmacyCompareQuerySchema = z
  .object({
    drug: freeTextSchema("drug"),
    dosage: optionalFreeTextSchema("dosage"),
    zip: zipCodeSchema.optional().default(DEFAULT_ZIP_CODE),
    recipient: optionalFreeTextSchema("recipient"),
    recipient_id: optionalFreeTextSchema("recipient_id"),
    recipientId: optionalFreeTextSchema("recipientId"),
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

export const PharmacyPriceItemSchema = z.object({
  pharmacyName: z.string(),
  pharmacyId: z.string(),
  price: z.number().positive(),
  distance: z.number().nonnegative(),
  inStock: z.boolean(),
});

export const PharmacyCompareResponseSchema = z.object({
  drug: z.string(),
  dosage: z.string(),
  zipCode: z.string(),
  usedZipCode: z.string(),
  isFallbackZip: z.boolean(),
  queryTimestamp: z.string(),
  protocol: z.object({
    name: z.string(),
    network: z.string(),
    price: z.string(),
    payTo: z.string(),
  }),
  prices: z.array(PharmacyPriceItemSchema),
  cheapest: z.object({
    pharmacyName: z.string(),
    pharmacyId: z.string(),
    price: z.number().positive(),
    distance: z.number().nonnegative(),
  }),
  mostExpensive: z.object({
    pharmacyName: z.string(),
    pharmacyId: z.string(),
    price: z.number().positive(),
    distance: z.number().nonnegative(),
  }),
  potentialSavings: z.number().nonnegative(),
  savingsPercent: z.number().nonnegative(),
});
export type PharmacyCompareResponse = z.infer<typeof PharmacyCompareResponseSchema>;

export function buildCompareResponse(options: {
  drug: string;
  dosage: string;
  zip: string;
  usedZipCode?: string;
  isFallbackZip?: boolean;
  payTo: string;
  network: string;
  prices: any[];
  protocolPrice?: string;
}): PharmacyCompareResponse {
  if (!options.prices || options.prices.length === 0) {
    return { ok: false, reason: "NO_PRICES_FOUND" } as any;
  }

  const usedZipCode = options.usedZipCode ?? options.zip;
  const isFallbackZip = options.isFallbackZip ?? (usedZipCode !== options.zip);

  const formattedPrices = options.prices.map((p) => {
    const distNum = typeof p.distanceMiles === "number"
      ? p.distanceMiles
      : typeof p.distance === "number"
        ? p.distance
        : parseFloat(String(p.distance || "0").replace(" mi", "")) || 0;

    return {
      pharmacyName: p.pharmacy || p.pharmacyName,
      pharmacyId: p.pharmacyId || p.id,
      price: Number(p.price),
      distance: +distNum.toFixed(1),
      inStock: true,
    };
  });

  const sorted = [...formattedPrices].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0];
  const mostExpensive = sorted[sorted.length - 1];

  const response = {
    drug: options.prices[0]?.displayName || toDisplayName(options.drug.trim().toLowerCase()),
    dosage: options.dosage,
    zipCode: options.zip,
    usedZipCode,
    isFallbackZip,
    queryTimestamp: new Date().toISOString(),
    protocol: {
      name: "x402",
      network: options.network,
      price: options.protocolPrice ?? "$0.002",
      payTo: options.payTo,
    },
    prices: sorted,
    cheapest: {
      pharmacyName: cheapest.pharmacyName,
      pharmacyId: cheapest.pharmacyId,
      price: cheapest.price,
      distance: cheapest.distance,
    },
    mostExpensive: {
      pharmacyName: mostExpensive.pharmacyName,
      pharmacyId: mostExpensive.pharmacyId,
      price: mostExpensive.price,
      distance: mostExpensive.distance,
    },
    potentialSavings: +(mostExpensive.price - cheapest.price).toFixed(2),
    savingsPercent: +( (1 - cheapest.price / mostExpensive.price) * 100 ).toFixed(1),
  };

  return PharmacyCompareResponseSchema.parse(response);
}
