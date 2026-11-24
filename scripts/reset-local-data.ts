#!/usr/bin/env node
/**
 * Reset the local data/ working directory to a clean state.
 *
 * Usage:
 *   node --import tsx scripts/reset-local-data.ts [--yes]
 *
 * Clears data/ contents except .gitkeep and seed.json.example.
 * Prompts for confirmation unless --yes is passed.
 */

import { readdirSync, unlinkSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { logger } from '../shared/logger.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PRESERVED_FILES = ['.gitkeep', 'seed.json.example', 'README.md'];

function parseArgs(): boolean {
  return process.argv.includes('--yes') || process.argv.includes('-y');
}

function promptConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write('\nThis will delete all files in data/ (except .gitkeep, seed.json.example, README.md).\n');
    process.stdout.write('Are you sure? (y/N): ');

    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (input) => {
      const answer = input.trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    });
  });
}

function main() {
  if (!existsSync(DATA_DIR)) {
    logger.info('data/ directory does not exist. Nothing to reset.');
    return;
  }

  const skipConfirmation = parseArgs();
  const entries = readdirSync(DATA_DIR, { withFileTypes: true });

  // Filter out preserved files
  const toDelete = entries.filter((entry) => {
    if (PRESERVED_FILES.includes(entry.name)) return false;
    return true;
  });

  if (toDelete.length === 0) {
    logger.info('data/ is already clean. Nothing to delete.');
    return;
  }

  const deletePromise = skipConfirmation ? Promise.resolve(true) : promptConfirmation();

  deletePromise.then((confirmed) => {
    if (!confirmed) {
      logger.info('Aborted. No files were deleted.');
      return;
    }

    let deletedCount = 0;
    const deletedItems: string[] = [];

    for (const entry of toDelete) {
      const fullPath = path.join(DATA_DIR, entry.name);
      try {
        if (entry.isDirectory()) {
          rmSync(fullPath, { recursive: true, force: true });
        } else {
          unlinkSync(fullPath);
        }
        deletedItems.push(entry.name);
        deletedCount++;
      } catch (err) {
        logger.error(`Failed to delete ${entry.name}: ${err}`);
      }
    }

    logger.info(`\nReset complete. Removed ${deletedCount} item(s):`);
    for (const item of deletedItems) {
      logger.info(`  - ${item}`);
    }
    logger.info('\ndata/ is now clean. Preserved:');
    for (const file of PRESERVED_FILES) {
      logger.info(`  - ${file}`);
    }
  });
}

main();
