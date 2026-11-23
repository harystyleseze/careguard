/**
 * Test-only helper for `load/agent-run-rotation.js` (Issue #984).
 *
 * k6 cannot change another process's environment or send it a signal, so this
 * module is preloaded into the *agent process* via Node's --import flag. It
 * exposes a tiny localhost HTTP control surface that performs the same two
 * steps as docs/runbooks/rotate-agent-key.md:
 *
 *   1. update process.env.AGENT_SECRET_KEY (the env update)
 *   2. emit SIGHUP, which shared/x402-signer.ts handles by invalidating the
 *      signer cache so the next x402 payment picks up the new key
 *
 * Start the agent with the hook enabled, e.g.:
 *
 *   LOAD_TEST_ROTATION_HOOK=1 ROTATION_HOOK_PORT=3006 \
 *     node --import ./load/rotation-hook.mjs --import tsx server.ts
 *
 * The hook is inert unless LOAD_TEST_ROTATION_HOOK=1. It is never mounted by
 * the application itself and must not be enabled in production deployments.
 */

import http from "node:http";
import { createHash } from "node:crypto";

const ENABLED = process.env.LOAD_TEST_ROTATION_HOOK === "1";
const PORT = Number(process.env.ROTATION_HOOK_PORT || 3006);
const STELLAR_SECRET_RE = /^S[A-Z2-7]{55}$/;

let keyEpoch = 0;

function fingerprint(key) {
  return createHash("sha256").update(String(key || "")).digest("hex").slice(0, 12);
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 4096) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export function rotationState() {
  return {
    epoch: keyEpoch,
    keyFingerprint: fingerprint(process.env.AGENT_SECRET_KEY),
  };
}

/** Rotate in-process: env update + SIGHUP, exactly as the runbook prescribes. */
export function rotateAgentSecretKey(secretKey) {
  if (!STELLAR_SECRET_RE.test(secretKey || "")) {
    throw new Error("secretKey must be a Stellar secret seed (S + 55 base32 chars)");
  }
  if (secretKey === process.env.AGENT_SECRET_KEY) {
    throw new Error("secretKey matches the active key — nothing to rotate");
  }

  process.env.AGENT_SECRET_KEY = secretKey;
  keyEpoch += 1;
  // process.emit invokes the registered SIGHUP listeners (signer cache reset,
  // bill-audit config reload) without requiring an external PID lookup.
  process.emit("SIGHUP");

  return rotationState();
}

if (ENABLED) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/epoch") {
        json(res, 200, rotationState());
        return;
      }
      if (req.method === "POST" && req.url === "/rotate") {
        const { secretKey } = await readBody(req);
        json(res, 200, rotateAgentSecretKey(secretKey));
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[rotation-hook] listening on 127.0.0.1:${PORT} (epoch ${keyEpoch})`);
  });
}
