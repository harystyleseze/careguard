import { z } from "zod";

export const portSchema = z.coerce
  .number({
    invalid_type_error: "PORT must be a number",
  })
  .int("PORT must be an integer")
  .min(1, "PORT must be between 1 and 65535")
  .max(65535, "PORT must be between 1 and 65535");
