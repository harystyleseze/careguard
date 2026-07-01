import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { execSync } from "child_process";
import { appendAuditEntry, canonicalize, getLastLine } from "../audit-log.ts";

const TEST_DIR = fileURLToPath(new URL("./test-data-audit", import.meta.url));
const TEST_FILE = `${TEST_DIR}/audit.log.jsonl`;

describe("Audit Log Cryptographic Chaining", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    // Override the process.env.DATA_DIR so audit-log writes to our test directory
    process.env.DATA_DIR = TEST_DIR;
    // Remove if exists
    if (existsSync(TEST_FILE)) {
      unlinkSync(TEST_FILE);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) {
      unlinkSync(TEST_FILE);
    }
    if (existsSync(TEST_DIR)) {
      rmdirSync(TEST_DIR);
    }
  });

  describe("canonicalize", () => {
    it("serializes objects deterministically regardless of key order", () => {
      const obj1 = { z: 1, a: "hello", m: [1, 2, 3] };
      const obj2 = { a: "hello", m: [1, 2, 3], z: 1 };
      expect(canonicalize(obj1)).toBe(canonicalize(obj2));
    });

    it("handles nested objects and arrays", () => {
      const obj = { b: { y: 2, x: 1 }, a: [null, { d: 4, c: 3 }] };
      const expected = '{"a":[null,{"c":3,"d":4}],"b":{"x":1,"y":2}}';
      expect(canonicalize(obj)).toBe(expected);
    });
  });

  describe("getLastLine", () => {
    it("returns null for empty file", () => {
      writeFileSync(TEST_FILE, "");
      expect(getLastLine(TEST_FILE)).toBe(null);
    });

    it("returns the line for a single-line file with no trailing newline", () => {
      writeFileSync(TEST_FILE, "line1");
      expect(getLastLine(TEST_FILE)).toBe("line1");
    });

    it("returns the line for a single-line file with a trailing newline", () => {
      writeFileSync(TEST_FILE, "line1\n");
      expect(getLastLine(TEST_FILE)).toBe("line1");
    });

    it("returns the last line for a multi-line file", () => {
      writeFileSync(TEST_FILE, "line1\nline2\nline3\n");
      expect(getLastLine(TEST_FILE)).toBe("line3");
    });

    it("handles long lines correctly", () => {
      const longLine = "a".repeat(2000);
      writeFileSync(TEST_FILE, `line1\n${longLine}\n`);
      expect(getLastLine(TEST_FILE)).toBe(longLine);
    });
  });

  describe("appendAuditEntry", () => {
    it("creates a valid cryptographic hash chain starting with genesis entry", () => {
      appendAuditEntry({ event: "event.genesis", actor: "test-actor", details: { foo: "bar" } });
      appendAuditEntry({ event: "event.second", actor: "test-actor-2" });

      const fileContent = readFileSync(TEST_FILE, "utf-8").trim();
      const lines = fileContent.split("\n");
      expect(lines).toHaveLength(2);

      const parsed1 = JSON.parse(lines[0]);
      const parsed2 = JSON.parse(lines[1]);

      // Genesis prevHash should be 64 zeros
      expect(parsed1.prevHash).toBe("0000000000000000000000000000000000000000000000000000000000000000");

      // Verify first hash
      const payload1 = {
        timestamp: parsed1.timestamp,
        event: "event.genesis",
        actor: "test-actor",
        details: { foo: "bar" },
      };
      const expectedHash1 = createHash("sha256")
        .update(parsed1.prevHash + canonicalize(payload1))
        .digest("hex");
      expect(parsed1.hash).toBe(expectedHash1);

      // Verify second prevHash matches first hash
      expect(parsed2.prevHash).toBe(parsed1.hash);

      // Verify second hash
      const payload2 = {
        timestamp: parsed2.timestamp,
        event: "event.second",
        actor: "test-actor-2",
      };
      const expectedHash2 = createHash("sha256")
        .update(parsed2.prevHash + canonicalize(payload2))
        .digest("hex");
      expect(parsed2.hash).toBe(expectedHash2);
    });
  });

  describe("scripts/verify-audit-log.ts", () => {
    it("succeeds when audit log has a valid hash chain", () => {
      appendAuditEntry({ event: "event.one", actor: "actor1" });
      appendAuditEntry({ event: "event.two", actor: "actor2" });

      const output = execSync("npx tsx scripts/verify-audit-log.ts", {
        env: { ...process.env, DATA_DIR: TEST_DIR },
        encoding: "utf-8",
      });
      expect(output).toContain("Audit log successfully verified. Total entries: 2");
    });

    it("fails when an entry is tampered with (payload modification)", () => {
      appendAuditEntry({ event: "event.one", actor: "actor1" });
      appendAuditEntry({ event: "event.two", actor: "actor2" });

      const content = readFileSync(TEST_FILE, "utf-8").trim().split("\n");
      const parsed = JSON.parse(content[1]);
      parsed.event = "event.tampered"; // Tamper
      content[1] = JSON.stringify(parsed);
      writeFileSync(TEST_FILE, content.join("\n") + "\n", "utf-8");

      expect(() => {
        execSync("npx tsx scripts/verify-audit-log.ts", {
          env: { ...process.env, DATA_DIR: TEST_DIR },
          stdio: "pipe",
        });
      }).toThrow();
    });

    it("fails when an entry hash is modified", () => {
      appendAuditEntry({ event: "event.one", actor: "actor1" });

      const content = readFileSync(TEST_FILE, "utf-8").trim().split("\n");
      const parsed = JSON.parse(content[0]);
      parsed.hash = "1111111111111111111111111111111111111111111111111111111111111111"; // Tamper hash
      content[0] = JSON.stringify(parsed);
      writeFileSync(TEST_FILE, content.join("\n") + "\n", "utf-8");

      expect(() => {
        execSync("npx tsx scripts/verify-audit-log.ts", {
          env: { ...process.env, DATA_DIR: TEST_DIR },
          stdio: "pipe",
        });
      }).toThrow();
    });
  });
});
