#!/usr/bin/env node
/**
 * Generate synthetic pharmacy order history for local dashboard testing.
 *
 * Usage:
 *   node --import tsx scripts/seed-orders.ts [--count N] [--include-blocked]
 *
 * Writes order records to data/orders.json in the shape the dashboard
 * Medications/Activity tabs expect. Does not touch real Stellar wallets
 * or make network calls.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { logger } from '../shared/logger.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const MEDICATIONS = [
  { name: 'Lisinopril', dosage: '10mg', form: 'tablet' },
  { name: 'Metformin', dosage: '500mg', form: 'tablet' },
  { name: 'Atorvastatin', dosage: '20mg', form: 'tablet' },
  { name: 'Amlodipine', dosage: '5mg', form: 'tablet' },
  { name: 'Omeprazole', dosage: '20mg', form: 'capsule' },
  { name: 'Levothyroxine', dosage: '50mcg', form: 'tablet' },
  { name: 'Metoprolol', dosage: '25mg', form: 'tablet' },
  { name: 'Gabapentin', dosage: '300mg', form: 'capsule' },
  { name: 'Sertraline', dosage: '50mg', form: 'tablet' },
  { name: 'Albuterol', dosage: '90mcg', form: 'inhaler' },
];

const PHARMACIES = [
  { name: 'CVS Pharmacy', id: 'cvs_001' },
  { name: 'Walgreens', id: 'walgreens_001' },
  { name: 'Rite Aid', id: 'riteaid_001' },
  { name: 'Costco Pharmacy', id: 'costco_001' },
  { name: 'Walmart Pharmacy', id: 'walmart_001' },
];

interface Order {
  id: string;
  recipient_id: string;
  medication: string;
  dosage: string;
  form: string;
  pharmacy_id: string;
  pharmacy_name: string;
  quantity: number;
  unit_price_usdc: number;
  total_usdc: number;
  status: 'completed' | 'blocked' | 'pending' | 'failed';
  block_reason?: string;
  created_at: string;
  filled_at: string | null;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysAgo: number): Date {
  const now = Date.now();
  const offset = Math.floor(Math.random() * daysAgo * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
}

function generateOrderId(): string {
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseArgs(): { count: number; includeBlocked: boolean } {
  const args = process.argv.slice(2);
  let count = 20;
  let includeBlocked = false;

  const countIdx = args.indexOf('--count');
  if (countIdx !== -1 && args[countIdx + 1]) {
    const n = parseInt(args[countIdx + 1], 10);
    if (Number.isFinite(n) && n > 0) count = n;
  }

  if (args.includes('--include-blocked')) {
    includeBlocked = true;
  }

  return { count, includeBlocked };
}

function main() {
  const { count, includeBlocked } = parseArgs();

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  logger.info(`Generating ${count} synthetic pharmacy orders...`);
  if (includeBlocked) {
    logger.info('  Including blocked/over-budget orders');
  }

  const orders: Order[] = [];
  const recipientIds = ['rosa_garcia']; // Default seeded recipient

  for (let i = 0; i < count; i++) {
    const med = pickRandom(MEDICATIONS);
    const pharmacy = pickRandom(PHARMACIES);
    const quantity = Math.floor(Math.random() * 3) + 1; // 1-3 months supply
    const unitPrice = parseFloat((Math.random() * 50 + 5).toFixed(2)); // $5-$55
    const total = parseFloat((unitPrice * quantity).toFixed(2));

    // Determine status
    let status: Order['status'] = 'completed';
    let blockReason: string | undefined;

    if (includeBlocked && Math.random() < 0.15) {
      status = 'blocked';
      blockReason = pickRandom([
        'Exceeds daily spending limit',
        'Exceeds monthly budget for this category',
        'Requires caregiver approval for amount over $100',
        'Duplicate order detected within 7 days',
      ]);
    } else if (Math.random() < 0.05) {
      status = 'pending';
    }

    const createdAt = randomDate(90); // Last 90 days
    const filledAt = status === 'completed'
      ? new Date(createdAt.getTime() + Math.random() * 3 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const order: Order = {
      id: generateOrderId(),
      recipient_id: pickRandom(recipientIds),
      medication: med.name,
      dosage: med.dosage,
      form: med.form,
      pharmacy_id: pharmacy.id,
      pharmacy_name: pharmacy.name,
      quantity,
      unit_price_usdc: unitPrice,
      total_usdc: total,
      status,
      block_reason: blockReason,
      created_at: createdAt.toISOString(),
      filled_at: filledAt,
    };

    orders.push(order);
  }

  // Sort by date, most recent first
  orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  logger.info(`Wrote ${orders.length} orders to ${ORDERS_FILE}`);

  const completed = orders.filter(o => o.status === 'completed').length;
  const blocked = orders.filter(o => o.status === 'blocked').length;
  const pending = orders.filter(o => o.status === 'pending').length;
  logger.info(`  Completed: ${completed} | Blocked: ${blocked} | Pending: ${pending}`);
}

main();
