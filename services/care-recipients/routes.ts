import { Router, type Request, type Response, type NextFunction } from "express";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { registerKnownNames } from "../../shared/redact.ts";
import { createRateLimiter } from "../../shared/rate-limit.ts";
import { appendAuditEntry } from "../../shared/audit-log.ts";
import { loadRecipientAllergies } from "../../shared/allergies.ts";
import { readAdherenceRecords } from "../../shared/adherence.ts";
import { getMedicationHistory } from "../../shared/medication-history.ts";
import { logger } from "../../shared/logger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "..", "data");
import { z } from "zod";
import {
  CAREGIVER_ROLES,
  CaregiverAccessError,
  HANDOFF_NOTE_MAX_LENGTH,
  roleHasPermission,
  type CaregiverAccessErrorCode,
  type CaregiverPermission,
  type CareRecipientsStore,
  type CareRecipientEntity,
  type RecipientCaregiver,
  type ConsentSettings,
} from "./db.ts";
import { sanitizeFreeText, sanitizeUserString } from "../../shared/sanitize.ts";
import { optionalFreeTextSchema } from "../../shared/free-text.ts";
import { notify } from "../../shared/notifications.ts";
import { decideProfileChange, requestProfileChange, type ProfileChangeAppliers } from "./profile-changes.ts";

export const RoleConsentSchema = z.object({
  medications: z.boolean().default(true),
  bills: z.boolean().default(true),
  wallet: z.boolean().default(true),
});

export const ConsentSettingsBodySchema = z.object({
  owner: RoleConsentSchema.optional(),
  "co-caregiver": RoleConsentSchema.optional(),
  viewer: RoleConsentSchema.optional(),
});

export const CostSplitShareInputSchema = z.object({
  caregiverId: z.string().min(1),
  caregiverName: z.string().min(1),
  amount: z.number().positive(),
  status: z.enum(["owed", "settled"]).optional(),
  settledAt: z.string().optional(),
  settledBy: z.string().optional(),
});

export const CreateCostSplitBodySchema = z.object({
  transactionId: z.string().min(1),
  totalAmount: z.number().positive(),
  payerId: z.string().optional(),
  payerName: z.string().optional(),
  description: z.string().optional(),
  shares: z.array(CostSplitShareInputSchema).min(1),
});

export const SettleCostSplitShareBodySchema = z.object({
  contributorId: z.string().min(1),
});

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    list[parts.shift()!.trim()] = decodeURIComponent(parts.join("="));
  });
  return list;
}

/**
 * Who is calling (#1179). The operator holding CAREGIVER_TOKEN keeps full
 * access, so existing single-caregiver deployments behave as before. A linked
 * caregiver authenticates with the access token issued when they accepted an
 * invite, and is limited to that recipient and role.
 */
export type CaregiverPrincipal =
  | { kind: "admin" }
  | { kind: "caregiver"; link: RecipientCaregiver };

function principalOf(res: Response): CaregiverPrincipal {
  return res.locals.principal as CaregiverPrincipal;
}

export function authenticateCaregiver(store: CareRecipientsStore, caregiverToken: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    const auth = req.headers.authorization;
    let token: string | undefined;

    if (auth?.startsWith("Bearer ")) {
      token = auth.slice("Bearer ".length);
    } else {
      const cookies = parseCookies(req.headers.cookie);
      token = cookies["caregiver_token"];

      if (token) {
        const csrfHeader = req.headers["x-csrf-token"];
        const csrfCookie = cookies["csrf_token"];
        if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
          res.status(403).json({ error: "CSRF token mismatch or missing" });
          return;
        }
      }
    }

    if (!token) {
      res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ error: "Missing caregiver token" });
      return;
    }
    if (token === caregiverToken) {
      res.locals.principal = { kind: "admin" } satisfies CaregiverPrincipal;
      next();
      return;
    }
    const link = store.authenticateCaregiver(token);
    if (!link) {
      res.status(403).json({ error: "Invalid caregiver token" });
      return;
    }
    res.locals.principal = { kind: "caregiver", link } satisfies CaregiverPrincipal;
    next();
  };
}

