/**
 * Owner approval for sensitive profile changes (#1233).
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync, existsSync, rmSync } from "fs";
import { CareRecipientsStore, DEFAULT_RECIPIENT_ID } from "../db.ts";
import { createCareRecipientsRouter } from "../routes.ts";
import {
  createProfileChangesRouter,
  policyLimitIncreases,
  splitPolicyUpdate,
  submitPolicyUpdate,
  type PolicyAccess,
} from "../profile-changes.ts";
import { getAuditFilePath } from "../../../shared/audit-log.ts";

const CAREGIVER_TOKEN = "test-caregiver-token";
const ROSA = DEFAULT_RECIPIENT_ID;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const admin = bearer(CAREGIVER_TOKEN);

const BASE_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 1000,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 0,
};

/** In-memory policy store with the real cross-field rule that matters here. */
function makePolicyAccess(initial = BASE_POLICY) {
  const policies = new Map<string, Record<string, unknown>>();
  const access: PolicyAccess = {
    get: (rid) => ({ ...(policies.get(rid) ?? initial) }),
    set: (rid, policy) => {
      if (Number(policy.dailyLimit) > Number(policy.monthlyLimit)) return "dailyLimit cannot exceed monthlyLimit";
      policies.set(rid, { ...policy });
      return null;
    },
  };
  return { access, policies };
}

function auditEvents(): string[] {
  const file = getAuditFilePath();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).event);
}

let store: CareRecipientsStore;

beforeEach(() => {
  store = new CareRecipientsStore(":memory:");
  rmSync(getAuditFilePath(), { force: true });
});

describe("which policy changes are sensitive", () => {
  it("treats raised limits as sensitive and lowered limits as not", () => {
    const increases = policyLimitIncreases(BASE_POLICY, { ...BASE_POLICY, dailyLimit: 250, monthlyLimit: 800 });
    expect(increases).toEqual([{ field: "dailyLimit", label: "Daily limit", before: 100, after: 250 }]);
  });

  it("holds increased limits at their current value in the immediate part", () => {
    const { immediate, increases } = splitPolicyUpdate(BASE_POLICY, {
      ...BASE_POLICY,
      approvalThreshold: 90,
      holdTimeSeconds: 600,
    });
    expect(increases.map((c) => c.field)).toEqual(["approvalThreshold"]);
    expect(immediate).toMatchObject({ approvalThreshold: 75, holdTimeSeconds: 600 });
  });
});

