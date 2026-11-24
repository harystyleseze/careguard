import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { CareRecipientsStore, delegationStatus } from "../db.ts";
import { authorizeApprovalActor, createDelegationsRouter, MAX_DELEGATION_DAYS } from "../delegation.ts";

/** Temporary approval delegation (#1195), against a real in-memory SQLite store. */

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function makeApp() {
  const store = new CareRecipientsStore(":memory:");
  const app = express();
  app.use(express.json());
  app.use("/agent", createDelegationsRouter(store));
  return { app, store };
}

describe("approval delegation store (#1195)", () => {
  let store: CareRecipientsStore;
  beforeEach(() => {
    store = new CareRecipientsStore(":memory:");
  });

  it("is active only inside its window, scoped to recipient, delegator and delegate", () => {
    const now = Date.now();
    const d = store.createDelegation({ recipient_id: "rosa", delegator: "maria", delegate: "david", starts_at: iso(now), ends_at: iso(now + HOUR) });
    expect(store.findActiveDelegation("rosa", "maria", "david", new Date(now + 1000))?.id).toBe(d.id);
    // Other recipient / reversed roles / other delegate: no authority.
    expect(store.findActiveDelegation("other", "maria", "david", new Date(now + 1000))).toBeUndefined();
    expect(store.findActiveDelegation("rosa", "david", "maria", new Date(now + 1000))).toBeUndefined();
    expect(store.findActiveDelegation("rosa", "maria", "eve", new Date(now + 1000))).toBeUndefined();
  });

  it("expires automatically at ends_at and is not active before starts_at", () => {
    const now = Date.now();
    const d = store.createDelegation({ recipient_id: "rosa", delegator: "maria", delegate: "david", starts_at: iso(now + HOUR), ends_at: iso(now + 2 * HOUR) });
    expect(store.findActiveDelegation("rosa", "maria", "david", new Date(now))).toBeUndefined();
    expect(delegationStatus(d, new Date(now))).toBe("scheduled");
    expect(store.findActiveDelegation("rosa", "maria", "david", new Date(now + 1.5 * HOUR))).toBeDefined();
    expect(store.findActiveDelegation("rosa", "maria", "david", new Date(now + 2 * HOUR))).toBeUndefined();
    expect(delegationStatus(d, new Date(now + 2 * HOUR))).toBe("expired");
  });

  it("can be revoked early, only by the delegator", () => {
    const now = Date.now();
    const d = store.createDelegation({ recipient_id: "rosa", delegator: "maria", delegate: "david", starts_at: iso(now), ends_at: iso(now + HOUR) });
    expect(store.revokeDelegation(d.id, "david")).toBeUndefined();
    const revoked = store.revokeDelegation(d.id, "maria");
    expect(revoked?.revoked_at).toBeTruthy();
    expect(delegationStatus(revoked!)).toBe("revoked");
    expect(store.findActiveDelegation("rosa", "maria", "david")).toBeUndefined();
    expect(store.revokeDelegation(d.id, "maria")).toBeUndefined();
  });
});

describe("authorizeApprovalActor (#1195)", () => {
  let store: CareRecipientsStore;
  beforeEach(() => {
    store = new CareRecipientsStore(":memory:");
  });

  it("acting as yourself is not delegated (and unattributed calls stay 'api')", () => {
    expect(authorizeApprovalActor(store, { recipientId: "rosa" })).toEqual({ ok: true, actor: "api", delegated: false });
    expect(authorizeApprovalActor(store, { recipientId: "rosa", caregiverId: "maria" })).toEqual({ ok: true, actor: "maria", delegated: false });
    expect(authorizeApprovalActor(store, { recipientId: "rosa", caregiverId: "maria", onBehalfOf: "maria" })).toMatchObject({ ok: true, delegated: false });
  });

  it("acting on behalf of someone requires an active delegation", () => {
    expect(authorizeApprovalActor(store, { recipientId: "rosa", caregiverId: "david", onBehalfOf: "maria" })).toMatchObject({ ok: false, status: 403 });
    expect(authorizeApprovalActor(store, { recipientId: "rosa", onBehalfOf: "maria" })).toMatchObject({ ok: false, status: 400 });

    const now = Date.now();
    const d = store.createDelegation({ recipient_id: "rosa", delegator: "maria", delegate: "david", starts_at: iso(now - 1000), ends_at: iso(now + HOUR) });
    const ok = authorizeApprovalActor(store, { recipientId: "rosa", caregiverId: "david", onBehalfOf: "maria" });
    expect(ok).toMatchObject({ ok: true, actor: "david", delegated: true, onBehalfOf: "maria" });
    expect(ok.ok && ok.delegated && ok.delegation.id).toBe(d.id);

    // After the window ends, the same request is refused.
    expect(authorizeApprovalActor(store, { recipientId: "rosa", caregiverId: "david", onBehalfOf: "maria", now: new Date(now + 2 * HOUR) })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("/agent/delegations routes (#1195)", () => {
  it("creates, lists (all and active-for-delegate) and revokes", async () => {
    const { app } = makeApp();
    const created = await request(app).post("/agent/delegations").send({ recipient_id: "rosa", delegator: "maria", delegate: "david", ends_at: iso(Date.now() + HOUR) });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("active");

    const all = await request(app).get("/agent/delegations").query({ recipient_id: "rosa" });
    expect(all.body.delegations).toHaveLength(1);
    const mine = await request(app).get("/agent/delegations").query({ recipient_id: "rosa", delegate: "david" });
    expect(mine.body.delegations[0].delegator).toBe("maria");

    expect((await request(app).post(`/agent/delegations/${created.body.id}/revoke`).send({ delegator: "david" })).status).toBe(403);
    const revoked = await request(app).post(`/agent/delegations/${created.body.id}/revoke`).send({ delegator: "maria" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe("revoked");
    expect((await request(app).post(`/agent/delegations/${created.body.id}/revoke`).send({ delegator: "maria" })).status).toBe(409);
    const after = await request(app).get("/agent/delegations").query({ recipient_id: "rosa", delegate: "david" });
    expect(after.body.delegations).toHaveLength(0);
  });

  it("validates input", async () => {
    const { app } = makeApp();
    const base = { recipient_id: "rosa", delegator: "maria", delegate: "david" };
    const post = (body: object) => request(app).post("/agent/delegations").send(body);
    expect((await post({ ...base, delegate: "maria", ends_at: iso(Date.now() + HOUR) })).status).toBe(400);
    expect((await post({ ...base, ends_at: "not-a-date" })).status).toBe(400);
    expect((await post({ ...base, ends_at: iso(Date.now() - HOUR) })).status).toBe(400);
    expect((await post({ ...base, starts_at: iso(Date.now() + 2 * HOUR), ends_at: iso(Date.now() + HOUR) })).status).toBe(400);
    expect((await post({ ...base, ends_at: iso(Date.now() + (MAX_DELEGATION_DAYS + 1) * 24 * HOUR) })).status).toBe(400);
    expect((await post({ ...base, recipient_id: "", ends_at: iso(Date.now() + HOUR) })).status).toBe(400);
    expect((await request(app).get("/agent/delegations")).status).toBe(400);
    expect((await request(app).post("/agent/delegations/nope/revoke").send({ delegator: "maria" })).status).toBe(404);
  });
});