/**
 * Gates /recipients/:id/... by role. A caregiver who is not linked to the
 * recipient gets 404 rather than 403, so recipient ids are not disclosed.
 */
function requirePermission(store: CareRecipientsStore, permission: CaregiverPermission) {
  return function (req: Request<Record<string, string>>, res: Response, next: NextFunction) {
    const principal = principalOf(res);
    const recipientId = req.params.id;
    const linked =
      principal.kind === "admin"
        ? store.getById(recipientId) !== undefined
        : principal.link.recipient_id === recipientId;
    if (!linked) {
      res.status(404).json({ error: "Care recipient not found" });
      return;
    }
    if (principal.kind === "caregiver" && !roleHasPermission(principal.link.role, permission)) {
      res.status(403).json({ error: `The ${principal.link.role} role does not have ${permission} permission for this care recipient` });
      return;
    }
    next();
  };
}

const ACCESS_ERROR_STATUS: Record<CaregiverAccessErrorCode, number> = {
  recipient_not_found: 404,
  already_linked: 409,
  invite_invalid: 404,
  invite_expired: 410,
  last_owner: 409,
};

function sendAccessError(err: unknown, res: Response): void {
  if (!(err instanceof CaregiverAccessError)) throw err;
  res.status(ACCESS_ERROR_STATUS[err.code]).json({ error: err.message, code: err.code });
}

const InviteBodySchema = z.object({
  email: z.email().max(254),
  role: z.enum(CAREGIVER_ROLES),
});

const AcceptInviteBodySchema = z.object({
  token: z.string().min(1).max(128),
  display_name: optionalFreeTextSchema("display_name"),
});

const HandoffNoteBodySchema = z.object({
  text: z
    .string({ error: "text is required" })
    .transform(sanitizeFreeText)
    .pipe(
      z
        .string()
        .min(1, "text is required")
        .max(HANDOFF_NOTE_MAX_LENGTH, `text must be at most ${HANDOFF_NOTE_MAX_LENGTH} characters`),
    ),
  author: optionalFreeTextSchema("author"),
});

const HandoffNotesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Who made a request, for the audit log: the linked caregiver, or the operator. */
function actorOf(principal: CaregiverPrincipal): string {
  if (principal.kind === "caregiver") {
    return principal.link.email ?? principal.link.caregiver_user_id;
  }
  return "owner";
}

/** Display name for a note author: the caller's identity, never client input. */
function authorOf(principal: CaregiverPrincipal, requestedAuthor: string | undefined): string {
  if (principal.kind === "caregiver") {
    const { display_name, email, caregiver_user_id } = principal.link;
    return display_name ?? email ?? caregiver_user_id;
  }
  // The shared operator token carries no identity, so the dashboard names the
  // signed-in caregiver profile explicitly.
  return sanitizeUserString(requestedAuthor) || "Caregiver";
}

/**
 * Care recipients routes, extracted from server.ts (Issue #791) so they
 * can be exercised via supertest against a real CareRecipientsStore without
 * booting the full unified server (Sentry/Stellar/LLM/agent runtime).
 * Extended with role-based caregiver access (#1179) and shift handoff
 * notes (#1180).
 */
