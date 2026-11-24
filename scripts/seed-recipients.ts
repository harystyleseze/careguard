#!/usr/bin/env node
/**
 * Generate synthetic care-recipient seed data for local testing.
 *
 * Usage:
 *   node --import tsx scripts/seed-recipients.ts [--count N]
 *
 * Writes N recipients to the care_recipients SQLite database in data/.
 * Each recipient gets randomized name, age, medications, and pharmacy info.
 */

import { createCareRecipientsStore } from '../services/care-recipients/db.ts';
import { logger } from '../shared/logger.ts';

const FIRST_NAMES = [
  'Rosa', 'Margaret', 'Dorothy', 'Helen', 'Betty', 'Shirley', 'Virginia',
  'Thelma', 'Joyce', 'Edna', 'Ethel', 'Pearl', 'Florence', 'Gladys',
  'Marie', 'Albert', 'Harold', 'Walter', 'Howard', 'Arthur', 'Gerald',
  'Roy', 'Eugene', 'Donald', 'Raymond',
];

const LAST_NAMES = [
  'Garcia', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Moore',
  'Jackson', 'White', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker',
];

const MEDICATION_POOL = [
  'Lisinopril', 'Metformin', 'Atorvastatin', 'Amlodipine', 'Omeprazole',
  'Levothyroxine', 'Metoprolol', 'Losartan', 'Gabapentin', 'Hydrochlorothiazide',
  'Sertraline', 'Escitalopram', 'Pantoprazole', 'Rosuvastatin', 'Tamsulosin',
  'Albuterol', 'Prednisone', 'Furosemide', 'Warfarin', 'Clopidogrel',
];

const PHARMACIES = [
  'CVS Pharmacy', 'Walgreens', 'Rite Aid', 'Costco Pharmacy',
  'Walmart Pharmacy', 'Amazon Pharmacy',
];

const DOCTORS = [
  'Dr. Chen', 'Dr. Patel', 'Dr. Williams', 'Dr. Martinez', 'Dr. Kim',
  'Dr. Johnson', 'Dr. Brown', 'Dr. Davis', 'Dr. Wilson', 'Dr. Taylor',
];

const INSURANCE_PLANS = [
  'Medicare Part D', 'Medicare Advantage', 'Aetna', 'UnitedHealthcare',
  'Blue Cross Blue Shield', 'Cigna', 'Humana', 'Kaiser Permanente',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomCount<T>(arr: T[], min: number, max: number): T[] {
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function parseArgs(): number {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf('--count');
  if (countIdx !== -1 && args[countIdx + 1]) {
    const n = parseInt(args[countIdx + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 5;
}

function main() {
  const count = parseArgs();
  logger.info(`Generating ${count} synthetic care recipients...`);

  const store = createCareRecipientsStore();

  for (let i = 0; i < count; i++) {
    const firstName = pickRandom(FIRST_NAMES);
    const lastName = pickRandom(LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    const age = 65 + Math.floor(Math.random() * 25); // 65-89
    const medications = pickRandomCount(MEDICATION_POOL, 2, 6);
    const doctor = `${pickRandom(DOCTORS)}, General Hospital`;
    const insurance = pickRandom(INSURANCE_PLANS);

    const recipient = store.create({
      name,
      age,
      medications,
      primary_doctor: doctor,
      insurance,
    });

    logger.info(`  [${recipient.id}] ${recipient.name} (age ${recipient.age}) — ${recipient.medications.length} medications`);
  }

  const allRecipients = store.list();
  logger.info(`\nTotal recipients in database: ${allRecipients.length}`);
}

main();
