import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(dashboardRoot, "src");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const storageWritePattern =
  /\b(?:localStorage|sessionStorage)\s*\.\s*setItem\b/;
const violations = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) {
      continue;
    }

    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (storageWritePattern.test(line)) {
        violations.push({
          file: path.relative(dashboardRoot, fullPath).replaceAll("\\", "/"),
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }
}

walk(sourceRoot);

if (violations.length > 0) {
  console.error(
    "Dashboard code must not persist data with localStorage/sessionStorage setItem.",
  );
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.text}`);
  }
  console.error("See docs/SECURITY.md for the approved exception process.");
  process.exit(1);
}