export function createCareRecipientsRouter(
  store: CareRecipientsStore,
  caregiverToken: string,
  appliers: ProfileChangeAppliers = {},
): Router {
  const router = Router();
  const auth = authenticateCaregiver(store, caregiverToken);
  const canView = requirePermission(store, "view");
  const canAct = requirePermission(store, "act");
  const canManage = requirePermission(store, "manage");
  // GDPR data export (Issue #1225) is expensive, so it is rate limited.
  const exportRateLimiter = createRateLimiter(
    "recipient-export",
    10,
    15 * 60 * 1000,
    { error: "Too many export requests, please try again later." },
  );

  router.get("/recipients", auth, (_req, res) => {
    const principal = principalOf(res);
    if (principal.kind === "admin") {
      res.json(store.list());
      return;
    }
    const recipient = store.getById(principal.link.recipient_id);
    res.json(recipient ? [recipient] : []);
  });

  router.post("/recipients", auth, (req, res) => {
    if (principalOf(res).kind !== "admin") {
      res.status(403).json({ error: "Caregiver accounts cannot create care recipients" });
      return;
    }
    const body = req.body as Partial<CareRecipientEntity>;
    if (!body?.name || typeof body.name !== "string" || !body.name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const created = store.create({
      name: body.name.trim(),
      age: typeof body.age === "number" ? body.age : null,
      medications: Array.isArray(body.medications) ? body.medications : [],
      primary_doctor: typeof body.primary_doctor === "string" ? body.primary_doctor : null,
      insurance: typeof body.insurance === "string" ? body.insurance : null,
    });
    registerKnownNames([created.name]);
    res.status(201).json(created);
  });

  // Handler for full recipient data takeout (Issue #1225)
  const handleExport = async (req: Request, res: Response) => {
    const recipientId = (req.params.id || (req.query.recipient_id as string) || (req.query.id as string) || "rosa").trim();
    
    // Resolve recipient entity from store or fallback
    let entity = store.getById(recipientId);
    if (!entity) {
      const all = store.list();
      entity = all.find(
        (r) => r.id.toLowerCase() === recipientId.toLowerCase() ||
               r.name.toLowerCase() === recipientId.toLowerCase()
      );
    }

    const cleanId = entity ? entity.id : recipientId;
    let recipientDir = join(DATA_DIR, "recipients", cleanId);
    if (!existsSync(recipientDir) && existsSync(join(DATA_DIR, "recipients", recipientId))) {
      recipientDir = join(DATA_DIR, "recipients", recipientId);
    }

    if (!entity) {
      if (existsSync(recipientDir)) {
        entity = {
          id: cleanId,
          name: cleanId.replace(/_/g, " "),
          age: null,
          medications: [],
          primary_doctor: null,
          insurance: null,
          caregiver_user_id: null,
        };
      } else {
        res.status(404).json({ error: `Care recipient '${recipientId}' not found` });
        return;
      }
    }

    // 1. Clean Recipient Info (strip internal DB fields such as caregiver_user_id)
    const cleanRecipient = {
      id: entity.id,
      name: entity.name,
      age: entity.age ?? null,
      primaryDoctor: entity.primary_doctor ?? null,
      insurance: entity.insurance ?? null,
    };

    // 2. Medications with dosage change history
    const cleanMedications = (entity.medications || []).map((medName) => {
      const history = getMedicationHistory(cleanId, medName);
      return {
        name: medName,
        dosage: history.length > 0 ? history[0].newDosage : "standard",
        frequency: history.length > 0 ? history[0].newFrequency : "daily",
        dosageHistory: history.map((h) => ({
          previousDosage: h.previousDosage,
          previousFrequency: h.previousFrequency,
          newDosage: h.newDosage,
          newFrequency: h.newFrequency,
          changedAt: h.changedAt,
          reason: h.reason,
          prescriber: h.prescriber,
        })),
      };
    });

    // 3. Spending Policy
    let cleanPolicy = {
      dailyLimit: 100,
      monthlyLimit: 800,
      medicationMonthlyBudget: 300,
      billMonthlyBudget: 500,
      approvalThreshold: 75,
      holdTimeSeconds: 86400,
      timezone: "America/Phoenix",
    };
    const policyFile = join(recipientDir, "policy.json");
    if (existsSync(policyFile)) {
      try {
        const rawPolicy = JSON.parse(readFileSync(policyFile, "utf-8"));
        cleanPolicy = { ...cleanPolicy, ...rawPolicy };
      } catch {
        // Fall back to clean defaults
      }
    }

    // 4. Transactions (strip internal lock tokens, system file paths, or extraction errors)
    let cleanTransactions: any[] = [];
    const txFile = join(recipientDir, "transactions.jsonl");
    if (existsSync(txFile)) {
      try {
        const content = readFileSync(txFile, "utf-8");
        cleanTransactions = content
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const raw = JSON.parse(line);
            return {
              id: raw.id,
              timestamp: raw.timestamp,
              type: raw.type,
              description: raw.description,
              amount: raw.amount,
              recipient: raw.recipient,
              stellarTxHash: raw.stellarTxHash,
              status: raw.status,
              category: raw.category,
            };
          });
      } catch {
        cleanTransactions = [];
      }
    }

    // 5. Orders
    let cleanOrders: any[] = [];
    const ordersFile = join(recipientDir, "orders.json");
    const globalOrdersFile = join(DATA_DIR, "orders.json");
    const targetOrdersFile = existsSync(ordersFile) ? ordersFile : globalOrdersFile;
    if (existsSync(targetOrdersFile)) {
      try {
        const rawOrders = JSON.parse(readFileSync(targetOrdersFile, "utf-8"));
        if (Array.isArray(rawOrders)) {
          cleanOrders = rawOrders.map((o: any) => ({
            orderId: o.orderId || o.id,
            drug: o.drug,
            pharmacy: o.pharmacy,
            amount: o.amount,
            status: o.status || "completed",
            createdAt: o.createdAt || o.timestamp,
            stellarTxHash: o.stellarTxHash,
          }));
        }
      } catch {
        cleanOrders = [];
      }
    }

    // 6. Documented Allergies
    const allergiesList = loadRecipientAllergies(cleanId).map((a) => ({
      substance: a.substance,
      severity: a.severity,
      reaction: a.reaction,
      notes: a.notes,
      createdAt: a.createdAt,
    }));

    // 7. Adherence Records
    const adherenceList = (await readAdherenceRecords())
      .filter((r) => r.recipientId === cleanId)
      .map((r) => ({
        drug: r.drug,
        dosage: r.dosage,
        pharmacy: r.pharmacy,
        dueDate: r.dueDate,
        status: r.status,
        confirmedAt: r.confirmedAt,
      }));

    // 8. Recipient Notes
    let notesList: any[] = [];
    const notesFile = join(recipientDir, "notes.json");
    if (existsSync(notesFile)) {
      try {
        const rawNotes = JSON.parse(readFileSync(notesFile, "utf-8"));
        if (Array.isArray(rawNotes)) {
          notesList = rawNotes.map((n: any) => ({
            id: n.id,
            title: n.title,
            content: n.content,
            createdAt: n.createdAt,
          }));
        }
      } catch {
        notesList = [];
      }
    }

    const exportBundle = {
      exportMetadata: {
        exportedAt: new Date().toISOString(),
        version: "1.0",
        recipientId: cleanId,
        format: "CareGuard GDPR Data Takeout",
      },
      recipient: cleanRecipient,
      medications: cleanMedications,
      policy: cleanPolicy,
      transactions: cleanTransactions,
      orders: cleanOrders,
      allergies: allergiesList,
      adherence: adherenceList,
      notes: notesList,
    };

    // Log export event to tamper-evident audit log
    appendAuditEntry({
      event: "recipient.data_exported",
      actor: "caregiver",
      details: {
        recipientId: cleanId,
        recipientName: cleanRecipient.name,
        transactionsCount: cleanTransactions.length,
        medicationsCount: cleanMedications.length,
        ordersCount: cleanOrders.length,
      },
    });

    logger.info(
      { recipientId: cleanId, transactions: cleanTransactions.length },
      "[care-recipients] completed recipient data export bundle",
    );

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="careguard-export-${cleanId}-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.status(200).json(exportBundle);
  };

  router.get("/recipients/export", auth, exportRateLimiter, handleExport);
  router.get("/recipients/:id/export", auth, exportRateLimiter, handleExport);
  // ── Shared caregiver task checklist (Issue #1200) ──────────────────────────

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  router.get("/recipients/:id/tasks", auth, (req, res) => {
    if (!store.getById(req.params.id)) {
      res.status(404).json({ error: "Care recipient not found" });
      return;
    }
    res.json(store.listTasks(req.params.id));
  });

  router.post("/recipients/:id/tasks", auth, (req, res) => {
    if (!store.getById(req.params.id)) {
      res.status(404).json({ error: "Care recipient not found" });
      return;
    }
    const body = (req.body ?? {}) as { title?: unknown; assignee?: unknown; due_date?: unknown };
    if (typeof body.title !== "string" || !body.title.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (body.due_date != null && (typeof body.due_date !== "string" || !DATE_RE.test(body.due_date))) {
      res.status(400).json({ error: "due_date must be YYYY-MM-DD" });
      return;
    }
    const created = store.createTask(req.params.id, {
      title: body.title.trim().slice(0, 200),
      assignee: typeof body.assignee === "string" && body.assignee.trim() ? body.assignee.trim() : null,
      due_date: (body.due_date as string | undefined) ?? null,
    });
    res.status(201).json(created);
  });

  router.patch("/recipients/:id/tasks/:taskId", auth, (req, res) => {
    const done = (req.body as { done?: unknown } | undefined)?.done;
    if (typeof done !== "boolean") {
      res.status(400).json({ error: "done must be a boolean" });
      return;
    }
    const updated = store.setTaskDone(req.params.id, req.params.taskId, done);
    if (!updated) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(updated);
  });

  // ── Caregiver access (#1179) ───────────────────────────────────────────────

  router.get("/recipients/:id/caregivers", auth, canView, (req, res) => {
    res.json({ recipientId: req.params.id, caregivers: store.listCaregivers(req.params.id) });
  });

  router.post("/recipients/:id/caregivers/invites", auth, canManage, (req, res) => {
    const parsed = InviteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid invite", issues: parsed.error.issues });
      return;
    }
    const principal = principalOf(res);
    try {
      const { caregiver, inviteToken } = store.inviteCaregiver({
        recipientId: req.params.id,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedBy: principal.kind === "admin" ? "admin" : principal.link.caregiver_user_id,
      });
      // The code travels only in the email body (context); notify() logs the
      // title and description, which deliberately carry no secret or PHI.
      void notify({
        level: "info",
        channel: "email",
        recipientEmail: caregiver.email ?? undefined,
        title: "You've been invited to CareGuard",
        description: `You were invited as ${caregiver.role}. Redeem the invite code before it expires.`,
        context: { inviteCode: inviteToken, expiresAt: caregiver.invite_expires_at },
      });
      // Also returned once so the inviter can share it when email is not configured.
      res.status(201).json({ caregiver, inviteToken });
    } catch (err) {
      sendAccessError(err, res);
    }
  });

  router.post("/caregiver-invites/accept", (req, res) => {
    const parsed = AcceptInviteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid invite acceptance", issues: parsed.error.issues });
      return;
    }
    const displayName = sanitizeUserString(parsed.data.display_name) || undefined;
    try {
      const { caregiver, accessToken } = store.acceptInvite(parsed.data.token, displayName);
      if (displayName) registerKnownNames([displayName]);
      res.json({ caregiver, accessToken });
    } catch (err) {
      sendAccessError(err, res);
    }
  });

  // Removing a caregiver is a sensitive change (#1233): it files a request
  // that an owner approves before the link is removed. Problems that would
  // make the removal fail anyway (unknown caregiver, last owner) are still
  // reported straight away.
  router.delete("/recipients/:id/caregivers/:caregiverUserId", auth, canManage, (req, res) => {
    const link = store.getCaregiver(req.params.id, req.params.caregiverUserId);
    if (!link) {
      res.status(404).json({ error: "Caregiver not found" });
      return;
    }
    if (link.role === "owner" && link.status === "active") {
      const owners = store.listCaregivers(req.params.id).filter((c) => c.role === "owner" && c.status === "active");
      if (owners.length <= 1) {
        sendAccessError(new CaregiverAccessError("last_owner", "Cannot remove the last owner of a care recipient"), res);
        return;
      }
    }
    const name = link.display_name ?? link.email ?? link.caregiver_user_id;
    const pendingApproval = requestProfileChange(store, {
      recipientId: req.params.id,
      kind: "caregiver_removal",
      summary: `Remove ${name} (${link.role}) from this care recipient`,
      changes: [{ field: "caregiver", label: "Caregiver", before: name, after: null }],
      payload: { caregiverUserId: link.caregiver_user_id },
      requestedBy: actorOf(principalOf(res)),
    });
    res.status(202).json({ pendingApproval });
  });

  // ── Sensitive profile change approvals (#1233) ─────────────────────────────

  router.get("/recipients/:id/profile-changes", auth, canView, (req, res) => {
    const status = req.query.status;
    const filter = status === "pending" || status === "approved" || status === "rejected" ? status : undefined;
    res.json({ requests: store.listProfileChangeRequests(req.params.id, filter) });
  });

  // Only owners hold the manage permission, so only they can decide.
  for (const [path, decision] of [["approve", "approved"], ["reject", "rejected"]] as const) {
    router.post(`/recipients/:id/profile-changes/:changeId/${path}`, auth, canManage, (req, res) => {
      const note = sanitizeUserString(req.body?.note) || undefined;
      const result = decideProfileChange(store, appliers, {
        id: req.params.changeId,
        recipientId: req.params.id,
        decision,
        actor: actorOf(principalOf(res)),
        note,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ request: result.request });
    });
  }

  // ── Shift handoff notes (#1180) ────────────────────────────────────────────

  router.get("/recipients/:id/handoff-notes", auth, canView, (req, res) => {
    const parsed = HandoffNotesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
      return;
    }
    res.json({
      recipientId: req.params.id,
      notes: store.listHandoffNotes(req.params.id, parsed.data.limit),
    });
  });

  router.post("/recipients/:id/handoff-notes", auth, canAct, (req, res) => {
    const parsed = HandoffNoteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid handoff note", issues: parsed.error.issues });
      return;
    }
    const note = store.addHandoffNote({
      recipient_id: req.params.id,
      author: authorOf(principalOf(res), parsed.data.author),
      text: parsed.data.text,
    });
    res.status(201).json(note);
  });

  // ── Granular Data-Sharing Consent (#1218) ───────────────────────────────────

  router.get("/recipients/:id/consent", auth, canView, (req, res) => {
    res.json({
      recipient_id: req.params.id,
      consent: store.getConsent(req.params.id),
    });
  });

  router.put("/recipients/:id/consent", auth, canManage, (req, res) => {
    const parsed = ConsentSettingsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid consent settings", issues: parsed.error.issues });
      return;
    }
    const principal = principalOf(res);
    const updatedBy = authorOf(principal, undefined);
    const updated = store.updateConsent(req.params.id, parsed.data as ConsentSettings, updatedBy);
    res.json({
      recipient_id: req.params.id,
      consent: updated,
    });
  });

  // ── Cost Splitting Ledger (#1220) ──────────────────────────────────────────

  router.get("/recipients/:id/cost-splits", auth, canView, (req, res) => {
    res.json({
      recipient_id: req.params.id,
      splits: store.listCostSplits(req.params.id),
    });
  });

  router.post("/recipients/:id/cost-splits", auth, canAct, (req, res) => {
    const parsed = CreateCostSplitBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid cost split payload", issues: parsed.error.issues });
      return;
    }
    const principal = principalOf(res);
    const defaultPayer = authorOf(principal, undefined);
    const split = store.createCostSplit({
      recipientId: req.params.id,
      transactionId: parsed.data.transactionId,
      totalAmount: parsed.data.totalAmount,
      payerId: parsed.data.payerId || (principal.kind === "caregiver" ? principal.link.caregiver_user_id : "admin"),
      payerName: parsed.data.payerName || defaultPayer,
      description: parsed.data.description,
      shares: parsed.data.shares,
    });
    res.status(201).json(split);
  });

  router.get("/recipients/:id/cost-splits/balances", auth, canView, (req, res) => {
    res.json({
      recipient_id: req.params.id,
      summary: store.getContributorBalances(req.params.id),
    });
  });

  router.post("/recipients/:id/cost-splits/:splitId/settle", auth, canAct, (req, res) => {
    const parsed = SettleCostSplitShareBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid settlement payload", issues: parsed.error.issues });
      return;
    }
    const principal = principalOf(res);
    const settledBy = authorOf(principal, undefined);
    try {
      const updated = store.settleCostSplitShare(req.params.splitId, parsed.data.contributorId, settledBy);
      res.json(updated);
    } catch (err: any) {
      res.status(404).json({ error: err?.message || "Cost split not found" });
    }
  });

  return router;
}

