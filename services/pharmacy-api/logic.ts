import { z } from "zod";
import {
  freeTextSchema,
  optionalFreeTextSchema,
  zipCodeSchema,
} from "../../shared/free-text.ts";
import { logger } from "../../shared/logger.ts";
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
  distance: z.number().nonnegative().nullable(),
  inStock: z.boolean(),
});

export const NoPricesFoundResponseSchema = z.object({
  error: z.string(),
  code: z.literal("NOT_FOUND_DRUG"),
});
export type NoPricesFoundResponse = z.infer<typeof NoPricesFoundResponseSchema>;

export function buildNoPricesFoundResponse(drug: string): NoPricesFoundResponse {
  return NoPricesFoundResponseSchema.parse({
    error: `No pricing records found for drug: ${drug}`,
    code: "NOT_FOUND_DRUG",
  });
}

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
    distance: z.number().nonnegative().nullable(),
  }),
  mostExpensive: z.object({
    pharmacyName: z.string(),
    pharmacyId: z.string(),
    price: z.number().positive(),
    distance: z.number().nonnegative().nullable(),
  }),
  potentialSavings: z.number().nonnegative(),
  savingsPercent: z.number().nonnegative(),
});
export type PharmacyCompareResponse = z.infer<typeof PharmacyCompareResponseSchema>;

type PharmacyComparePrice = {
  displayName?: unknown;
  pharmacy?: unknown;
  pharmacyName?: unknown;
  pharmacyId?: unknown;
  id?: unknown;
  price?: unknown;
  distanceMiles?: unknown;
  distance?: unknown;
};

export function buildCompareResponse(options: {
  drug: string;
  dosage: string;
  zip: string;
  usedZipCode?: string;
  isFallbackZip?: boolean;
  payTo: string;
  network: string;
  prices: PharmacyComparePrice[];
  protocolPrice?: string;
}): PharmacyCompareResponse {
  if (options.prices.length === 0) {
    throw new Error("Cannot build a pharmacy comparison without prices");
  }

  const usedZipCode = options.usedZipCode ?? options.zip;
  const isFallbackZip = options.isFallbackZip ?? (usedZipCode !== options.zip);

  const formattedPrices = options.prices.map((p) => {
    const distance = normalizeDistance(p);

    return {
      pharmacyName: p.pharmacy || p.pharmacyName,
      pharmacyId: p.pharmacyId || p.id,
      price: Number(p.price),
      distance: distance === null ? null : +distance.toFixed(1),
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

function normalizeDistance(price: {
  pharmacyId?: unknown;
  id?: unknown;
  distanceMiles?: unknown;
  distance?: unknown;
}): number | null {
  for (const value of [price.distanceMiles, price.distance]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }

    if (typeof value === "string") {
      const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*(?:mi)?\s*$/i);
      if (match) {
        const distance = Number(match[1]);
        if (Number.isFinite(distance)) return distance;
      }
    }
  }

  logger.warn(
    {
      pharmacyId: price.pharmacyId ?? price.id,
      distanceMiles: price.distanceMiles,
      distance: price.distance,
    },
    "Unable to normalize pharmacy distance; returning null",
  );
  return null;
}
