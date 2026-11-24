/**
 * inspect-pharmacy-db.ts
 *
 * Prints a human-readable summary of the local pharmacy pricing SQLite DB.
 * Opens PHARMACY_DB_PATH (or the default data/pharmacy-pricing.sqlite) without
 * running migrations or seeding — read-only inspection only.
 *
 * Usage:
 *   npx tsx scripts/inspect-pharmacy-db.ts                    # full summary
 *   npx tsx scripts/inspect-pharmacy-db.ts --drug lisinopril  # filter by drug
 *   npx tsx scripts/inspect-pharmacy-db.ts --drug atorvastatin
 */

import { existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

// ---------------------------------------------------------------------------
// Resolve DB path (mirrors logic in services/pharmacy-api/db.ts)
// ---------------------------------------------------------------------------

function resolveDbPath(): string {
  if (process.env.PHARMACY_DB_PATH) {
    return path.resolve(process.cwd(), process.env.PHARMACY_DB_PATH);
  }
  return new URL('../data/pharmacy-pricing.sqlite', import.meta.url).pathname;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseDrugFilter(): string | null {
  const idx = process.argv.indexOf('--drug');
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith('--')) {
    console.error('error: --drug requires a value, e.g. --drug lisinopril');
    process.exit(1);
  }
  return val.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Table printing helpers
// ---------------------------------------------------------------------------

function col(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width - 1) + '…' : value.padEnd(width);
}

function printPharmacies(rows: { id: string; name: string; distance_miles: number }[]): void {
  console.log('\nPharmacies');
  console.log('─'.repeat(52));
  console.log(`${col('ID', 18)} ${col('Name', 22)} ${'Distance'}`);
  console.log('─'.repeat(52));
  for (const r of rows) {
    console.log(`${col(r.id, 18)} ${col(r.name, 22)} ${r.distance_miles.toFixed(1)} mi`);
  }
  console.log(`\n${rows.length} pharmacy(ies)\n`);
}

function printPrices(
  rows: { drug: string; display_name: string; pharmacy: string; price: number; distance_miles: number }[],
  drugFilter: string | null,
): void {
  const label = drugFilter ? `Prices for "${drugFilter}"` : 'All prices (sorted by drug, then price)';
  console.log(`\n${label}`);
  console.log('─'.repeat(72));
  console.log(
    `${col('Drug', 16)} ${col('Display name', 18)} ${col('Pharmacy', 20)} ${'Price'.padStart(8)}  Distance`,
  );
  console.log('─'.repeat(72));

  if (rows.length === 0) {
    console.log(`  (no results — drug name is case-insensitive, e.g. --drug lisinopril)`);
  }

  for (const r of rows) {
    console.log(
      `${col(r.drug, 16)} ${col(r.display_name, 18)} ${col(r.pharmacy, 20)} ${'$' + r.price.toFixed(2).padStart(7)}  ${r.distance_miles.toFixed(1)} mi`,
    );
  }

  if (rows.length > 0) {
    console.log(`\n${rows.length} price row(s)\n`);
  } else {
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const dbPath = resolveDbPath();
const drugFilter = parseDrugFilter();

if (!existsSync(dbPath)) {
  console.error(`\nerror: DB file not found at:\n  ${dbPath}\n`);
  console.error(
    'The pharmacy pricing DB is created automatically when the pharmacy-api service\n' +
    'starts for the first time. To create it:\n\n' +
    '  npm run pharmacy-api        # starts the service, creates + seeds the DB\n' +
    '  docker compose up server    # also initialises the DB via the unified server\n\n' +
    'To use a custom path set PHARMACY_DB_PATH in your .env:\n' +
    '  PHARMACY_DB_PATH=./data/pharmacy-pricing.sqlite\n',
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA query_only = ON');

// Summary counts
const pharmacyCount = (db.prepare('SELECT COUNT(*) AS n FROM pharmacies').get() as { n: number }).n;
const drugCount = (db.prepare('SELECT COUNT(*) AS n FROM drugs').get() as { n: number }).n;
const priceCount = (db.prepare('SELECT COUNT(*) AS n FROM prices').get() as { n: number }).n;

console.log(`\nDB: ${dbPath}`);
console.log(`    pharmacies: ${pharmacyCount}  drugs: ${drugCount}  price rows: ${priceCount}`);

// Pharmacies table (always shown)
const pharmacies = db
  .prepare('SELECT id, name, distance_miles FROM pharmacies ORDER BY name ASC')
  .all() as { id: string; name: string; distance_miles: number }[];
printPharmacies(pharmacies);

// Prices table
const priceQuery = drugFilter
  ? `SELECT pr.drug_name AS drug, d.display_name, p.name AS pharmacy, pr.price, p.distance_miles
     FROM prices pr
     JOIN drugs d ON d.name = pr.drug_name
     JOIN pharmacies p ON p.id = pr.pharmacy_id
     WHERE pr.drug_name = ?
     ORDER BY pr.price ASC`
  : `SELECT pr.drug_name AS drug, d.display_name, p.name AS pharmacy, pr.price, p.distance_miles
     FROM prices pr
     JOIN drugs d ON d.name = pr.drug_name
     JOIN pharmacies p ON p.id = pr.pharmacy_id
     ORDER BY pr.drug_name ASC, pr.price ASC`;

const priceRows = (
  drugFilter
    ? db.prepare(priceQuery).all(drugFilter)
    : db.prepare(priceQuery).all()
) as { drug: string; display_name: string; pharmacy: string; price: number; distance_miles: number }[];

printPrices(priceRows, drugFilter);

if (drugFilter && priceRows.length === 0) {
  // Show available drug names to help the contributor
  const drugs = db
    .prepare('SELECT name FROM drugs ORDER BY name ASC')
    .all() as { name: string }[];
  if (drugs.length > 0) {
    console.log('Available drugs in this DB:');
    for (const d of drugs) console.log(`  ${d.name}`);
    console.log();
  }
}

db.close();
