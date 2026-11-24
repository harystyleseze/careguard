import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ALLOWED_FILES = new Set([
  "shared/wallet-balance.ts",
  "shared/__tests__/wallet-balance.test.ts",
]);

const INLINE_BALANCE_PATTERNS = [
  /\.balances\.find\(/,
  /asset_code\s*===\s*["']USDC["']/,
  /asset_type\s*===\s*["']native["']/,
];

function scanDir(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir);
  for (const file of files) {
    if (file === "node_modules" || file === ".git" || file === "dist") continue;
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath, fileList);
    } else if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function runCheck() {
  const rootDir = process.cwd();
  const allTsFiles = scanDir(rootDir);
  const violations: { file: string; line: number; pattern: string }[] = [];

  for (const file of allTsFiles) {
    const relativePath = file.replace(rootDir + "/", "");
    if (ALLOWED_FILES.has(relativePath)) continue;

    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    lines.forEach((line, index) => {
      for (const pattern of INLINE_BALANCE_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: relativePath,
            line: index + 1,
            pattern: pattern.toString(),
          });
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error("Duplicate inline Horizon balance-fetch code detected:");
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} matched ${v.pattern}`);
    }
    console.error(
      "\nPlease use fetchWalletBalances() from shared/wallet-balance.ts instead of inline Horizon balance queries.",
    );
    process.exit(1);
  }

  console.log("No duplicate inline Horizon balance-fetch code found.");
}

runCheck();
