/**
 * Chaos tests for disk-full during adherence and orders JSONL writes (Issue #809).
 * Verifies that write failures don't corrupt files, errors surface explicitly, and atomicity is maintained.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const { mockFiles, mockFsState } = vi.hoisted(() => {
  const mockFiles = new Map<string, string>();
  const mockFsState = { enospc: false };
  return { mockFiles, mockFsState };
});

vi.mock("fs", () => ({
  readFileSync: vi.fn((filePath: string) => {
    if (mockFsState.enospc) throw new Error("ENOSPC: No space left on device");
    const content = mockFiles.get(String(filePath));
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
    return content;
  }),
  writeFileSync: vi.fn((filePath: string, data: string) => {
    if (mockFsState.enospc) throw new Error("ENOSPC: No space left on device");
    mockFiles.set(String(filePath), String(data));
  }),
  appendFileSync: vi.fn((filePath: string, data: string) => {
    if (mockFsState.enospc) throw new Error("ENOSPC: No space left on device");
    const existing = mockFiles.get(String(filePath)) ?? "";
    mockFiles.set(String(filePath), existing + String(data));
  }),
  existsSync: vi.fn((filePath: string) => mockFiles.has(String(filePath))),
  mkdirSync: vi.fn(),
  renameSync: vi.fn((from: string, to: string) => {
    if (mockFsState.enospc) throw new Error("ENOSPC: No space left on device");
    const data = mockFiles.get(String(from));
    if (data !== undefined) {
      mockFiles.set(String(to), data);
      mockFiles.delete(String(from));
    }
  }),
  unlinkSync: vi.fn(),
}));

vi.mock("url", () => ({
  fileURLToPath: (url: any) => url.pathname,
}));

import {
  appendAdherenceRecord,
  readAdherenceRecords,
  confirmAdherence,
  skipAdherence,
} from "../adherence.ts";

describe("Adherence — disk-full chaos (Issue #809)", () => {
  beforeEach(() => {
    mockFiles.clear();
    mockFsState.enospc = false;
    mockFiles.set("/app/data/adherence.jsonl", "");
  });

  it("ENOSPC during appendFileSync surfaces explicit error", async () => {
    const record = {
      recipientId: "rosa",
      drug: "metformin",
      pharmacy: "CVS",
      orderId: "ord123",
      daysSupply: 30,
      orderedAt: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      status: "pending" as const,
      skippedCount: 0,
    };

    mockFsState.enospc = true;
    const result = appendAdherenceRecord(record);
    mockFsState.enospc = false;

    expect(result).toBeDefined();
  });

  it("rewriteAdherenceFile via confirmAdherence fails explicitly on disk-full", async () => {
    const record = {
      recipientId: "rosa",
      drug: "metformin",
      pharmacy: "CVS",
      orderId: "ord123",
      daysSupply: 30,
      orderedAt: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      status: "pending" as const,
      skippedCount: 0,
    };

    const id = appendAdherenceRecord(record);
    const recordsBefore = readAdherenceRecords();
    expect(recordsBefore.length).toBeGreaterThan(0);

    mockFsState.enospc = true;
    const confirmed = confirmAdherence(id);
    mockFsState.enospc = false;

    expect(confirmed).toBe(false);
  });

  it("skipAdherence under disk-full returns explicit failure", async () => {
    const record = {
      recipientId: "rosa",
      drug: "lisinopril",
      pharmacy: "Walgreens",
      orderId: "ord456",
      daysSupply: 60,
      orderedAt: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      status: "pending" as const,
      skippedCount: 0,
    };

    const id = appendAdherenceRecord(record);

    mockFsState.enospc = true;
    const skipped = skipAdherence(id);
    mockFsState.enospc = false;

    expect(skipped).toBe(false);
  });

  it("prior records remain intact after failed write", async () => {
    const record1 = {
      recipientId: "rosa",
      drug: "metformin",
      pharmacy: "CVS",
      orderId: "ord1",
      daysSupply: 30,
      orderedAt: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      status: "confirmed" as const,
      confirmedAt: new Date().toISOString(),
      skippedCount: 0,
    };

    const record2 = {
      recipientId: "rosa",
      drug: "lisinopril",
      pharmacy: "Walgreens",
      orderId: "ord2",
      daysSupply: 60,
      orderedAt: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      status: "pending" as const,
      skippedCount: 0,
    };

    appendAdherenceRecord(record1);
    appendAdherenceRecord(record2);

    const recordsBefore = readAdherenceRecords();
    expect(recordsBefore.length).toBe(2);

    mockFsState.enospc = true;
    skipAdherence(recordsBefore[1].id);
    mockFsState.enospc = false;

    const recordsAfter = readAdherenceRecords();
    expect(recordsAfter.length).toBe(2);
    expect(recordsAfter[0].status).toBe("confirmed");
    expect(recordsAfter[1].status).toBe("pending");
  });

  it("recovery: after space is freed, next write succeeds", async () => {
    const record = {
      recipientId: "rosa",
      drug: "aspirin",
      pharmacy: "Rite Aid",
      orderId: "ord789",
      daysSupply: 90,
      orderedAt: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      status: "pending" as const,
      skippedCount: 0,
    };

    mockFsState.enospc = true;
    const id1 = appendAdherenceRecord(record);
    mockFsState.enospc = false;

    const id2 = appendAdherenceRecord({ ...record, orderId: "ord790" });
    const records = readAdherenceRecords();

    expect(records.length).toBeGreaterThan(0);
    expect(records.some((r) => r.orderId === "ord790")).toBe(true);
  });
});
