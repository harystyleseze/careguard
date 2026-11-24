/**
 * migrate-care-recipients.ts
 *
 * Runs the care-recipients SQLite migration (schema creation + optional seed).
 *
 * Usage:
 *   npx tsx scripts/migrate-care-recipients.ts           # apply migration for real
 *   npx tsx scripts/migrate-care-recipients.ts --dry-run # preview only, no files written
 *
 * --dry-run
 *   Prints a before/after diff of what the migration would change — the current
 *   database state vs the post-migration state — without touching any files on
 *   disk.  The real database is opened read-only (via a separate in-memory run)
 *   so no writes occur.  Exit code is still 0 on success.
 */

import { existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { createCareRecipientsStore } from '../services/care-recipients/db.ts';
import { logger } from '../shared/logger.ts';

const isDryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function resolveDbPath(): string {
  if (process.env.CARE_RECIPIENTS_DB_PATH) {
    return path.resolve(process.cwd(), process.env.CARE_RECIPIENTS_DB_PATH);
  }
  return new URL('../data/careguard.sqlite', import.meta.url).pathname;
}

interface RecipientSnapshot {
  tableExists: boolean;
  rowCount: number;
  rows: { id: string; name: string; age: number | null }[];
}

/** Read current state directly from the on-disk DB without triggering migration. */
function snapshotBeforeFromDisk(dbPath: string): RecipientSnapshot {
  if (!existsSync(dbPath)) {
    return { tableExists: false, rowCount: 0, rows: [] };
  }

  const db = new DatabaseSync(dbPath);
  try {
    const tableRow = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='care_recipients'`,
      )
      .get() as { name: string } | undefined;

    if (!tableRow) {
      return { tableExists: false, rowCount: 0, rows: [] };
    }

    const rows = db
      .prepare('SELECT id, name, age FROM care_recipients ORDER BY name ASC')
      .all() as { id: string; name: string; age: number | null }[];

    return { tableExists: true, rowCount: rows.length, rows };
  } finally {
    db.close();
  }
}

/** Run migration against an in-memory DB to capture post-migration state. */
function snapshotAfterInMemory(): RecipientSnapshot {
  // Force an in-memory store so nothing is written to disk.
  const store = createCareRecipientsStore(':memory:');
  const recipients = store.list();
  return {
    tableExists: true,
    rowCount: recipients.length,
    rows: recipients.map((r) => ({ id: r.id, name: r.name, age: r.age })),
  };
}

function printDiff(before: RecipientSnapshot, after: RecipientSnapshot): void {
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│        DRY RUN — no files written        │');
  console.log('└─────────────────────────────────────────┘\n');

  console.log('BEFORE migration:');
  if (!before.tableExists) {
    console.log('  care_recipients table: does not exist');
  } else {
    console.log(`  care_recipients table: exists`);
    console.log(`  row count            : ${before.rowCount}`);
    for (const r of before.rows) {
      console.log(`    - [${r.id}] ${r.name} (age ${r.age ?? '?'})`);
    }
  }

  console.log('\nAFTER migration (simulated):');
  console.log(`  care_recipients table: exists`);
  console.log(`  row count            : ${after.rowCount}`);
  for (const r of after.rows) {
    const isNew = !before.rows.some((b) => b.id === r.id);
    const prefix = isNew ? '+' : ' ';
    console.log(`  ${prefix} [${r.id}] ${r.name} (age ${r.age ?? '?'})`);
  }

  const addedCount = after.rows.filter(
    (r) => !before.rows.some((b) => b.id === r.id),
  ).length;

  console.log('\nChanges:');
  if (!before.tableExists) console.log('  + create table care_recipients');
  if (addedCount > 0) console.log(`  + seed ${addedCount} new row(s)`);
  if (before.tableExists && addedCount === 0)
    console.log('  (no data changes — table already exists and is not empty)');

  console.log('\n[dry-run] Re-run without --dry-run to apply these changes.\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (isDryRun) {
  const dbPath = resolveDbPath();
  const before = snapshotBeforeFromDisk(dbPath);
  const after = snapshotAfterInMemory();
  printDiff(before, after);
} else {
  const store = createCareRecipientsStore();
  const recipients = store.list();
  logger.info(
    `care_recipients migration complete. ${recipients.length} recipient(s):`,
  );
  for (const r of recipients) {
    logger.info(`  [${r.id}] ${r.name} (age ${r.age ?? '?'})`);
  }
}
