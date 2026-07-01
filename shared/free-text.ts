import { z } from "zod";

export const MAX_FREE_TEXT_LENGTH = 80;
export const MAX_TEXT_LIST_ITEMS = 20;
export const MAX_FREE_TEXT_LIST_LENGTH =
  MAX_TEXT_LIST_ITEMS * MAX_FREE_TEXT_LENGTH + (MAX_TEXT_LIST_ITEMS - 1);

export function freeTextSchema(fieldName: string) {
  return z
    .string({ required_error: `${fieldName} is required` })
    .trim()
    .min(1, `${fieldName} is required`)
    .max(
      MAX_FREE_TEXT_LENGTH,
      `${fieldName} must be at most ${MAX_FREE_TEXT_LENGTH} characters`,
    );
}

export function optionalFreeTextSchema(fieldName: string) {
  return freeTextSchema(fieldName).optional();
}

export const zipCodeSchema = z
  .string({ required_error: "zip is required" })
  .trim()
  .regex(/^\d{5}$/, "zip must be a 5-digit ZIP code");

export function delimitedFreeTextListSchema(
  fieldName: string,
  delimiter = ",",
) {
  return z
    .string({ required_error: `${fieldName} is required` })
    .trim()
    .min(1, `${fieldName} is required`)
    .max(
      MAX_FREE_TEXT_LIST_LENGTH,
      `${fieldName} must be at most ${MAX_FREE_TEXT_LIST_LENGTH} characters`,
    )
    .transform<string[]>((value, ctx) => {
      const entries = value
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (entries.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} must contain at least one value`,
        });
        return z.NEVER;
      }

      if (entries.length > MAX_TEXT_LIST_ITEMS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} must contain at most ${MAX_TEXT_LIST_ITEMS} values`,
        });
        return z.NEVER;
      }

      for (const entry of entries) {
        if (entry.length > MAX_FREE_TEXT_LENGTH) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `each ${fieldName} value must be at most ${MAX_FREE_TEXT_LENGTH} characters`,
          });
          return z.NEVER;
        }
      }

      return entries;
    });
}
