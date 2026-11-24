/**
 * docker-teardown.ts
 *
 * Safely wraps `docker compose down -v`, which deletes ALL named volumes:
 *   - careguard SQLite database (spending log, care recipients)
 *   - Redis data (session state, rate-limit counters)
 *   - Grafana dashboards and datasource config
 *   - Prometheus TSDB (metrics history)
 *
 * Usage:
 *   npm run docker:down:clean          # interactive confirmation prompt
 *   npm run docker:down:clean -- --yes # skip prompt (CI / scripted use)
 */

import { spawnSync } from 'child_process';
import { createInterface } from 'readline';

const skipConfirmation = process.argv.includes('--yes') || process.argv.includes('-y');

const VOLUMES_DELETED = [
  'careguard SQLite database  (spending log, care recipients)',
  'Redis data                 (session state, rate-limit counters)',
  'Grafana dashboards         (provisioned configs)',
  'Prometheus TSDB            (metrics history)',
];

function promptConfirmation(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Type "yes" to confirm, anything else to abort: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  console.log('\n⚠️  docker compose down -v will permanently delete the following volumes:\n');
  for (const vol of VOLUMES_DELETED) {
    console.log(`  • ${vol}`);
  }
  console.log('\nThis cannot be undone. Local data/ files are not affected.\n');

  if (!skipConfirmation) {
    const confirmed = await promptConfirmation();
    if (!confirmed) {
      console.log('\nAborted. No volumes were deleted.\n');
      process.exit(0);
    }
  } else {
    console.log('--yes flag detected, skipping prompt.\n');
  }

  console.log('Running: docker compose down -v\n');
  const result = spawnSync('docker', ['compose', 'down', '-v'], { stdio: 'inherit' });

  if (result.error) {
    console.error(`\nFailed to run docker compose: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

main();
