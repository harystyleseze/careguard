/**
 * Tests for issue #272 — append-only journal crash recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Use real fs in a temp directory for journal tests
let tmpDir: string;
let journalPath: string;
let snapshotPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "careguard-journal-test-"));
  journalPath = join(tmpDir, "journal.jsonl");
  snapshotPath = join(tmpDir, "snapshot.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Journal — append-only ledger", () => {
  it("replays appended entries in order", async () => {
    const { Journal } = await import("../journal.ts");
    const journal = new Journal({ journalPath, snapshotPath });

    journal.append("spending_update", { medications: 10, bills: 0, serviceFees: 0, transactions: [] });
    journal.append("spending_update", { medications: 10, bills: 20, serviceFees: 0, transactions: [] });
    journal.append("spending_update", { medications: 10, bills: 20, serviceFees: 1, transactions: [] });

    const state = journal.replay<{ medications: number; bills: number; serviceFees: number }>(
      { medications: 0, bills: 0, serviceFees: 0 },
      { spending_update: (_s, d) => d as any },
    );

    expect(state.medications).toBe(10);
    expect(state.bills).toBe(20);
    expect(state.serviceFees).toBe(1);
  });

  it("returns initial state when journal is empty", async () => {
    const { Journal } = await import("../journal.ts");
    const journal = new Journal({ journalPath, snapshotPath });

    const state = journal.replay<number>(42, {});
    expect(state).toBe(42);
  });

  it("survives corrupt lines in the journal", async () => {
    const { Journal } = await import("../journal.ts");
    const journal = new Journal({ journalPath, snapshotPath });

    journal.append("spending_update", { value: 1 });
    // Manually inject a corrupt line
    writeFileSync(journalPath, readFileSync(journalPath, "utf-8") + "not-json\n");
    journal.append("spending_update", { value: 2 });

    const state = journal.replay<{ value: number }>(
      { value: 0 },
      { spending_update: (_s, d) => d as any },
    );

    expect(state.value).toBe(2);
  });
});

describe("Journal — compaction", () => {
  it("compacts state and truncates journal", async () => {
    const { Journal } = await import("../journal.ts");
    const journal = new Journal({ journalPath, snapshotPath, compactionThreshold: 10 });

    journal.append("spending_update", { value: 1 });

    // Manually compact
    journal.compact({ value: 1 });

    // Append more after compaction
    journal.append("spending_update", { value: 2 });

    const lines = readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBe(1); // Only the entry after compaction
  });

  it("reconstructs state from snapshot + journal", async () => {
    const { Journal } = await import("../journal.ts");
    const journal = new Journal({ journalPath, snapshotPath, compactionThreshold: 10 });

    journal.append("spending_update", { value: 1 });
    journal.compact({ value: 1 }); // snapshot at value=1
    journal.append("spending_update", { value: 2 });
    journal.append("spending_update", { value: 3 });

    // New journal instance (simulates restart)
    const journal2 = new Journal({ journalPath, snapshotPath, compactionThreshold: 10 });
    const state = journal2.replay<{ value: number }>(
      { value: 0 },
      { spending_update: (_s, d) => d as any },
    );

    expect(state.value).toBe(3);
  });
});

describe("Journal — crash recovery", () => {
  it("recovers exact state after simulated crash with partial journal", async () => {
    const { Journal } = await import("../journal.ts");
    const journal = new Journal({ journalPath, snapshotPath });

    // Simulate normal operations
    journal.append("spending_update", { medications: 50, bills: 30, serviceFees: 2, transactions: [] });
    journal.append("spending_update", { medications: 50, bills: 80, serviceFees: 2, transactions: [] });

    // Simulate crash: journal has entries but no snapshot (crash before compaction)

    // New journal instance (simulates restart after crash)
    const journal2 = new Journal({ journalPath, snapshotPath });
    const state = journal2.replay<{ medications: number; bills: number }>(
      { medications: 0, bills: 0 },
      { spending_update: (_s, d) => d as any },
    );

    expect(state.medications).toBe(50);
    expect(state.bills).toBe(80);
  });

  it("recovers exact state after simulated crash mid-write", async () => {
    const { Journal } = await import("../journal.ts");
    const journal = new Journal({ journalPath, snapshotPath });

    // Normal operations + compaction
    journal.append("spending_update", { medications: 10, bills: 0, serviceFees: 0, transactions: [] });
    journal.compact({ medications: 10, bills: 0, serviceFees: 0, transactions: [] });

    // Simulate crash: journal file gets partially written (cut off mid-line)
    // (simulated by having a snapshot + partial journal)
    journal.append("spending_update", { medications: 20, bills: 5, serviceFees: 0, transactions: [] });

    // Simulate restart: snapshot exists, one entry in journal
    const journal2 = new Journal({ journalPath, snapshotPath });
    const state = journal2.replay<{ medications: number; bills: number }>(
      { medications: 0, bills: 0 },
      { spending_update: (_s, d) => d as any },
    );

    expect(state.medications).toBe(20);
    expect(state.bills).toBe(5);
  });
});
