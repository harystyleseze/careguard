import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { canonicalize } from "../shared/audit-log.ts";

const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const AUDIT_FILE = process.env.AUDIT_FILE || `${DATA_DIR}/audit.log.jsonl`;
const jsonOutput = process.argv.includes("--json");

interface VerificationResult {
  ok: boolean;
  errors: string[];
}

function outputResult(result: VerificationResult): void {
  if (jsonOutput) {
    console.log(JSON.stringify(result));
  }
}

function verifyAuditLog(): VerificationResult {
  if (!existsSync(AUDIT_FILE)) {
    const message = `Audit log file not found at: ${AUDIT_FILE}`;
    if (jsonOutput) {
      outputResult({ ok: true, errors: [] });
    } else {
      console.log(message);
    }
    return { ok: true, errors: [] };
  }

  const fileContent = readFileSync(AUDIT_FILE, "utf-8");
  const lines = fileContent.split("\n").filter((line) => line.trim() !== "");

  let prevExpectedHash = "0000000000000000000000000000000000000000000000000000000000000000";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = `Verification Failed: Malformed JSON at line ${i + 1} (index ${i}): ${error instanceof Error ? error.message : String(error)}`;
      if (!jsonOutput) console.error(message);
      const result = { ok: false, errors: [message] };
      outputResult(result);
      return result;
    }

    const { prevHash, hash, ...payload } = parsed;

    if (typeof prevHash !== "string") {
      const message = `Verification Failed at line ${i + 1} (index ${i}): Missing or invalid 'prevHash' field.`;
      if (!jsonOutput) console.error(message);
      const result = { ok: false, errors: [message] };
      outputResult(result);
      return result;
    }

    if (typeof hash !== "string") {
      const message = `Verification Failed at line ${i + 1} (index ${i}): Missing or invalid 'hash' field.`;
      if (!jsonOutput) console.error(message);
      const result = { ok: false, errors: [message] };
      outputResult(result);
      return result;
    }

    // 1. Verify prevHash matches the hash from the previous entry
    if (prevHash !== prevExpectedHash) {
      const messages = [
        `Verification Failed at line ${i + 1} (index ${i}):`,
        `  Expected prevHash: ${prevExpectedHash}`,
        `  Actual prevHash:   ${prevHash}`,
      ];
      if (!jsonOutput) messages.forEach((message) => console.error(message));
      const result = { ok: false, errors: messages };
      outputResult(result);
      return result;
    }

    // 2. Verify current entry hash
    const serializedPayload = canonicalize(payload);
    const hashInput = prevHash + serializedPayload;
    const computedHash = createHash("sha256").update(hashInput).digest("hex");

    if (hash !== computedHash) {
      const messages = [
        `Verification Failed at line ${i + 1} (index ${i}):`,
        `  Expected hash: ${computedHash}`,
        `  Actual hash:   ${hash}`,
      ];
      if (!jsonOutput) messages.forEach((message) => console.error(message));
      const result = { ok: false, errors: messages };
      outputResult(result);
      return result;
    }

    // Update prevExpectedHash for the next iteration
    prevExpectedHash = hash;
  }

  const result = { ok: true, errors: [] };
  if (jsonOutput) {
    outputResult(result);
  } else {
    console.log(`Audit log successfully verified. Total entries: ${lines.length}`);
  }
  return result;
}

const result = verifyAuditLog();
process.exitCode = result.ok ? 0 : 1;
