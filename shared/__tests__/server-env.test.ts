import { describe, expect, it } from "vitest";
import { portSchema } from "../server-env.ts";

describe("portSchema", () => {
  it.each(["0", 0, "65536", 65536])(
    "rejects invalid PORT value %s",
    (value) => {
      const result = portSchema.safeParse(value);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          "PORT must be between 1 and 65535",
        );
      }
    },
  );

  it("rejects non-numeric PORT values with a clear message", () => {
    const result = portSchema.safeParse("abc");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("PORT must be a number");
    }
  });

  it("rejects fractional PORT values with a clear message", () => {
    const result = portSchema.safeParse("3004.5");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("PORT must be an integer");
    }
  });

  it.each(["1", 1, "80", 80, "3004", 3004, "65535", 65535])(
    "accepts valid PORT value %s",
    (value) => {
      const result = portSchema.safeParse(value);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(Number(value));
      }
    },
  );
});
