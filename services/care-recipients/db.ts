import { mkdirSync } from 'fs';
import { createRequire } from 'module';
import { createHash, randomBytes, randomUUID } from 'crypto';
import path from 'path';
import { logger } from '../../shared/logger.ts';
import { appendAuditEntry } from '../../shared/audit-log.ts';
import {
  type CostSplit,
  type CostSplitShare,
  calculateContributorBalances,
  type ContributorBalanceSummary,
} from '../../shared/cost-split.ts';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/** Id of the recipient seeded into an empty database. */
export const DEFAULT_RECIPIENT_ID = 'rosa_garcia';

/** Caregiver roles (#1179), most to least privileged. */
export const CAREGIVER_ROLES = ['owner', 'co-caregiver', 'viewer'] as const;
export type CaregiverRole = (typeof CAREGIVER_ROLES)[number];

/**
 * - view:   read the recipient, its linked caregivers and handoff notes
 * - act:    day-to-day care actions, e.g. posting handoff notes
 * - manage: invite and remove caregivers, configure consent
 */
export type CaregiverPermission = 'view' | 'act' | 'manage';

const ROLE_PERMISSIONS: Record<CaregiverRole, ReadonlySet<CaregiverPermission>> = {
  owner: new Set(['view', 'act', 'manage']),
  'co-caregiver': new Set(['view', 'act']),
  viewer: new Set(['view']),
};

