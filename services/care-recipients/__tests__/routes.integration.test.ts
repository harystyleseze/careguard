import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { CareRecipientsStore } from "../db.ts";
import { createCareRecipientsRouter } from "../routes.ts";

/**
 * Integration test (Issue #791): exercises the real /recipients GET/POST
 * routes mounted on server.ts (via createCareRecipientsRouter, extracted
 * from server.ts so it's testable without booting the full unified server —
 * that server also wires up Sentry, Stellar, the LLM client, and the agent
 * runtime, none of which /recipients depends on) against a real, isolated
 * CareRecipientsStore.
 */

const CAREGIVER_TOKEN = "test-caregiver-token";

function makeApp() {
  const store = new CareRecipientsStore(":memory:"); // isolated per test, never touches data/careguard.sqlite
  const app = express();
  app.use(express.json());
  app.use(createCareRecipientsRouter(store, CAREGIVER_TOKEN));
  return { app, store };
}

describe("/recipients routes (Issue #791)", () => {
  let app: express.Express;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  it("rejects requests with no caregiver token", async () => {
    const res = await request(app).get("/recipients");
    expect(res.status).toBe(401);
  });

  it("rejects requests with an invalid caregiver token", async () => {
    const res = await request(app)
      .get("/recipients")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(403);
  });

  it("POST /recipients creates a recipient and GET /recipients lists it back", async () => {
    const createRes = await request(app)
      .post("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
      .send({ name: "John Doe", age: 65, medications: ["Aspirin"], primary_doctor: "Dr. Smith", insurance: "Medicare" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe("John Doe");
    expect(createRes.body.id).toMatch(/^john_doe_\d+_[0-9a-f]{8}$/);

    const listRes = await request(app)
      .get("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);

    expect(listRes.status).toBe(200);
    const created = listRes.body.find((r: any) => r.id === createRes.body.id);
    expect(created).toBeDefined();
    expect(created.name).toBe("John Doe");
    expect(created.medications).toEqual(["Aspirin"]);
    expect(created.primary_doctor).toBe("Dr. Smith");
  });

  it("rejects a malformed payload (missing name) with a structured 400", async () => {
    const res = await request(app)
      .post("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
      .send({ age: 40 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("name is required");
  });

  it("rejects a blank name with a structured 400", async () => {
    const res = await request(app)
      .post("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
      .send({ name: "   " });

    expect(res.status).toBe(400);
  });

  it("concurrent creates with the same name each get a distinct, persisted id", async () => {
    const requests = Array.from({ length: 5 }, () =>
      request(app)
        .post("/recipients")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "Concurrent Person" }),
    );

    const results = await Promise.all(requests);
    for (const res of results) {
      expect(res.status).toBe(201);
    }

    const ids = results.map((r) => r.body.id);
    expect(new Set(ids).size).toBe(ids.length); // no id collisions

    const listRes = await request(app)
      .get("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
    const persisted = listRes.body.filter((r: any) => r.name === "Concurrent Person");
    expect(persisted).toHaveLength(5); // every create landed, none overwrote another
  });

  // ── Multi-tenant Data Isolation (#930) ────────────────────────────────────

  it("multi-tenant isolation: caregivers cannot see each other's recipients via list", async () => {
    // Caregiver A creates recipient A
    const resA = await request(app)
      .post("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
      .set("x-caregiver-user-id", "caregiver_alpha")
      .send({ name: "Alpha Patient", age: 70, medications: ["Med A"] });
    expect(resA.status).toBe(201);
    const alphaId = resA.body.id;

    // Caregiver B creates recipient B
    const resB = await request(app)
      .post("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
      .set("x-caregiver-user-id", "caregiver_beta")
      .send({ name: "Beta Patient", age: 75, medications: ["Med B"] });
    expect(resB.status).toBe(201);
    const betaId = resB.body.id;

    // Caregiver A lists recipients -> sees Alpha Patient only
    const listA = await request(app)
      .get("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
      .set("x-caregiver-user-id", "caregiver_alpha");
    expect(listA.status).toBe(200);
    const idsA = listA.body.map((r: any) => r.id);
    expect(idsA).toContain(alphaId);
    expect(idsA).not.toContain(betaId);

    // Caregiver B lists recipients -> sees Beta Patient only
    const listB = await request(app)
      .get("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
      .set("x-caregiver-user-id", "caregiver_beta");
    expect(listB.status).toBe(200);
    const idsB = listB.body.map((r: any) => r.id);
    expect(idsB).toContain(betaId);
    expect(idsB).not.toContain(alphaId);

    // Unscoped admin list sees all recipients (preserves backward compatibility)
    const listAll = await request(app)
      .get("/recipients")
      .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
    expect(listAll.status).toBe(200);
    const allIds = listAll.body.map((r: any) => r.id);
    expect(allIds).toContain(alphaId);
    expect(allIds).toContain(betaId);
  });

  // ── Recipient CRUD Routes (#931) ──────────────────────────────────────────

  describe("GET /recipients/:id (#931)", () => {
    it("returns 200 with recipient details for an existing recipient", async () => {
      const createRes = await request(app)
        .post("/recipients")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "Target Patient", age: 60, medications: ["Metformin"] });
      expect(createRes.status).toBe(201);
      const recipientId = createRes.body.id;

      const getRes = await request(app)
        .get(`/recipients/${recipientId}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(recipientId);
      expect(getRes.body.name).toBe("Target Patient");
      expect(getRes.body.age).toBe(60);
      expect(getRes.body.medications).toEqual(["Metformin"]);
    });

    it("returns 404 for an unknown id", async () => {
      const res = await request(app)
        .get("/recipients/non_existent_id_12345")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Care recipient not found");
    });

    it("enforces caregiver isolation on GET /recipients/:id", async () => {
      const createRes = await request(app)
        .post("/recipients")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .set("x-caregiver-user-id", "caregiver_owner")
        .send({ name: "Private Patient", age: 50 });
      expect(createRes.status).toBe(201);
      const recipientId = createRes.body.id;

      // Accessing with the owner caregiver succeeds
      const ownRes = await request(app)
        .get(`/recipients/${recipientId}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .set("x-caregiver-user-id", "caregiver_owner");
      expect(ownRes.status).toBe(200);

      // Accessing with an unlinked caregiver returns 404 (does not disclose existence)
      const otherRes = await request(app)
        .get(`/recipients/${recipientId}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .set("x-caregiver-user-id", "caregiver_stranger");
      expect(otherRes.status).toBe(404);
    });
  });

  describe("PATCH /recipients/:id and PUT /recipients/:id (#931)", () => {
    it("updates mutable fields with PATCH", async () => {
      const createRes = await request(app)
        .post("/recipients")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "Initial Name", age: 50, medications: ["Aspirin"], primary_doctor: "Dr. Old" });
      const id = createRes.body.id;

      const patchRes = await request(app)
        .patch(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({
          name: "Updated Name",
          age: 51,
          medications: ["Aspirin", "Lisinopril"],
          primary_doctor: "Dr. New",
          insurance: "Aetna",
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.name).toBe("Updated Name");
      expect(patchRes.body.age).toBe(51);
      expect(patchRes.body.medications).toEqual(["Aspirin", "Lisinopril"]);
      expect(patchRes.body.primary_doctor).toBe("Dr. New");
      expect(patchRes.body.insurance).toBe("Aetna");

      // Verify persistence via GET
      const getRes = await request(app)
        .get(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
      expect(getRes.body.name).toBe("Updated Name");
      expect(getRes.body.medications).toEqual(["Aspirin", "Lisinopril"]);
    });

    it("updates mutable fields with PUT", async () => {
      const createRes = await request(app)
        .post("/recipients")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "Put Name", age: 60 });
      const id = createRes.body.id;

      const putRes = await request(app)
        .put(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "Put Updated", age: 61 });

      expect(putRes.status).toBe(200);
      expect(putRes.body.name).toBe("Put Updated");
      expect(putRes.body.age).toBe(61);
    });

    it("rejects invalid input on update (empty name, negative age, invalid medications)", async () => {
      const createRes = await request(app)
        .post("/recipients")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "Validation Target", age: 40 });
      const id = createRes.body.id;

      const emptyNameRes = await request(app)
        .patch(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "   " });
      expect(emptyNameRes.status).toBe(400);

      const negativeAgeRes = await request(app)
        .patch(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ age: -5 });
      expect(negativeAgeRes.status).toBe(400);

      const invalidMedsRes = await request(app)
        .patch(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ medications: "not-an-array" });
      expect(invalidMedsRes.status).toBe(400);
    });

    it("returns 404 when updating an unknown id", async () => {
      const res = await request(app)
        .patch("/recipients/non_existent_id")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "Nobody" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /recipients/:id (#931)", () => {
    it("deletes an existing recipient and returns 200", async () => {
      const createRes = await request(app)
        .post("/recipients")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`)
        .send({ name: "To Be Deleted", age: 80 });
      const id = createRes.body.id;

      const delRes = await request(app)
        .delete(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
      expect(delRes.body.id).toBe(id);

      // Subsequent GET returns 404
      const getRes = await request(app)
        .get(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
      expect(getRes.status).toBe(404);

      // Subsequent DELETE returns 404
      const delAgainRes = await request(app)
        .delete(`/recipients/${id}`)
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
      expect(delAgainRes.status).toBe(404);
    });

    it("returns 404 when deleting an unknown recipient", async () => {
      const res = await request(app)
        .delete("/recipients/unknown_id_9999")
        .set("Authorization", `Bearer ${CAREGIVER_TOKEN}`);
      expect(res.status).toBe(404);
    });
  });
});
