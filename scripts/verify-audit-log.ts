import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { canonicalize } from "../shared/audit-log.ts";

const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const AUDIT_FILE = process.env.AUDIT_FILE || `${DATA_DIR}/audit.log.jsonl`;

function verifyAuditLog() {
  if (!existsSync(AUDIT_FILE)) {
    console.log(`Audit log file not found at: ${AUDIT_FILE}`);
    process.exit(0);
  }

  const fileContent = readFileSync(AUDIT_FILE, "utf-8");
  const lines = fileContent.split("\n").filter((line) => line.trim() !== "");

  let prevExpectedHash = "0000000000000000000000000000000000000000000000000000000000000000";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (e: any) {
      console.error(`Verification Failed: Malformed JSON at line ${i + 1} (index ${i}): ${e.message}`);
      process.exit(1);
    }

    const { prevHash, hash, ...payload } = parsed;

    if (typeof prevHash !== "string") {
      console.error(`Verification Failed at line ${i + 1} (index ${i}): Missing or invalid 'prevHash' field.`);
      process.exit(1);
    }

    if (typeof hash !== "string") {
      console.error(`Verification Failed at line ${i + 1} (index ${i}): Missing or invalid 'hash' field.`);
      process.exit(1);
    }

    // 1. Verify prevHash matches the hash from the previous entry
    if (prevHash !== prevExpectedHash) {
      console.error(`Verification Failed at line ${i + 1} (index ${i}):`);
      console.error(`  Expected prevHash: ${prevExpectedHash}`);
      console.error(`  Actual prevHash:   ${prevHash}`);
      process.exit(1);
    }

    // 2. Verify current entry hash
    const serializedPayload = canonicalize(payload);
    const hashInput = prevHash + serializedPayload;
    const computedHash = createHash("sha256").update(hashInput).digest("hex");

    if (hash !== computedHash) {
      console.error(`Verification Failed at line ${i + 1} (index ${i}):`);
      console.error(`  Expected hash: ${computedHash}`);
      console.error(`  Actual hash:   ${hash}`);
      process.exit(1);
    }

    // Update prevExpectedHash for the next iteration
    prevExpectedHash = hash;
  }

  console.log(`Audit log successfully verified. Total entries: ${lines.length}`);
  process.exit(0);
}

verifyAuditLog();