export function roleHasPermission(role: CaregiverRole, permission: CaregiverPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HANDOFF_NOTE_MAX_LENGTH = 500;

// ── Granular Data-Sharing Consent (#1218) ─────────────────────────────────────

export type ConsentCategory = 'medications' | 'bills' | 'wallet';
export const CONSENT_CATEGORIES: readonly ConsentCategory[] = ['medications', 'bills', 'wallet'] as const;

export interface RoleConsent {
  medications: boolean;
  bills: boolean;
  wallet: boolean;
}

export interface ConsentSettings {
  owner: RoleConsent;
  'co-caregiver': RoleConsent;
  viewer: RoleConsent;
}

/** Default consent is fully open to preserve current single-caregiver behavior (#1218). */
export const DEFAULT_CONSENT_SETTINGS: ConsentSettings = {
  owner: { medications: true, bills: true, wallet: true },
  'co-caregiver': { medications: true, bills: true, wallet: true },
  viewer: { medications: true, bills: true, wallet: true },
};

export interface CareRecipientRecord {
  id: string;
  name: string;
  age: number | null;
  medications: string[];
  primary_doctor: string | null;
  insurance: string | null;
}

export interface SideEffectEntry {
  id: string;
  recipient_id: string;
  medication_id: string;
  description: string;
  severity: 'mild' | 'moderate' | 'severe';
  timestamp: string;
}

export type CareRecipientEntity = CareRecipientRecord;
export type CareRecipientInput = Omit<CareRecipientEntity, 'id'>;

interface CareRecipientRow {
  id: string;
  name: string;
  age: number | null;
  medications: string;
  primary_doctor: string | null;
  insurance: string | null;
}

export type CaregiverLinkStatus = 'active' | 'invited';

/** A caregiver linked to a recipient. Invite and access token hashes are never exposed. */
export interface RecipientCaregiver {
  recipient_id: string;
  caregiver_user_id: string;
  email: string | null;
  display_name: string | null;
  role: CaregiverRole;
  status: CaregiverLinkStatus;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
  invite_expires_at: string | null;
}

const CAREGIVER_COLUMNS =
  'recipient_id, caregiver_user_id, email, display_name, role, status, invited_by, created_at, accepted_at, invite_expires_at';

export interface HandoffNote {
  id: string;
  recipient_id: string;
  author: string;
  text: string;
  created_at: string;
}

export type HandoffNoteInput = Omit<HandoffNote, 'id' | 'created_at'>;

export type CaregiverAccessErrorCode =
  | 'recipient_not_found'
  | 'already_linked'
  | 'invite_invalid'
  | 'invite_expired'
  | 'last_owner';

export class CaregiverAccessError extends Error {
  constructor(
    readonly code: CaregiverAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaregiverAccessError';
  }
}

/** Invite codes and access tokens: 256 bits from the CSPRNG. */
function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Secrets are persisted only as SHA-256 digests. A fast hash is sufficient
 * because the inputs are 256-bit random values, not user-chosen passwords.
 */
function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Temporary approval delegation (#1195): `delegator` (the primary caregiver)
 * lets `delegate` (a co-caregiver) approve/deny pending transactions for one
 * recipient between `starts_at` and `ends_at`. A delegation is active only
 * inside that window and while `revoked_at` is null, so it expires on its own
 * at `ends_at` with no background job.
 */
export interface ApprovalDelegation {
  id: string;
  recipient_id: string;
  delegator: string;
  delegate: string;
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
  created_at: string;
}

export type DelegationStatus = 'scheduled' | 'active' | 'expired' | 'revoked';

export function delegationStatus(d: ApprovalDelegation, now: Date = new Date()): DelegationStatus {
  if (d.revoked_at) return 'revoked';
  const t = now.getTime();
  if (t < Date.parse(d.starts_at)) return 'scheduled';
  if (t >= Date.parse(d.ends_at)) return 'expired';
  return 'active';
}

function defaultDbPath(): string {
  if (process.env.CARE_RECIPIENTS_DB_PATH) {
    return path.resolve(process.cwd(), process.env.CARE_RECIPIENTS_DB_PATH);
  }
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  // Fall back to DATA_DIR so a single-volume-mount deployment works (#1043).
  if (process.env.DATA_DIR) {
    return path.join(process.env.DATA_DIR, 'careguard.sqlite');
  }
  return new URL('../../data/careguard.sqlite', import.meta.url).pathname;
}

function rowToRecipient(row: CareRecipientRow): CareRecipientEntity {
  let medications: string[] = [];
  try {
    medications = JSON.parse(row.medications);
  } catch {
    medications = [];
  }
  return {
    id: row.id,
    name: row.name,
    age: row.age ?? null,
    medications,
    primary_doctor: row.primary_doctor ?? null,
    insurance: row.insurance ?? null,
  };
}

export class CareRecipientsStore {
  private readonly db: any;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? defaultDbPath();
    if (resolvedPath !== ':memory:') {
      mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.seedIfEmpty();
  }

  /**
   * Runs fn atomically. BEGIN IMMEDIATE takes the write lock up front so a
   * read-then-write sequence cannot interleave with another connection to
   * the same file (e.g. the vitals store).
   */
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private migrate(): void {
    const roles = CAREGIVER_ROLES.map((role) => `'${role}'`).join(', ');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS care_recipients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER,
        medications TEXT NOT NULL DEFAULT '[]',
        primary_doctor TEXT,
        insurance TEXT
      );
      CREATE TABLE IF NOT EXISTS care_recipient_caregivers (
        recipient_id TEXT NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
        caregiver_user_id TEXT NOT NULL,
        email TEXT,
        display_name TEXT,
        role TEXT NOT NULL CHECK (role IN (${roles})),
        status TEXT NOT NULL CHECK (status IN ('active', 'invited')),
        access_token_hash TEXT UNIQUE,
        invite_token_hash TEXT UNIQUE,
        invited_by TEXT,
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        invite_expires_at TEXT,
        PRIMARY KEY (recipient_id, caregiver_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_caregivers_access_token
        ON care_recipient_caregivers (access_token_hash);
      CREATE INDEX IF NOT EXISTS idx_caregivers_invite_token
        ON care_recipient_caregivers (invite_token_hash);

      CREATE TABLE IF NOT EXISTS handoff_notes (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_handoff_notes_lookup
        ON handoff_notes (recipient_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS approval_delegations (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        delegator TEXT NOT NULL,
        delegate TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        CHECK (delegator <> delegate),
        CHECK (ends_at > starts_at)
      );

      -- Shared caregiver checklist (Issue #1200). Completed tasks are kept
      -- (done = 1, completed_at set) so the dashboard can show a history.
      CREATE TABLE IF NOT EXISTS care_tasks (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        assignee TEXT,
        due_date TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_care_tasks_recipient ON care_tasks(recipient_id, done);
      CREATE INDEX IF NOT EXISTS idx_approval_delegations_lookup
        ON approval_delegations (recipient_id, delegate, ends_at);

      CREATE TABLE IF NOT EXISTS care_recipient_consent (
        recipient_id TEXT PRIMARY KEY REFERENCES care_recipients(id) ON DELETE CASCADE,
        consent_settings TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT
      );

      CREATE TABLE IF NOT EXISTS cost_splits (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        total_amount REAL NOT NULL,
        payer_id TEXT NOT NULL,
        payer_name TEXT NOT NULL,
        description TEXT,
        shares TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cost_splits_recipient
        ON cost_splits (recipient_id);
      CREATE INDEX IF NOT EXISTS idx_cost_splits_tx
        ON cost_splits (transaction_id);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS side_effect_entries (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        medication_id TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  private seedIfEmpty(): void {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM care_recipients')
      .get() as { count: number };
    if (row.count > 0) return;

    this.db.prepare(`
      INSERT INTO care_recipients (id, name, age, medications, primary_doctor, insurance)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      DEFAULT_RECIPIENT_ID,
      'Rosa Garcia',
      78,
      JSON.stringify(['Lisinopril', 'Metformin', 'Atorvastatin', 'Amlodipine']),
      'Dr. Chen, General Hospital',
      'Medicare Part D',
    );
    logger.info('[care-recipients] seeded default recipient Rosa Garcia');
  }

  list(): CareRecipientEntity[] {
    const rows = this.db
      .prepare('SELECT * FROM care_recipients ORDER BY name ASC')
      .all() as CareRecipientRow[];
    return rows.map(rowToRecipient);
  }

  getById(id: string): CareRecipientEntity | undefined {
    const row = this.db
      .prepare('SELECT * FROM care_recipients WHERE id = ?')
      .get(id) as CareRecipientRow | undefined;
    return row ? rowToRecipient(row) : undefined;
  }

  create(input: CareRecipientInput): CareRecipientEntity {
    // Date.now() alone collides under concurrent creates of the same name within
    // the same millisecond (duplicate PRIMARY KEY -> insert throws); a short
    // random suffix keeps ids readable while guaranteeing uniqueness.
    const base = input.name.toLowerCase().replace(/\s+/g, '_');
    const id = `${base}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO care_recipients (id, name, age, medications, primary_doctor, insurance)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.age ?? null,
      JSON.stringify(input.medications ?? []),
      input.primary_doctor ?? null,
      input.insurance ?? null,
    );
    return this.getById(id)!;
  }

  // ── Caregiver links (#1179) ─────────────────────────────────────────────────

  /** Active caregivers and pending invites for a recipient, oldest first. */
  listCaregivers(recipientId: string): RecipientCaregiver[] {
    return this.db
      .prepare(`SELECT ${CAREGIVER_COLUMNS} FROM care_recipient_caregivers WHERE recipient_id = ? ORDER BY created_at ASC`)
      .all(recipientId) as RecipientCaregiver[];
  }

  getCaregiver(recipientId: string, caregiverUserId: string): RecipientCaregiver | undefined {
    return this.db
      .prepare(`SELECT ${CAREGIVER_COLUMNS} FROM care_recipient_caregivers WHERE recipient_id = ? AND caregiver_user_id = ?`)
      .get(recipientId, caregiverUserId) as RecipientCaregiver | undefined;
  }

  /**
   * Invites a caregiver by email. Re-inviting a pending address rotates its
   * code and role; inviting an already active caregiver is rejected. Only the
   * SHA-256 of the invite code is stored, so the returned code is the one
   * chance to deliver it.
   */
  inviteCaregiver(input: {
    recipientId: string;
    email: string;
    role: CaregiverRole;
    invitedBy: string;
  }): { caregiver: RecipientCaregiver; inviteToken: string } {
    const email = normalizeEmail(input.email);
    const inviteToken = generateSecret();
    const now = Date.now();
    return this.transaction(() => {
      if (!this.getById(input.recipientId)) {
        throw new CaregiverAccessError('recipient_not_found', 'Care recipient not found');
      }
      const result = this.db.prepare(`
        INSERT INTO care_recipient_caregivers
          (recipient_id, caregiver_user_id, email, role, status, invite_token_hash, invite_expires_at, invited_by, created_at)
        VALUES (?, ?, ?, ?, 'invited', ?, ?, ?, ?)
        ON CONFLICT (recipient_id, caregiver_user_id) DO UPDATE SET
          role = excluded.role,
          invite_token_hash = excluded.invite_token_hash,
          invite_expires_at = excluded.invite_expires_at,
          invited_by = excluded.invited_by
        WHERE care_recipient_caregivers.status = 'invited'
      `).run(
        input.recipientId,
        email,
        email,
        input.role,
        hashSecret(inviteToken),
        new Date(now + INVITE_TTL_MS).toISOString(),
        input.invitedBy,
        new Date(now).toISOString(),
      );
      if (Number(result.changes) === 0) {
        throw new CaregiverAccessError('already_linked', 'Caregiver is already linked to this care recipient');
      }
      return { caregiver: this.getCaregiver(input.recipientId, email)!, inviteToken };
    });
  }

  /**
   * Redeems an invite code and issues an access token for that one recipient
   * link. Tokens are scoped to a link rather than to the email address because
   * the email is asserted by the inviter: a global identity would let an owner
   * of one recipient invite someone else's address, accept it and reach that
   * person's other recipients.
   */
  acceptInvite(inviteToken: string, displayName?: string): { caregiver: RecipientCaregiver; accessToken: string } {
    return this.transaction(() => {
      const invite = this.db
        .prepare(`SELECT ${CAREGIVER_COLUMNS} FROM care_recipient_caregivers WHERE invite_token_hash = ? AND status = 'invited'`)
        .get(hashSecret(inviteToken)) as RecipientCaregiver | undefined;
      if (!invite) {
        throw new CaregiverAccessError('invite_invalid', 'Invite code is invalid or has already been used');
      }
      if (!invite.invite_expires_at || Date.parse(invite.invite_expires_at) <= Date.now()) {
        throw new CaregiverAccessError('invite_expired', 'Invite code has expired; ask an owner to re-send it');
      }

      const accessToken = generateSecret();
      const acceptedAt = new Date().toISOString();
      this.db.prepare(`
        UPDATE care_recipient_caregivers
        SET status = 'active', display_name = ?, access_token_hash = ?, accepted_at = ?,
            invite_token_hash = NULL, invite_expires_at = NULL
        WHERE recipient_id = ? AND caregiver_user_id = ?
      `).run(displayName ?? null, hashSecret(accessToken), acceptedAt, invite.recipient_id, invite.caregiver_user_id);

      return {
        caregiver: {
          ...invite,
          status: 'active',
          display_name: displayName ?? null,
          accepted_at: acceptedAt,
          invite_expires_at: null,
        },
        accessToken,
      };
    });
  }

  /** Resolves an access token to its active caregiver link (indexed lookup). */
  authenticateCaregiver(accessToken: string): RecipientCaregiver | undefined {
    return this.db
      .prepare(`SELECT ${CAREGIVER_COLUMNS} FROM care_recipient_caregivers WHERE access_token_hash = ? AND status = 'active'`)
      .get(hashSecret(accessToken)) as RecipientCaregiver | undefined;
  }

  /**
   * Removes a caregiver link or revokes a pending invite; the link's access
   * token stops working immediately. The last active owner cannot be removed,
   * so a recipient is never left without someone able to manage access.
   */
  removeCaregiver(recipientId: string, caregiverUserId: string): boolean {
    return this.transaction(() => {
      const link = this.getCaregiver(recipientId, caregiverUserId);
      if (!link) return false;
      if (link.role === 'owner' && link.status === 'active') {
        const { count } = this.db
          .prepare(`SELECT COUNT(*) AS count FROM care_recipient_caregivers WHERE recipient_id = ? AND role = 'owner' AND status = 'active'`)
          .get(recipientId) as { count: number };
        if (count <= 1) {
          throw new CaregiverAccessError('last_owner', 'Cannot remove the last owner of a care recipient');
        }
      }
      this.db
        .prepare('DELETE FROM care_recipient_caregivers WHERE recipient_id = ? AND caregiver_user_id = ?')
        .run(recipientId, caregiverUserId);
      return true;
    });
  }

  // ── Shift handoff notes (#1180) ─────────────────────────────────────────────

  addHandoffNote(input: HandoffNoteInput): HandoffNote {
    const note: HandoffNote = {
      id: `note_${Date.now()}_${randomUUID().slice(0, 8)}`,
      ...input,
      created_at: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO handoff_notes (id, recipient_id, author, text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(note.id, note.recipient_id, note.author, note.text, note.created_at);
    return note;
  }

  /**
   * Newest notes first. Served by the (recipient_id, created_at) index, so the
   * cost is O(log n + limit) regardless of how many notes a recipient has;
   * rowid breaks ties between notes written in the same millisecond.
   */
  listHandoffNotes(recipientId: string, limit: number): HandoffNote[] {
    return this.db
      .prepare(`
        SELECT id, recipient_id, author, text, created_at FROM handoff_notes
        WHERE recipient_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      `)
      .all(recipientId, limit) as HandoffNote[];
  }
  // ── Approval delegations (#1195) ──────────────────────────────────────────

  createDelegation(input: {
    recipient_id: string;
    delegator: string;
    delegate: string;
    starts_at: string;
    ends_at: string;
  }): ApprovalDelegation {
    const id = `dlg_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO approval_delegations (id, recipient_id, delegator, delegate, starts_at, ends_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(id, input.recipient_id, input.delegator, input.delegate, input.starts_at, input.ends_at, new Date().toISOString());
    return this.getDelegation(id)!;
  }

  getDelegation(id: string): ApprovalDelegation | undefined {
    return this.db.prepare('SELECT * FROM approval_delegations WHERE id = ?').get(id) as ApprovalDelegation | undefined;
  }

  listDelegations(recipientId: string): ApprovalDelegation[] {
    return this.db
      .prepare('SELECT * FROM approval_delegations WHERE recipient_id = ? ORDER BY starts_at DESC')
      .all(recipientId) as ApprovalDelegation[];
  }

  /** The delegation letting `delegate` act for `delegator` on this recipient right now, if any. */
  findActiveDelegation(recipientId: string, delegator: string, delegate: string, now: Date = new Date()): ApprovalDelegation | undefined {
    const iso = now.toISOString();
    return this.db.prepare(`
      SELECT * FROM approval_delegations
      WHERE recipient_id = ? AND delegator = ? AND delegate = ?
        AND revoked_at IS NULL AND starts_at <= ? AND ends_at > ?
      ORDER BY ends_at DESC LIMIT 1
    `).get(recipientId, delegator, delegate, iso, iso) as ApprovalDelegation | undefined;
  }

  /** Active delegations held by `delegate` on this recipient (for the approvals banner). */
  listActiveDelegationsFor(recipientId: string, delegate: string, now: Date = new Date()): ApprovalDelegation[] {
    const iso = now.toISOString();
    return this.db.prepare(`
      SELECT * FROM approval_delegations
      WHERE recipient_id = ? AND delegate = ?
        AND revoked_at IS NULL AND starts_at <= ? AND ends_at > ?
      ORDER BY ends_at ASC
    `).all(recipientId, delegate, iso, iso) as ApprovalDelegation[];
  }

  /** Revoke early. Only the delegator may revoke; returns the updated row or undefined if not theirs/already ended. */
  revokeDelegation(id: string, delegator: string, now: Date = new Date()): ApprovalDelegation | undefined {
    const result = this.db.prepare(`
      UPDATE approval_delegations SET revoked_at = ?
      WHERE id = ? AND delegator = ? AND revoked_at IS NULL AND ends_at > ?
    `).run(now.toISOString(), id, delegator, now.toISOString());
    return result.changes > 0 ? this.getDelegation(id) : undefined;
  }

  // ── Side effects ─────────────────────────────────────────────────────────

  listSideEffectEntries(recipientId: string, medicationId?: string): SideEffectEntry[] {
    const sql = medicationId
      ? 'SELECT * FROM side_effect_entries WHERE recipient_id = ? AND medication_id = ? ORDER BY timestamp DESC'
      : 'SELECT * FROM side_effect_entries WHERE recipient_id = ? ORDER BY timestamp DESC';
    const params = medicationId ? [recipientId, medicationId] : [recipientId];
    return this.db.prepare(sql).all(...params) as SideEffectEntry[];
  }

  addSideEffectEntry(entry: Omit<SideEffectEntry, 'id'>): SideEffectEntry {
    const id = `${entry.recipient_id}-${entry.medication_id}-${Date.now()}`;
    this.db.prepare(`
      INSERT INTO side_effect_entries (id, recipient_id, medication_id, description, severity, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, entry.recipient_id, entry.medication_id, entry.description, entry.severity, entry.timestamp);
    return { id, ...entry };
  }

  // ── Granular Data-Sharing Consent (#1218) ───────────────────────────────────

  /**
   * Retrieves consent settings for a recipient. Returns DEFAULT_CONSENT_SETTINGS
   * if no custom consent has been saved, ensuring backward compatibility.
   * Time Complexity: O(1) via primary key index.
   * Space Complexity: O(1).
   */
  getConsent(recipientId: string): ConsentSettings {
    const row = this.db
      .prepare('SELECT consent_settings FROM care_recipient_consent WHERE recipient_id = ?')
      .get(recipientId) as { consent_settings: string } | undefined;

    if (!row) return { ...DEFAULT_CONSENT_SETTINGS };
    try {
      const parsed = JSON.parse(row.consent_settings);
      return {
        owner: { ...DEFAULT_CONSENT_SETTINGS.owner, ...(parsed.owner || {}) },
        'co-caregiver': { ...DEFAULT_CONSENT_SETTINGS['co-caregiver'], ...(parsed['co-caregiver'] || {}) },
        viewer: { ...DEFAULT_CONSENT_SETTINGS.viewer, ...(parsed.viewer || {}) },
      };
    } catch {
      return { ...DEFAULT_CONSENT_SETTINGS };
    }
  }

  /**
   * Updates consent settings for a recipient and records an audit log entry.
   * Time Complexity: O(1) indexed write.
   * Space Complexity: O(1).
   */
  updateConsent(recipientId: string, consent: ConsentSettings, updatedBy = 'owner'): ConsentSettings {
    return this.transaction(() => {
      if (!this.getById(recipientId)) {
        throw new CaregiverAccessError('recipient_not_found', 'Care recipient not found');
      }

      // Owner role always retains full access
      const sanitizedConsent: ConsentSettings = {
        owner: { medications: true, bills: true, wallet: true },
        'co-caregiver': {
          medications: Boolean(consent['co-caregiver']?.medications),
          bills: Boolean(consent['co-caregiver']?.bills),
          wallet: Boolean(consent['co-caregiver']?.wallet),
        },
        viewer: {
          medications: Boolean(consent.viewer?.medications),
          bills: Boolean(consent.viewer?.bills),
          wallet: Boolean(consent.viewer?.wallet),
        },
      };

      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO care_recipient_consent (recipient_id, consent_settings, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (recipient_id) DO UPDATE SET
          consent_settings = excluded.consent_settings,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).run(recipientId, JSON.stringify(sanitizedConsent), now, updatedBy);

      try {
        appendAuditEntry({
          event: 'consent_settings_updated',
          actor: updatedBy,
          details: {
            recipientId,
            consent: sanitizedConsent,
            timestamp: now,
          },
        });
      } catch (err: any) {
        logger.warn({ err: err?.message || err }, '[care-recipients] failed appending to audit log');
      }

      return sanitizedConsent;
    });
  }

  // ── Cost Splitting Ledger (#1220) ──────────────────────────────────────────

  createCostSplit(input: {
    transactionId: string;
    recipientId: string;
    totalAmount: number;
    payerId: string;
    payerName: string;
    description?: string;
    shares: CostSplitShare[];
  }): CostSplit {
    const id = `split_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    const split: CostSplit = {
      id,
      transactionId: input.transactionId,
      recipientId: input.recipientId,
      totalAmount: input.totalAmount,
      payerId: input.payerId,
      payerName: input.payerName,
      description: input.description,
      shares: input.shares,
      createdAt,
    };

    this.db.prepare(`
      INSERT INTO cost_splits (id, transaction_id, recipient_id, total_amount, payer_id, payer_name, description, shares, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      split.id,
      split.transactionId,
      split.recipientId,
      split.totalAmount,
      split.payerId,
      split.payerName,
      split.description ?? null,
      JSON.stringify(split.shares),
      split.createdAt,
    );

    try {
      appendAuditEntry({
        event: 'cost_split_created',
        actor: input.payerName,
        details: {
          splitId: split.id,
          transactionId: split.transactionId,
          totalAmount: split.totalAmount,
          sharesCount: split.shares.length,
        },
      });
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, '[care-recipients] failed appending cost split to audit log');
    }

    return split;
  }

  listCostSplits(recipientId: string): CostSplit[] {
    const rows = this.db
      .prepare('SELECT * FROM cost_splits WHERE recipient_id = ? ORDER BY created_at DESC')
      .all(recipientId) as Array<{
        id: string;
        transaction_id: string;
        recipient_id: string;
        total_amount: number;
        payer_id: string;
        payer_name: string;
        description: string | null;
        shares: string;
        created_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transaction_id,
      recipientId: row.recipient_id,
      totalAmount: row.total_amount,
      payerId: row.payer_id,
      payerName: row.payer_name,
      description: row.description ?? undefined,
      shares: JSON.parse(row.shares),
      createdAt: row.created_at,
    }));
  }

  getCostSplit(id: string): CostSplit | undefined {
    const row = this.db
      .prepare('SELECT * FROM cost_splits WHERE id = ?')
      .get(id) as any;

    if (!row) return undefined;
    return {
      id: row.id,
      transactionId: row.transaction_id,
      recipientId: row.recipient_id,
      totalAmount: row.total_amount,
      payerId: row.payer_id,
      payerName: row.payer_name,
      description: row.description ?? undefined,
      shares: JSON.parse(row.shares),
      createdAt: row.created_at,
    };
  }

  getCostSplitByTx(transactionId: string): CostSplit | undefined {
    const row = this.db
      .prepare('SELECT * FROM cost_splits WHERE transaction_id = ?')
      .get(transactionId) as any;

    if (!row) return undefined;
    return {
      id: row.id,
      transactionId: row.transaction_id,
      recipientId: row.recipient_id,
      totalAmount: row.total_amount,
      payerId: row.payer_id,
      payerName: row.payer_name,
      description: row.description ?? undefined,
      shares: JSON.parse(row.shares),
      createdAt: row.created_at,
    };
  }

  settleCostSplitShare(splitId: string, contributorId: string, settledBy = 'caregiver'): CostSplit {
    return this.transaction(() => {
      const split = this.getCostSplit(splitId);
      if (!split) {
        throw new Error('Cost split not found');
      }

      let modified = false;
      const now = new Date().toISOString();
      const updatedShares = split.shares.map((share) => {
        if (share.caregiverId === contributorId && share.status !== 'settled') {
          modified = true;
          return {
            ...share,
            status: 'settled' as const,
            settledAt: now,
            settledBy,
          };
        }
        return share;
      });

      if (modified) {
        this.db.prepare(`
          UPDATE cost_splits SET shares = ? WHERE id = ?
        `).run(JSON.stringify(updatedShares), splitId);

        try {
          appendAuditEntry({
            event: 'cost_split_settled',
            actor: settledBy,
            details: {
              splitId,
              contributorId,
              settledAt: now,
            },
          });
        } catch (err: any) {
          logger.warn({ err: err?.message || err }, '[care-recipients] failed appending cost split settlement to audit log');
        }
      }

      return {
        ...split,
        shares: updatedShares,
      };
    });
  }

  getContributorBalances(recipientId: string): ContributorBalanceSummary {
    const splits = this.listCostSplits(recipientId);
    return calculateContributorBalances(splits);
  }
}

export interface NewCareTask {
  title: string;
  assignee?: string | null;
  due_date?: string | null;
}

export function createCareRecipientsStore(dbPath?: string): CareRecipientsStore {
  return new CareRecipientsStore(dbPath);
}

let sharedStore: CareRecipientsStore | undefined;

/**
 * Process-wide store shared by the HTTP routes and the agent's
 * get_handoff_notes tool (#1180), so both use one connection and see the
 * same data (including the in-memory database used under NODE_ENV=test).
 */
export function getCareRecipientsStore(): CareRecipientsStore {
  sharedStore ??= new CareRecipientsStore();
  return sharedStore;
}
