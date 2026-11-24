import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { createCareRecipientsRouter } from "../services/care-recipients/routes.ts";
import { createCareRecipientsStore } from "../services/care-recipients/db.ts";
import { recordDosageChange } from "../shared/medication-history.ts";
import { readAuditLog } from "../shared/audit-log.ts";

const TEST_TOKEN = "test-export-caregiver-token";
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");

describe("Issue #1225: Recipient Data Export for Portability (GDPR Takeout)", () => {
  let app: express.Express;
  let store: ReturnType<typeof createCareRecipientsStore>;
  let recipientId: string;
  let recipientDir: string;

  beforeEach(() => {
    store = createCareRecipientsStore();
    // Create recipient in store
    const created = store.create({
      name: "Test Takeout Patient",
      age: 72,
      medications: ["Lisinopril 10mg", "Metformin 500mg"],
      primary_doctor: "Dr. Chen",
      insurance: "Medicare Part D",
      caregiver_user_id: "INTERNAL_USER_UUID_999", // internal field
    });
    recipientId = created.id;
    recipientDir = join(DATA_DIR, "recipients", recipientId);

    // Setup clean test data directory
    if (existsSync(recipientDir)) {
      rmSync(recipientDir, { recursive: true, force: true });
    }
    mkdirSync(recipientDir, { recursive: true });

    // Seed mock data
    writeFileSync(
      join(recipientDir, "policy.json"),
      JSON.stringify({
        dailyLimit: 75,
        monthlyLimit: 600,
        medicationMonthlyBudget: 250,
        billMonthlyBudget: 350,
        approvalThreshold: 50,
        holdTimeSeconds: 3600,
        timezone: "America/Phoenix",
      }),
    );

    writeFileSync(
      join(recipientDir, "transactions.jsonl"),
      JSON.stringify({
        id: "tx-101",
        timestamp: "2026-10-01T12:00:00Z",
        type: "medication",
        description: "Lisinopril 30-day refill",
        amount: 24.5,
        recipient: recipientId,
        stellarTxHash: "a1b2c3d4e5f6",
        status: "success",
        category: "prescription",
        _internalFileLockToken: "SECRET_LOCK_TOKEN", // should be stripped
      }) + "\n",
    );

    writeFileSync(
      join(recipientDir, "notes.json"),
      JSON.stringify([
        {
          id: "note-1",
          title: "Cardiologist Consultation",
          content: "Reviewed BP readings, advised monitoring morning systolic.",
          createdAt: "2026-10-05T09:30:00Z",
        },
      ]),
    );

    // Record dosage change history
    recordDosageChange(
      {
        medicationName: "Lisinopril 10mg",
        newDosage: "20mg",
        newFrequency: "Once daily morning",
        previousDosage: "10mg",
        previousFrequency: "Once daily",
        reason: "Elevated BP reading",
        prescriber: "Dr. Chen",
      },
      recipientId,
    );

    app = express();
    app.use(express.json());
    app.use(createCareRecipientsRouter(store, TEST_TOKEN));
  });

  it("requires caregiver authentication token", async () => {
    const res = await request(app).get(`/recipients/${recipientId}/export`);
    expect(res.status).toBe(401);
  });

  it("exports a complete, structured bundle of recipient data", async () => {
    const res = await request(app)
      .get(`/recipients/${recipientId}/export`)
      .set("Authorization", `Bearer ${TEST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.headers["content-disposition"]).toContain(`careguard-export-${recipientId}`);

    const bundle = res.body;

    // 1. Export Metadata
    expect(bundle.exportMetadata).toBeDefined();
    expect(bundle.exportMetadata.recipientId).toBe(recipientId);
    expect(bundle.exportMetadata.version).toBe("1.0");

    // 2. Recipient info (internal caregiver_user_id stripped)
    expect(bundle.recipient.id).toBe(recipientId);
    expect(bundle.recipient.name).toBe("Test Takeout Patient");
    expect(bundle.recipient.age).toBe(72);
    expect(bundle.recipient.primaryDoctor).toBe("Dr. Chen");
    expect(bundle.recipient.caregiver_user_id).toBeUndefined();

    // 3. Medications with dosage history
    expect(bundle.medications).toBeInstanceOf(Array);
    const lisinopril = bundle.medications.find((m: any) => m.name.includes("Lisinopril"));
    expect(lisinopril).toBeDefined();
    expect(lisinopril.dosageHistory).toBeInstanceOf(Array);
    expect(lisinopril.dosageHistory.length).toBeGreaterThan(0);
    expect(lisinopril.dosageHistory[0].newDosage).toBe("20mg");
    expect(lisinopril.dosageHistory[0].reason).toBe("Elevated BP reading");

    // 4. Policy limits
    expect(bundle.policy).toBeDefined();
    expect(bundle.policy.dailyLimit).toBe(75);
    expect(bundle.policy.monthlyLimit).toBe(600);

    // 5. Transactions (internal lock token stripped)
    expect(bundle.transactions).toBeInstanceOf(Array);
    expect(bundle.transactions.length).toBe(1);
    expect(bundle.transactions[0].id).toBe("tx-101");
    expect(bundle.transactions[0].amount).toBe(24.5);
    expect(bundle.transactions[0]._internalFileLockToken).toBeUndefined();

    // 6. Recipient notes
    expect(bundle.notes).toBeInstanceOf(Array);
    expect(bundle.notes.length).toBe(1);
    expect(bundle.notes[0].title).toBe("Cardiologist Consultation");
  });

  it("logs the export action to the audit log", async () => {
    await request(app)
      .get(`/recipients/${recipientId}/export`)
      .set("Authorization", `Bearer ${TEST_TOKEN}`);

    const logs = readAuditLog();
    const exportEvent = logs.find(
      (l) => l.event === "recipient.data_exported" && l.details?.recipientId === recipientId,
    );
    expect(exportEvent).toBeDefined();
    expect(exportEvent?.actor).toBe("caregiver");
  });

  it("enforces rate-limiting on repeated takeout requests", async () => {
    // 10 requests allowed within window, 11th triggers 429
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .get(`/recipients/${recipientId}/export`)
        .set("Authorization", `Bearer ${TEST_TOKEN}`);
      expect(res.status).toBe(200);
    }

    const rateLimitedRes = await request(app)
      .get(`/recipients/${recipientId}/export`)
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.body.error).toMatch(/Too many export requests/i);
  });
});
