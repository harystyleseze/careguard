import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { CareRecipientsStore, DEFAULT_RECIPIENT_ID, HANDOFF_NOTE_MAX_LENGTH } from "../db.ts";
import { createCareRecipientsRouter } from "../routes.ts";

/**
 * Role-based caregiver access (#1179) and shift handoff notes (#1180),
 * exercised through the real router against an isolated in-memory store.
 */

const CAREGIVER_TOKEN = "test-caregiver-token";
const ROSA = DEFAULT_RECIPIENT_ID;

let app: express.Express;
let store: CareRecipientsStore;

beforeEach(() => {
  store = new CareRecipientsStore(":memory:");
  app = express();
  app.use(express.json());
  app.use(createCareRecipientsRouter(store, CAREGIVER_TOKEN));
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const admin = bearer(CAREGIVER_TOKEN);

/** Invites and accepts a caregiver through the HTTP flow; returns their auth header. */
async function linkCaregiver(email: string, role: string, displayName?: string) {
  const invite = await request(app)
    .post(`/recipients/${ROSA}/caregivers/invites`)
    .set(admin)
    .send({ email, role });
  expect(invite.status).toBe(201);
  const accept = await request(app)
    .post("/caregiver-invites/accept")
    .send({ token: invite.body.inviteToken, display_name: displayName });
  expect(accept.status).toBe(200);
  return bearer(accept.body.accessToken);
}

describe("caregiver invites (#1179)", () => {
  it("invites by email, then lists the caregiver as pending and then active", async () => {
    const invite = await request(app)
      .post(`/recipients/${ROSA}/caregivers/invites`)
      .set(admin)
      .send({ email: "david@example.com", role: "co-caregiver" });

    expect(invite.status).toBe(201);
    expect(invite.body.inviteToken).toEqual(expect.any(String));
    expect(invite.body.caregiver).toMatchObject({ email: "david@example.com", role: "co-caregiver", status: "invited" });

    const accept = await request(app)
      .post("/caregiver-invites/accept")
      .send({ token: invite.body.inviteToken, display_name: "David Garcia" });
    expect(accept.status).toBe(200);
    expect(accept.body.accessToken).toEqual(expect.any(String));

    const list = await request(app).get(`/recipients/${ROSA}/caregivers`).set(admin);
    expect(list.status).toBe(200);
    expect(list.body.caregivers).toEqual([
      expect.objectContaining({ email: "david@example.com", display_name: "David Garcia", status: "active" }),
    ]);
  });

  it("validates the invite body", async () => {
    const res = await request(app)
      .post(`/recipients/${ROSA}/caregivers/invites`)
      .set(admin)
      .send({ email: "not-an-email", role: "superuser" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when inviting an already active caregiver", async () => {
    await linkCaregiver("david@example.com", "viewer");
    const res = await request(app)
      .post(`/recipients/${ROSA}/caregivers/invites`)
      .set(admin)
      .send({ email: "david@example.com", role: "viewer" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("already_linked");
  });

  it("rejects unknown and reused invite codes", async () => {
    expect((await request(app).post("/caregiver-invites/accept").send({ token: "bogus" })).status).toBe(404);

    const invite = await request(app)
      .post(`/recipients/${ROSA}/caregivers/invites`)
      .set(admin)
      .send({ email: "david@example.com", role: "viewer" });
    await request(app).post("/caregiver-invites/accept").send({ token: invite.body.inviteToken });
    const reuse = await request(app).post("/caregiver-invites/accept").send({ token: invite.body.inviteToken });
    expect(reuse.status).toBe(404);
  });
});

describe("role-based authorization (#1179)", () => {
  it("scopes a caregiver to their linked recipient", async () => {
    const other = store.create({ name: "Other Person", age: null, medications: [], primary_doctor: null, insurance: null });
    const david = await linkCaregiver("david@example.com", "co-caregiver");

    const list = await request(app).get("/recipients").set(david);
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([ROSA]);

    expect((await request(app).get(`/recipients/${other.id}/handoff-notes`).set(david)).status).toBe(404);
  });

  it("only the operator token can create recipients", async () => {
    const owner = await linkCaregiver("maria@example.com", "owner");
    const res = await request(app).post("/recipients").set(owner).send({ name: "New Person" });
    expect(res.status).toBe(403);
  });

  it("owners manage caregivers; co-caregivers and viewers cannot", async () => {
    const owner = await linkCaregiver("maria@example.com", "owner");
    const coCaregiver = await linkCaregiver("david@example.com", "co-caregiver");
    const viewer = await linkCaregiver("aide@example.com", "viewer");
    const body = { email: "new@example.com", role: "viewer" };

    expect((await request(app).post(`/recipients/${ROSA}/caregivers/invites`).set(coCaregiver).send(body)).status).toBe(403);
    expect((await request(app).post(`/recipients/${ROSA}/caregivers/invites`).set(viewer).send(body)).status).toBe(403);
    expect((await request(app).post(`/recipients/${ROSA}/caregivers/invites`).set(owner).send(body)).status).toBe(201);

    // Every role can see who is linked.
    expect((await request(app).get(`/recipients/${ROSA}/caregivers`).set(viewer)).status).toBe(200);
  });

  it("removing a caregiver revokes access; the last owner cannot be removed", async () => {
    const owner = await linkCaregiver("maria@example.com", "owner");
    const david = await linkCaregiver("david@example.com", "co-caregiver");

    const removed = await request(app).delete(`/recipients/${ROSA}/caregivers/david@example.com`).set(owner);
    expect(removed.status).toBe(204);
    expect((await request(app).get("/recipients").set(david)).status).toBe(403);

    const lastOwner = await request(app).delete(`/recipients/${ROSA}/caregivers/maria@example.com`).set(owner);
    expect(lastOwner.status).toBe(409);
    expect(lastOwner.body.code).toBe("last_owner");

    expect((await request(app).delete(`/recipients/${ROSA}/caregivers/nobody@example.com`).set(admin)).status).toBe(404);
  });
});

describe("handoff notes routes (#1180)", () => {
  it("co-caregivers post notes attributed to their own identity, not the request body", async () => {
    const david = await linkCaregiver("david@example.com", "co-caregiver", "David Garcia");

    const res = await request(app)
      .post(`/recipients/${ROSA}/handoff-notes`)
      .set(david)
      .send({ text: "Gave the 2pm dose late, watch for nausea.", author: "Someone Else" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      recipient_id: ROSA,
      author: "David Garcia",
      text: "Gave the 2pm dose late, watch for nausea.",
    });
  });

  it("viewers can read notes but not post them", async () => {
    store.addHandoffNote({ recipient_id: ROSA, author: "Maria", text: "Slept well." });
    const viewer = await linkCaregiver("aide@example.com", "viewer");

    const read = await request(app).get(`/recipients/${ROSA}/handoff-notes`).set(viewer);
    expect(read.status).toBe(200);
    expect(read.body.notes.map((n: { text: string }) => n.text)).toEqual(["Slept well."]);

    const write = await request(app).post(`/recipients/${ROSA}/handoff-notes`).set(viewer).send({ text: "Hi" });
    expect(write.status).toBe(403);
  });

  it("sanitizes note text like other free text and keeps punctuation", async () => {
    const res = await request(app)
      .post(`/recipients/${ROSA}/handoff-notes`)
      .set(admin)
      .send({ text: "  Dose\u0000 late,\n\twatch ‮for nausea!  ", author: "Maria Garcia" });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe("Dose late, watch for nausea!");
    expect(res.body.author).toBe("Maria Garcia");
  });

  it("rejects empty and oversized notes", async () => {
    const blank = await request(app).post(`/recipients/${ROSA}/handoff-notes`).set(admin).send({ text: " \u0000 " });
    expect(blank.status).toBe(400);

    const tooLong = await request(app)
      .post(`/recipients/${ROSA}/handoff-notes`)
      .set(admin)
      .send({ text: "x".repeat(HANDOFF_NOTE_MAX_LENGTH + 1) });
    expect(tooLong.status).toBe(400);
  });

  it("lists notes newest first with a validated limit", async () => {
    for (const text of ["one", "two", "three"]) {
      await request(app).post(`/recipients/${ROSA}/handoff-notes`).set(admin).send({ text });
    }

    const res = await request(app).get(`/recipients/${ROSA}/handoff-notes?limit=2`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body.notes.map((n: { text: string }) => n.text)).toEqual(["three", "two"]);

    expect((await request(app).get(`/recipients/${ROSA}/handoff-notes?limit=0`).set(admin)).status).toBe(400);
  });

  it("returns 404 for an unknown recipient", async () => {
    expect((await request(app).get("/recipients/nobody/handoff-notes").set(admin)).status).toBe(404);
  });
});
