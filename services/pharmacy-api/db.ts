import { mkdirSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { logger } from "../../shared/logger.ts";
import { PHARMACY_SEED_DATA, type PharmacySeedData } from "./seed.ts";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export interface PharmacyRecord {
  id: string;
  name: string;
  distanceMiles: number;
}

export interface DrugRecord {
  name: string;
  displayName: string;
  defaultDosage: string | null;
}

export interface PharmacyPriceRecord {
  drug: string;
  displayName: string;
  pharmacyId: string;
  pharmacy: string;
  price: number;
  distanceMiles: number;
}

export interface PharmacyPricingStoreOptions {
  dbPath?: string;
  seedData?: PharmacySeedData;
}

function normalizeDrugName(drugName: string) {
  return drugName.trim().toLowerCase();
}

function normalizePharmacyId(pharmacyId: string) {
  return pharmacyId.trim().toLowerCase();
}

function defaultDbPath() {
  if (process.env.PHARMACY_DB_PATH) {
    return path.resolve(process.cwd(), process.env.PHARMACY_DB_PATH);
  }

  if (process.env.NODE_ENV === "test") {
    return ":memory:";
  }

  return new URL("../../data/pharmacy-pricing.sqlite", import.meta.url).pathname;
}

export class PharmacyPricingStore {
  private readonly db: DatabaseSync;

  constructor(options: PharmacyPricingStoreOptions = {}) {
    const dbPath = options.dbPath ?? defaultDbPath();
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.seedIfEmpty(options.seedData ?? PHARMACY_SEED_DATA);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pharmacies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        distance_miles REAL NOT NULL CHECK (distance_miles >= 0)
      );

      CREATE TABLE IF NOT EXISTS drugs (
        name TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        default_dosage TEXT
      );

      CREATE TABLE IF NOT EXISTS prices (
        drug_name TEXT NOT NULL REFERENCES drugs(name) ON DELETE CASCADE,
        pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
        price REAL NOT NULL CHECK (price > 0),
        PRIMARY KEY (drug_name, pharmacy_id)
      );

      CREATE INDEX IF NOT EXISTS idx_prices_drug_name ON prices(drug_name);
      CREATE INDEX IF NOT EXISTS idx_prices_pharmacy_id ON prices(pharmacy_id);
    `);
  }

  private seedIfEmpty(seedData: PharmacySeedData) {
    const existing = this.db
      .prepare("SELECT COUNT(*) AS count FROM drugs")
      .get() as { count: number };

    if (Number(existing.count) > 0) {
      return;
    }

    this.db.exec("BEGIN");

    try {
      const insertPharmacy = this.db.prepare(`
        INSERT INTO pharmacies (id, name, distance_miles)
        VALUES (?, ?, ?)
      `);
      const insertDrug = this.db.prepare(`
        INSERT INTO drugs (name, display_name, default_dosage)
        VALUES (?, ?, ?)
      `);
      const insertPrice = this.db.prepare(`
        INSERT INTO prices (drug_name, pharmacy_id, price)
        VALUES (?, ?, ?)
      `);

      for (const pharmacy of seedData.pharmacies) {
        insertPharmacy.run(
          normalizePharmacyId(pharmacy.id),
          pharmacy.name.trim(),
          pharmacy.distanceMiles,
        );
      }

      for (const drug of seedData.drugs) {
        insertDrug.run(
          normalizeDrugName(drug.name),
          drug.displayName.trim(),
          drug.defaultDosage?.trim() || null,
        );
      }

      for (const price of seedData.prices) {
        insertPrice.run(
          normalizeDrugName(price.drug),
          normalizePharmacyId(price.pharmacyId),
          price.price,
        );
      }

      this.db.exec("COMMIT");
      logger.info(
        {
          drugCount: seedData.drugs.length,
          pharmacyCount: seedData.pharmacies.length,
        },
        "Seeded pharmacy pricing database",
      );
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  getDrugCount() {
    const result = this.db
      .prepare("SELECT COUNT(*) AS count FROM drugs")
      .get() as { count: number };

    return Number(result.count);
  }

  listDrugs(): DrugRecord[] {
    return this.db
      .prepare(`
        SELECT
          name,
          display_name AS displayName,
          default_dosage AS defaultDosage
        FROM drugs
        ORDER BY display_name ASC
      `)
      .all() as unknown as DrugRecord[];
  }

  upsertDrug(input: {
    name: string;
    displayName?: string;
    defaultDosage?: string | null;
  }): DrugRecord {
    const name = normalizeDrugName(input.name);
    const displayName = input.displayName?.trim() || toDisplayName(name);
    const defaultDosage = input.defaultDosage?.trim() || null;

    this.db
      .prepare(`
        INSERT INTO drugs (name, display_name, default_dosage)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          display_name = excluded.display_name,
          default_dosage = excluded.default_dosage
      `)
      .run(name, displayName, defaultDosage);

    return {
      name,
      displayName,
      defaultDosage,
    };
  }

  deleteDrug(name: string) {
    const result = this.db
      .prepare("DELETE FROM drugs WHERE name = ?")
      .run(normalizeDrugName(name));

    return Number(result.changes) > 0;
  }

  listPharmacies(): PharmacyRecord[] {
    return this.db
      .prepare(`
        SELECT
          id,
          name,
          distance_miles AS distanceMiles
        FROM pharmacies
        ORDER BY name ASC
      `)
      .all() as unknown as PharmacyRecord[];
  }

  upsertPharmacy(input: PharmacyRecord): PharmacyRecord {
    const id = normalizePharmacyId(input.id);
    const name = input.name.trim();
    const distanceMiles = input.distanceMiles;

    this.db
      .prepare(`
        INSERT INTO pharmacies (id, name, distance_miles)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          distance_miles = excluded.distance_miles
      `)
      .run(id, name, distanceMiles);

    return {
      id,
      name,
      distanceMiles,
    };
  }

  deletePharmacy(pharmacyId: string) {
    const result = this.db
      .prepare("DELETE FROM pharmacies WHERE id = ?")
      .run(normalizePharmacyId(pharmacyId));

    return Number(result.changes) > 0;
  }

  getPrices(drugName: string): PharmacyPriceRecord[] {
    const normalizedDrugName = normalizeDrugName(drugName);
    const rows = this.db
      .prepare(`
        SELECT
          d.name AS drug,
          d.display_name AS displayName,
          p.id AS pharmacyId,
          p.name AS pharmacy,
          p.distance_miles AS distanceMiles,
          pr.price AS price
        FROM prices pr
        INNER JOIN drugs d ON d.name = pr.drug_name
        INNER JOIN pharmacies p ON p.id = pr.pharmacy_id
        WHERE d.name = ?
        ORDER BY pr.price ASC, p.name ASC
      `)
      .all(normalizedDrugName) as unknown as PharmacyPriceRecord[];

    if (rows.length === 0) {
      throw new Error(`Drug not found: ${drugName}`);
    }

    return rows.map((row) => ({
      drug: row.drug,
      displayName: row.displayName,
      pharmacyId: row.pharmacyId,
      pharmacy: row.pharmacy,
      price: Number(row.price),
      distanceMiles: Number(row.distanceMiles),
    }));
  }

  upsertPrice(input: {
    drug: string;
    pharmacyId: string;
    price: number;
  }): PharmacyPriceRecord {
    const drug = normalizeDrugName(input.drug);
    const pharmacyId = normalizePharmacyId(input.pharmacyId);

    const drugExists = this.db
      .prepare("SELECT 1 AS found FROM drugs WHERE name = ?")
      .get(drug) as { found?: number } | undefined;
    if (!drugExists?.found) {
      throw new Error(`Drug not found: ${input.drug}`);
    }

    const pharmacyExists = this.db
      .prepare("SELECT 1 AS found FROM pharmacies WHERE id = ?")
      .get(pharmacyId) as { found?: number } | undefined;
    if (!pharmacyExists?.found) {
      throw new Error(`Pharmacy not found: ${input.pharmacyId}`);
    }

    this.db
      .prepare(`
        INSERT INTO prices (drug_name, pharmacy_id, price)
        VALUES (?, ?, ?)
        ON CONFLICT(drug_name, pharmacy_id) DO UPDATE SET
          price = excluded.price
      `)
      .run(drug, pharmacyId, input.price);

    return this.db
      .prepare(`
        SELECT
          d.name AS drug,
          d.display_name AS displayName,
          p.id AS pharmacyId,
          p.name AS pharmacy,
          p.distance_miles AS distanceMiles,
          pr.price AS price
        FROM prices pr
        INNER JOIN drugs d ON d.name = pr.drug_name
        INNER JOIN pharmacies p ON p.id = pr.pharmacy_id
        WHERE pr.drug_name = ? AND pr.pharmacy_id = ?
      `)
      .get(drug, pharmacyId) as unknown as PharmacyPriceRecord;
  }
}

export function createPharmacyPricingStore(
  options?: PharmacyPricingStoreOptions,
) {
  return new PharmacyPricingStore(options);
}

export function toDisplayName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) =>
      word.length === 0
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}
