import { readdirSync, rmSync, statSync } from "fs";
import path from "path";

function argValue(name: string, fallback: string) {
  const prefix = `--${name}=`;
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    fallback
  );
}

const root = path.resolve(argValue("root", "data"));
const olderThanMinutes = Number(argValue("older-than-minutes", "30"));
const dryRun = !process.argv.includes("--yes");
const cutoff = Date.now() - olderThanMinutes * 60_000;

function walk(dir: string): string[] {
  let entries: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, name.name);
    if (name.isDirectory()) {
      entries.push(fullPath, ...walk(fullPath));
    }
  }
  return entries;
}

const candidates = walk(root).filter((entry) => entry.endsWith(".lock"));
const stale = candidates.filter((entry) => statSync(entry).mtimeMs < cutoff);

for (const entry of stale) {
  console.log(`${dryRun ? "would remove" : "removing"} ${entry}`);
  if (!dryRun) {
    rmSync(entry, { recursive: true, force: true });
  }
}

if (stale.length === 0) {
  console.log(`No stale proper-lockfile locks older than ${olderThanMinutes} minutes under ${root}`);
} else if (dryRun) {
  console.log("Dry run only. Re-run with --yes to remove these stale lock directories.");
}
