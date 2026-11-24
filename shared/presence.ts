/**
 * Co-Caregiver Presence & Last-Viewed Indicators (Issue #1231)
 *
 * Tracks ephemeral last-viewed indicators across dashboard tabs (approvals, bills, notifications).
 * Lightweight, non-blocking, and expires after 24 hours.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ItemPresenceEntrySchema,
  type ItemPresenceEntry,
  type ItemPresenceMap,
} from "./types.ts";
import { logger } from "./logger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "data");

/** Presence entries expire after 24 hours to keep data strictly ephemeral. */
export const PRESENCE_TTL_MS = 24 * 60 * 60 * 1000;

export function getPresenceFilePath(recipientId: string = "rosa"): string {
  const recipientDir = join(DATA_DIR, "recipients", recipientId);
  if (!existsSync(recipientDir)) {
    mkdirSync(recipientDir, { recursive: true });
  }
  return join(recipientDir, "presence.json");
}

/**
 * Loads the active presence map, pruning expired entries.
 * Time Complexity: O(K) where K is number of tracked items.
 * Space Complexity: O(K)
 */
export function loadPresenceMap(recipientId: string = "rosa"): ItemPresenceMap {
  const filePath = getPresenceFilePath(recipientId);
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const cleanMap: ItemPresenceMap = {};

    for (const [itemId, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) continue;
      const validEntries = entries
        .map((e) => {
          const res = ItemPresenceEntrySchema.safeParse(e);
          return res.success ? res.data : null;
        })
        .filter((e): e is ItemPresenceEntry => {
          if (!e) return false;
          const age = now - new Date(e.lastViewedAt).getTime();
          return age >= 0 && age < PRESENCE_TTL_MS;
        });

      if (validEntries.length > 0) {
        cleanMap[itemId] = validEntries;
      }
    }

    return cleanMap;
  } catch (err: any) {
    logger.warn({ err: err?.message, recipientId }, "failed to read presence map");
    return {};
  }
}

/**
 * Saves active presence map to disk atomically.
 */
export function savePresenceMap(
  map: ItemPresenceMap,
  recipientId: string = "rosa",
): void {
  const filePath = getPresenceFilePath(recipientId);
  writeFileSync(filePath, JSON.stringify(map, null, 2), "utf-8");
}

export interface RecordPresenceParams {
  itemId: string;
  itemType: "approval" | "bill" | "notification";
  caregiverId: string;
  caregiverName: string;
  avatar?: string;
  recipientId?: string;
}

/**
 * Records that a caregiver has viewed an item.
 * Time Complexity: O(1) entry insertion
 * Space Complexity: O(1)
 */
export function recordItemView(params: RecordPresenceParams): ItemPresenceEntry {
  const rid = params.recipientId || "rosa";
  const presenceMap = loadPresenceMap(rid);
  const nowIso = new Date().toISOString();

  const currentList = presenceMap[params.itemId] || [];
  // Filter out any previous entry for this exact caregiver so we only retain their latest view
  const remaining = currentList.filter(
    (e) => e.caregiverId !== params.caregiverId && e.caregiverName !== params.caregiverName,
  );

  const entry: ItemPresenceEntry = {
    caregiverId: params.caregiverId,
    caregiverName: params.caregiverName,
    avatar: params.avatar,
    lastViewedAt: nowIso,
  };

  remaining.push(entry);
  presenceMap[params.itemId] = remaining;
  savePresenceMap(presenceMap, rid);

  return entry;
}

/**
 * Retrieves the list of caregivers who have viewed this item recently.
 */
export function getItemPresence(
  itemId: string,
  recipientId: string = "rosa",
): ItemPresenceEntry[] {
  const map = loadPresenceMap(recipientId);
  return map[itemId] || [];
}
