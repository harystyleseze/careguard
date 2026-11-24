import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  CareRecipientsStore,
  CaregiverAccessError,
  DEFAULT_RECIPIENT_ID,
  INVITE_TTL_MS,
  roleHasPermission,
} from "../db.ts";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

function expectAccessError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CaregiverAccessError);
    expect((err as CaregiverAccessError).code).toBe(code);
    return;
  }
  throw new Error(`expected CaregiverAccessError(${code})`);
}

describe("legacy caregiver_user_id migration (#1179)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "careguard-caregivers-"));
  });

  afterEach(() => {
    // Best effort: Windows refuses to unlink a database file that is still open.
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it("moves each single caregiver into the join table as owner and drops the column", () => {
    const dbPath = join(dir, "careguard.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE care_recipients (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER,
        medications TEXT NOT NULL DEFAULT '[]', primary_doctor TEXT, insurance TEXT,
        caregiver_user_id TEXT
      );
      INSERT INTO care_recipients (id, name, caregiver_user_id) VALUES ('linked', 'Linked Person', 'user_42');
      INSERT INTO care_recipients (id, name, caregiver_user_id) VALUES ('unlinked', 'Unlinked Person', NULL);
    `);
    legacy.close();

    const store = new CareRecipientsStore(dbPath);

    expect(store.listCaregivers("linked")).toEqual([
      expect.objectContaining({ caregiver_user_id: "user_42", role: "owner", status: "active" }),
    ]);
    expect(store.listCaregivers("unlinked")).toEqual([]);
    expect(store.getById("linked")).not.toHaveProperty("caregiver_user_id");

    // Re-opening is a no-op: the column is gone and the owner is not duplicated.
    const reopened = new CareRecipientsStore(dbPath);
    expect(reopened.listCaregivers("linked")).toHaveLength(1);
  });
});

describe("caregiver invites and access (#1179)", () => {
  let store: CareRecipientsStore;

  beforeEach(() => {
    store = new CareRecipientsStore(":memory:");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function invite(email: string, role: "owner" | "co-caregiver" | "viewer" = "co-caregiver") {
    return store.inviteCaregiver({ recipientId: DEFAULT_RECIPIENT_ID, email, role, invitedBy: "admin" });
  }

  it("creates a pending invite keyed by the normalized email, without exposing token hashes", () => {
    const { caregiver, inviteToken } = invite("  David@Example.COM ");

    expect(inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(caregiver).toMatchObject({
      recipient_id: DEFAULT_RECIPIENT_ID,
      caregiver_user_id: "david@example.com",
      email: "david@example.com",
      role: "co-caregiver",
      status: "invited",
    });
    expect(caregiver).not.toHaveProperty("invite_token_hash");
    expect(caregiver).not.toHaveProperty("access_token_hash");
  });

  it("accepting an invite activates the link and issues a token scoped to it", () => {
    const { inviteToken } = invite("david@example.com");
    const { caregiver, accessToken } = store.acceptInvite(inviteToken, "David Garcia");

    expect(caregiver).toMatchObject({ status: "active", display_name: "David Garcia", invite_expires_at: null });
    expect(store.authenticateCaregiver(accessToken)).toMatchObject({
      recipient_id: DEFAULT_RECIPIENT_ID,
      caregiver_user_id: "david@example.com",
      role: "co-caregiver",
    });
    expect(store.authenticateCaregiver("not-a-token")).toBeUndefined();
  });

  it("invite codes are single-use", () => {
    const { inviteToken } = invite("david@example.com");
    store.acceptInvite(inviteToken);
    expectAccessError(() => store.acceptInvite(inviteToken), "invite_invalid");
  });

  it("rejects expired invites", () => {
    vi.useFakeTimers();
    const { inviteToken } = invite("david@example.com");
    vi.setSystemTime(Date.now() + INVITE_TTL_MS + 1);
    expectAccessError(() => store.acceptInvite(inviteToken), "invite_expired");
  });

  it("re-inviting a pending address rotates the code and role; an active caregiver cannot be re-invited", () => {
    const first = invite("david@example.com", "viewer");
    const second = invite("david@example.com", "co-caregiver");

    expectAccessError(() => store.acceptInvite(first.inviteToken), "invite_invalid");
    expect(store.acceptInvite(second.inviteToken).caregiver.role).toBe("co-caregiver");
    expectAccessError(() => invite("david@example.com"), "already_linked");
  });

  it("rejects invites for unknown recipients", () => {
    expectAccessError(
      () => store.inviteCaregiver({ recipientId: "nobody", email: "a@example.com", role: "viewer", invitedBy: "admin" }),
      "recipient_not_found",
    );
  });

  it("removing a caregiver revokes their access token immediately", () => {
    const { accessToken } = store.acceptInvite(invite("david@example.com").inviteToken);

    expect(store.removeCaregiver(DEFAULT_RECIPIENT_ID, "david@example.com")).toBe(true);
    expect(store.authenticateCaregiver(accessToken)).toBeUndefined();
    expect(store.removeCaregiver(DEFAULT_RECIPIENT_ID, "david@example.com")).toBe(false);
  });

  it("never removes the last active owner", () => {
    store.acceptInvite(invite("maria@example.com", "owner").inviteToken);
    expectAccessError(() => store.removeCaregiver(DEFAULT_RECIPIENT_ID, "maria@example.com"), "last_owner");

    store.acceptInvite(invite("ana@example.com", "owner").inviteToken);
    expect(store.removeCaregiver(DEFAULT_RECIPIENT_ID, "maria@example.com")).toBe(true);
    expect(store.listCaregivers(DEFAULT_RECIPIENT_ID).map((c) => c.caregiver_user_id)).toEqual(["ana@example.com"]);
  });
});

describe("role permissions (#1179)", () => {
  it.each([
    ["owner", "view", true],
    ["owner", "act", true],
    ["owner", "manage", true],
    ["co-caregiver", "view", true],
    ["co-caregiver", "act", true],
    ["co-caregiver", "manage", false],
    ["viewer", "view", true],
    ["viewer", "act", false],
    ["viewer", "manage", false],
  ] as const)("%s -> %s = %s", (role, permission, allowed) => {
    expect(roleHasPermission(role, permission)).toBe(allowed);
  });
});

describe("handoff notes (#1180)", () => {
  let store: CareRecipientsStore;

  beforeEach(() => {
    store = new CareRecipientsStore(":memory:");
  });

  it("lists a recipient's notes newest first, honouring the limit", () => {
    for (const text of ["first", "second", "third"]) {
      store.addHandoffNote({ recipient_id: DEFAULT_RECIPIENT_ID, author: "Maria", text });
    }
    const other = store.create({ name: "Other Person", age: null, medications: [], primary_doctor: null, insurance: null });
    store.addHandoffNote({ recipient_id: other.id, author: "Maria", text: "elsewhere" });

    expect(store.listHandoffNotes(DEFAULT_RECIPIENT_ID, 10).map((n) => n.text)).toEqual(["third", "second", "first"]);
    expect(store.listHandoffNotes(DEFAULT_RECIPIENT_ID, 2).map((n) => n.text)).toEqual(["third", "second"]);
  });

  it("rejects notes for unknown recipients via the foreign key", () => {
    expect(() => store.addHandoffNote({ recipient_id: "nobody", author: "Maria", text: "x" })).toThrow(/FOREIGN KEY/);
  });
});
