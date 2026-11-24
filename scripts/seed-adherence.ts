#!/usr/bin/env node
/**
 * Generate synthetic medication adherence records for local testing.
 *
 * Usage:
 *   node --import tsx scripts/seed-adherence.ts --recipient <id> [--days N]
 *
 * Produces N days of adherence records for the given recipient. Output format
 * matches what the agent/tools and dashboard consume for adherence data.
 * Errors clearly if the target recipient file does not exist.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { logger } from '../shared/logger.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const RECIPIENTS_DIR = path.join(DATA_DIR, 'recipients');

interface AdherenceRecord {
  recipient_id: string;
  medication: string;
  date: string;
  scheduled_time: string;
  taken: boolean;
  taken_at: string | null;
  missed_reason: string | null;
  pharmacy_id: string | null;
}

const MISSED_REASONS = [
  'Forgot',
  'Felt better, stopped taking',
  'Side effects',
  'Ran out of medication',
  'Could not afford refill',
  'Doctor advised to skip',
  'Nausea',
  'Dizziness',
];

const SCHEDULE_TIMES = ['08:00', '12:00', '20:00'];

function parseArgs(): { recipientId: string; days: number } {
  const args = process.argv.slice(2);
  let recipientId = '';
  let days = 30;

  const recipientIdx = args.indexOf('--recipient');
  if (recipientIdx !== -1 && args[recipientIdx + 1]) {
    recipientId = args[recipientIdx + 1];
  }

  const daysIdx = args.indexOf('--days');
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    const n = parseInt(args[daysIdx + 1], 10);
    if (Number.isFinite(n) && n > 0) days = n;
  }

  return { recipientId, days };
}

function main() {
  const { recipientId, days } = parseArgs();

  if (!recipientId) {
    logger.error('Error: --recipient <id> is required');
    logger.error('Usage: node --import tsx scripts/seed-adherence.ts --recipient rosa_garcia --days 30');
    process.exit(1);
  }

  // Check if recipient exists in the database
  const dbPath = path.resolve(process.cwd(), 'data/careguard.sqlite');
  if (!existsSync(dbPath)) {
    logger.error(`Error: Database not found at ${dbPath}`);
    logger.error('Run "node --import tsx scripts/migrate-care-recipients.ts" first.');
    process.exit(1);
  }

  // Simple check: look for recipient directory or query the database
  const recipientDir = path.join(RECIPIENTS_DIR, recipientId.split('_')[0]);
  const { createCareRecipientsStore } = require('../services/care-recipients/db.ts');
  const store = createCareRecipientsStore();
  const recipient = store.getById(recipientId);

  if (!recipient) {
    logger.error(`Error: Recipient "${recipientId}" not found in database.`);
    logger.error('Available recipients:');
    const all = store.list();
    for (const r of all) {
      logger.error(`  - ${r.id} (${r.name})`);
    }
    process.exit(1);
  }

  logger.info(`Generating ${days} days of adherence records for ${recipient.name}...`);

  // Ensure output directory exists
  const outputDir = path.join(RECIPIENTS_DIR, recipientId.split('_')[0]);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const records: AdherenceRecord[] = [];
  const now = new Date();

  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split('T')[0];

    // Each medication gets 1-2 scheduled doses per day
    for (const medication of recipient.medications) {
      const doseCount = Math.random() < 0.3 ? 2 : 1; // 30% of meds are twice-daily
      const times = SCHEDULE_TIMES.slice(0, doseCount);

      for (const time of times) {
        // 85% adherence rate (realistic for elderly patients)
        const taken = Math.random() < 0.85;
        const takenAt = taken
          ? `${dateStr}T${time}:${String(Math.floor(Math.random() * 30)).padStart(2, '0')}:00Z`
          : null;
        const missedReason = !taken ? MISSED_REASONS[Math.floor(Math.random() * MISSED_REASONS.length)] : null;

        records.push({
          recipient_id: recipientId,
          medication,
          date: dateStr,
          scheduled_time: time,
          taken,
          taken_at: takenAt,
          missed_reason: missedReason,
          pharmacy_id: null,
        });
      }
    }
  }

  const outputFile = path.join(outputDir, 'adherence.json');
  writeFileSync(outputFile, JSON.stringify(records, null, 2));
  logger.info(`Wrote ${records.length} adherence records to ${outputFile}`);

  // Summary
  const taken = records.filter(r => r.taken).length;
  const missed = records.length - taken;
  const adherenceRate = ((taken / records.length) * 100).toFixed(1);
  logger.info(`  Taken: ${taken} | Missed: ${missed} | Adherence rate: ${adherenceRate}%`);
}

main();