describe("submitPolicyUpdate", () => {
  it("applies non-sensitive changes immediately with no approval request", () => {
    const { access } = makePolicyAccess();
    const result = submitPolicyUpdate(store, access, {
      recipientId: "rosa",
      proposed: { ...BASE_POLICY, dailyLimit: 50 },
      requestedBy: "maria",
    });
    expect(result).toMatchObject({ ok: true, pendingApproval: null });
    expect(access.get("rosa").dailyLimit).toBe(50);
  });

  it("files limit increases for approval while saving the rest", () => {
    const { access } = makePolicyAccess();
    const result = submitPolicyUpdate(store, access, {
      recipientId: "rosa",
      proposed: { ...BASE_POLICY, dailyLimit: 200, holdTimeSeconds: 300 },
      requestedBy: "david",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.pendingApproval).toMatchObject({
      kind: "policy_limit_increase",
      status: "pending",
      summary: "Raise daily limit from $100.00 to $200.00",
      payload: { fields: { dailyLimit: 200 } },
      requested_by: "david",
    });
    expect(access.get("rosa")).toMatchObject({ dailyLimit: 100, holdTimeSeconds: 300 });
    expect(auditEvents()).toContain("profile_change.requested");
  });

  it("defers the whole update if the part that would apply now is rejected", () => {
    // Safety net: with a valid current policy, holding increases back can't
    // break the schema's cross-field rules, but a stricter validator could.
    const { access } = makePolicyAccess();
    const strict: PolicyAccess = {
      get: access.get,
      set: (rid, policy) => (policy.holdTimeSeconds === 600 && policy.dailyLimit === 100 ? "rejected" : access.set(rid, policy)),
    };
    const result = submitPolicyUpdate(store, strict, {
      recipientId: "rosa",
      proposed: { ...BASE_POLICY, dailyLimit: 200, holdTimeSeconds: 600 },
      requestedBy: "david",
    });
    if (!result.ok) throw new Error(result.error);
    expect(access.get("rosa")).toEqual(BASE_POLICY);
    expect(result.pendingApproval?.payload.fields).toMatchObject({ dailyLimit: 200, holdTimeSeconds: 600 });
  });
});

describe("/agent profile change routes", () => {
  function makeApp(access: PolicyAccess) {
    const app = express();
    app.use(express.json());
    app.use("/agent", createProfileChangesRouter(store, { policy: access }));
    return app;
  }

  it("lists pending changes and applies one on approval, logging the decision", async () => {
    const { access } = makePolicyAccess();
    const app = makeApp(access);
    submitPolicyUpdate(store, access, { recipientId: "rosa", proposed: { ...BASE_POLICY, dailyLimit: 200 }, requestedBy: "david" });

    const list = await request(app).get("/agent/profile-changes?recipient_id=rosa&status=pending");
    expect(list.status).toBe(200);
    expect(list.body.requests).toHaveLength(1);

    const id = list.body.requests[0].id;
    const approved = await request(app).post(`/agent/profile-changes/${id}/approve`).send({ caregiver_id: "maria" });
    expect(approved.status).toBe(200);
    expect(approved.body.request).toMatchObject({ status: "approved", decided_by: "maria" });
    expect(access.get("rosa").dailyLimit).toBe(200);
    expect(auditEvents()).toContain("profile_change.approved");

    const again = await request(app).post(`/agent/profile-changes/${id}/approve`).send({ caregiver_id: "maria" });
    expect(again.status).toBe(409);
  });

  it("rejects without applying, and logs the rejection", async () => {
    const { access } = makePolicyAccess();
    const app = makeApp(access);
    const filed = submitPolicyUpdate(store, access, { recipientId: "rosa", proposed: { ...BASE_POLICY, dailyLimit: 200 }, requestedBy: "david" });
    const id = filed.ok ? filed.pendingApproval!.id : "";
    const rejected = await request(app).post(`/agent/profile-changes/${id}/reject`).send({ caregiver_id: "maria", note: "too high" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.request).toMatchObject({ status: "rejected", decision_note: "too high" });
    expect(access.get("rosa").dailyLimit).toBe(100);
    expect(auditEvents()).toContain("profile_change.rejected");
  });

  it("only lets an owner decide once caregivers are linked", async () => {
    const { access } = makePolicyAccess();
    const app = makeApp(access);
    const owner = store.inviteCaregiver({ recipientId: ROSA, email: "maria@example.com", role: "owner", invitedBy: "admin" });
    store.acceptInvite(owner.inviteToken, "Maria Garcia");
    const co = store.inviteCaregiver({ recipientId: ROSA, email: "david@example.com", role: "co-caregiver", invitedBy: "admin" });
    store.acceptInvite(co.inviteToken, "David Garcia");
    const filed = submitPolicyUpdate(store, access, { recipientId: ROSA, proposed: { ...BASE_POLICY, dailyLimit: 200 }, requestedBy: "david" });
    const id = filed.ok ? filed.pendingApproval!.id : "";

    const byCo = await request(app).post(`/agent/profile-changes/${id}/approve`).send({ caregiver_id: "david-garcia" });
    expect(byCo.status).toBe(403);
    const anonymous = await request(app).post(`/agent/profile-changes/${id}/approve`).send({});
    expect(anonymous.status).toBe(400);
    const byOwner = await request(app).post(`/agent/profile-changes/${id}/approve`).send({ caregiver_id: "maria-garcia" });
    expect(byOwner.status).toBe(200);
  });

  it("files every auto-topup change for approval and applies it once approved", async () => {
    const { access } = makePolicyAccess();
    const app = makeApp(access);
    const rule = { enabled: true, threshold: 10, topUpAmount: 50, fundingSource: "USDC" };

    const put = await request(app).put("/agent/wallet/auto-topup?recipient_id=rosa").send({ rule, caregiver_id: "david" });
    expect(put.status).toBe(202);
    expect(put.body.pendingApproval).toMatchObject({ kind: "auto_topup_change", status: "pending" });
    expect((await request(app).get("/agent/wallet/auto-topup?recipient_id=rosa")).body.rule).toBeNull();

    await request(app).post(`/agent/profile-changes/${put.body.pendingApproval.id}/approve`).send({});
    const after = await request(app).get("/agent/wallet/auto-topup?recipient_id=rosa");
    expect(after.body).toMatchObject({ rule, pendingApproval: null });

    const unchanged = await request(app).put("/agent/wallet/auto-topup?recipient_id=rosa").send({ rule });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.pendingApproval).toBeNull();
  });
});

describe("caregiver removal approval (/recipients routes)", () => {
  async function linked(app: express.Express, email: string, role: string) {
    const invite = await request(app).post(`/recipients/${ROSA}/caregivers/invites`).set(admin).send({ email, role });
    const accept = await request(app).post("/caregiver-invites/accept").send({ token: invite.body.inviteToken });
    return bearer(accept.body.accessToken);
  }

  it("requires the owner-only manage permission to decide", async () => {
    const app = express();
    app.use(express.json());
    app.use(createCareRecipientsRouter(store, CAREGIVER_TOKEN));
    const owner = await linked(app, "maria@example.com", "owner");
    const co = await linked(app, "david@example.com", "co-caregiver");
    await linked(app, "viewer@example.com", "viewer");

    const requested = await request(app).delete(`/recipients/${ROSA}/caregivers/viewer@example.com`).set(owner);
    expect(requested.status).toBe(202);
    const id = requested.body.pendingApproval.id;

    const pending = await request(app).get(`/recipients/${ROSA}/profile-changes?status=pending`).set(co);
    expect(pending.body.requests).toEqual([expect.objectContaining({ id, kind: "caregiver_removal" })]);

    expect((await request(app).post(`/recipients/${ROSA}/profile-changes/${id}/approve`).set(co)).status).toBe(403);
    const approved = await request(app).post(`/recipients/${ROSA}/profile-changes/${id}/approve`).set(owner);
    expect(approved.status).toBe(200);
    expect(store.getCaregiver(ROSA, "viewer@example.com")).toBeUndefined();
  });
});
