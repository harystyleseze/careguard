import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function collectAgentSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return entry === "__tests__" ? [] : collectAgentSources(path);
    }
    return /\.(ts|tsx|js|mjs|cjs)$/.test(entry) ? [path] : [];
  });
}

describe("agent console logging guard", () => {
  it("keeps agent runtime code on the structured logger", () => {
    const offenders = collectAgentSources("agent").filter((path) =>
      /\bconsole\./.test(readFileSync(path, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
