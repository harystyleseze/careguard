import { z } from "zod";
import { freeTextSchema } from "../../shared/free-text.ts";

export const OrderAmountSchema = z
  .union([z.number(), z.string()])
  .transform<number>((value, ctx) => {
    const parsed =
      typeof value === "number" ? value : parseFloat(value);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount must be a valid number",
      });
      return z.NEVER;
    }
    if (parsed < 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount must be at least $0.01",
      });
      return z.NEVER;
    }
    if (parsed > 10000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
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
