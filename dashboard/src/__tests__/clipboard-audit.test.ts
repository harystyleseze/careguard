import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(process.cwd(), "dashboard", "src");
const ALLOWED_CLIPBOARD_FILE = "lib/clipboard.ts";

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "__tests__") continue;
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("clipboard API usage audit", () => {
  it("keeps direct clipboard APIs inside the shared fallback helper", () => {
    const directClipboardUsers = listSourceFiles(SRC_ROOT)
      .map((file) => ({
        file: relative(SRC_ROOT, file).replace(/\\/g, "/"),
        source: readFileSync(file, "utf8"),
      }))
      .filter(({ file, source }) =>
        file !== ALLOWED_CLIPBOARD_FILE &&
        (/navigator\.clipboard/.test(source) || /document\.execCommand/.test(source)),
      )
      .map(({ file }) => file);

    expect(directClipboardUsers).toEqual([]);
  });
});
