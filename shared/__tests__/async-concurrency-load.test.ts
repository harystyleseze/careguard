import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { appendAuditEntry, verifyAuditLog } from "../audit-log.ts";
import {
  appendAdherenceRecord,
  readAdherenceRecords,
  confirmAdherence,
  getAdherenceSummary,
} from "../adherence.ts";
import { saveAgentState, loadAgentState } from "../../agent/server.ts";

describe("Async Concurrency & Non-blocking I/O Load Tests (#1011, #1012, #1013)", () => {
  let tempDir: string;
  let prevAuditFile: string | undefined;
  let prevAdherenceFile: string | undefined;
  let prevAgentStateFile: string | undefined;
  let prevDataDir: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "careguard-concurrency-test-"));
    prevAuditFile = process.env.AUDIT_LOG_FILE;
    prevAdherenceFile = process.env.ADHERENCE_LOG_FILE;
    prevAgentStateFile = process.env.AGENT_STATE_FILE;
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;
  });

  afterEach(async () => {
    if (prevAuditFile !== undefined) process.env.AUDIT_LOG_FILE = prevAuditFile;
    else delete process.env.AUDIT_LOG_FILE;

    if (prevAdherenceFile !== undefined) process.env.ADHERENCE_LOG_FILE = prevAdherenceFile;
    else delete process.env.ADHERENCE_LOG_FILE;

    if (prevAgentStateFile !== undefined) process.env.AGENT_STATE_FILE = prevAgentStateFile;
    else delete process.env.AGENT_STATE_FILE;

    if (prevDataDir !== undefined) process.env.DATA_DIR = prevDataDir;
    else delete process.env.DATA_DIR;

    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Issue #1011: Async appendAuditEntry hash-chain & concurrency", () => {
    it("maintains strict hash-chain integrity across concurrent appendAuditEntry calls", async () => {
      const testAuditFile = path.join(tempDir, "audit.log");
      process.env.AUDIT_LOG_FILE = testAuditFile;

      const TOTAL_CONCURRENT = 5;
      const tasks = Array.from({ length: TOTAL_CONCURRENT }, (_, i) =>
        appendAuditEntry({
          event: "test_concurrent_event",
          actor: `agent-${i}`,
          details: { index: i, timestamp: Date.now() },
        })
      );

      // Measure event loop lag while writes are taking place
      let timerFired = false;
      setTimeout(() => {
        timerFired = true;
      }, 10);

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(TOTAL_CONCURRENT);
      expect(timerFired).toBe(true);

      // Read file lines
      const content = await fs.readFile(testAuditFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(TOTAL_CONCURRENT);

      // Cryptographic verification of audit log chain
      const verification = verifyAuditLog(testAuditFile);
      expect(verification.valid).toBe(true);
      expect(verification.entries).toBe(TOTAL_CONCURRENT);
      expect(verification.corruptedLine).toBeUndefined();
    }, 20000);
  });

  describe("Issue #1012: Async adherence log read & rewrite concurrency", () => {
    it("safely appends, confirms, and reads adherence records concurrently", async () => {
      const testAdherenceFile = path.join(tempDir, "adherence.jsonl");
      process.env.ADHERENCE_LOG_FILE = testAdherenceFile;

      // Seed 5 records
      const seedTasks = Array.from({ length: 5 }, (_, i) =>
        appendAdherenceRecord({
          recipientId: "rosa",
          drug: `Medication-${i}`,
          pharmacy: "CVS",
          orderId: `order-${i}`,
          daysSupply: 30,
          orderedAt: new Date().toISOString(),
          dueDate: new Date(Date.now() + i * 1000).toISOString(),
          status: "pending",
          skippedCount: 0,
        })
      );
      const ids = await Promise.all(seedTasks);

      const records = await readAdherenceRecords();
      expect(records.length).toBe(5);

      // Concurrently confirm 3 of the reminders while reading summary
      const confirmTasks = [
        confirmAdherence(ids[0]),
        confirmAdherence(ids[1]),
        confirmAdherence(ids[2]),
        getAdherenceSummary("rosa"),
      ];
      await Promise.all(confirmTasks);

      const finalRecords = await readAdherenceRecords();
      expect(finalRecords.length).toBe(5);
      const confirmed = finalRecords.filter((r) => r.status === "confirmed");
      expect(confirmed.length).toBe(3);
    }, 15000);
  });

  describe("Issue #1013: Async agent state persistence with atomic tmp+rename", () => {
    it("handles concurrent pause/resume agent state persistence without file corruption", async () => {
      const testStateFile = path.join(tempDir, "agent-state.json");
      process.env.AGENT_STATE_FILE = testStateFile;

      // Save initial state
      await saveAgentState({ paused: false });

      // Run concurrent save and load operations
      const operations = [
        saveAgentState({ paused: true }),
        loadAgentState(),
        saveAgentState({ paused: false }),
        loadAgentState(),
        saveAgentState({ paused: true }),
      ];

      await Promise.all(operations);

      const finalState = await loadAgentState();
      expect(typeof finalState.paused).toBe("boolean");

      // Verify file contains valid JSON
      const raw = await fs.readFile(testStateFile, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveProperty("paused");
    }, 15000);
  });
});
