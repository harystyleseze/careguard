#!/usr/bin/env tsx

import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';

interface EnvVar {
  name: string;
  line: number;
  used: boolean;
  files: string[];
  hint?: string;
  group?: string;
}

// Wallet key-pair halves that `npm run setup` (scripts/setup-wallets.ts) prints
// for every wallet in WALLET_NAMES, documented here for operators to paste the
// full pair into .env, even though only one half of each pair is ever read via
// process.env at runtime (e.g. recipient wallets only need their PUBLIC_KEY;
// the app never loads their SECRET_KEY, and the agent's own PUBLIC_KEY is
// derived from AGENT_SECRET_KEY rather than read separately).
const DOCUMENTATION_ONLY_VARS = new Set([
  'STELLAR_RPC_URL',
  'AGENT_PUBLIC_KEY',
  'CAREGIVER_SECRET_KEY',
  'CAREGIVER_PUBLIC_KEY',
  'PHARMACY_1_SECRET_KEY',
  'PHARMACY_2_SECRET_KEY',
  'PHARMACY_3_SECRET_KEY',
  'PHARMACY_3_PUBLIC_KEY',
  'BILL_PROVIDER_SECRET_KEY',
]);

// #1336 — Group vars by feature area and provide generation hints so
// contributors know exactly what to do for each missing variable.
const VAR_HINTS: Record<string, { group: string; hint: string }> = {
  AGENT_SECRET_KEY:     { group: 'wallets', hint: 'Run "npm run setup" or set DEV_WALLET_SEED and run "npm run setup -- --write-env"' },
  CAREGIVER_TOKEN:      { group: 'auth', hint: 'Generate with: openssl rand -hex 32' },
  MPP_SECRET_KEY:       { group: 'payments', hint: 'Generate with: openssl rand -hex 32' },
  LLM_API_KEY:          { group: 'LLM', hint: 'Get a free key at https://console.groq.com or set LLM_BASE_URL=http://localhost:3005 for mock LLM' },
  LLM_BASE_URL:         { group: 'LLM', hint: 'Default: https://api.groq.com/openai/v1. For offline dev: http://localhost:3005 (mock-llm)' },
  LLM_MODEL:            { group: 'LLM', hint: 'Default: llama-3.3-70b-versatile' },
  OZ_FACILITATOR_API_KEY: { group: 'x402', hint: 'Get at: https://channels.openzeppelin.com/testnet/gen' },
  USDC_ISSUER:          { group: 'Stellar', hint: 'Testnet default: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
  ALLOWED_ORIGINS:      { group: 'CORS', hint: 'Default: http://localhost:3000. Set to dashboard URL in production' },
  REDIS_URL:            { group: 'infra', hint: 'Optional. Example: redis://localhost:6379' },
  SPENDING_TIMEZONE:    { group: 'policy', hint: 'Default: America/Phoenix (UTC-7, no DST)' },
  CAREGIVER_PUBLIC_KEY: { group: 'wallets', hint: 'Run "npm run setup" to generate' },
  PHARMACY_1_PUBLIC_KEY:{ group: 'wallets', hint: 'Run "npm run setup" to generate' },
  PHARMACY_2_PUBLIC_KEY:{ group: 'wallets', hint: 'Run "npm run setup" to generate' },
  BILL_PROVIDER_PUBLIC_KEY: { group: 'wallets', hint: 'Run "npm run setup" to generate' },
};

async function extractEnvVarsFromExample(): Promise<Map<string, EnvVar>> {
  const envExamplePath = path.join(process.cwd(), '.env.example');
  const content = await fs.readFile(envExamplePath, 'utf-8');
  const lines = content.split('\n');

  const envVars = new Map<string, EnvVar>();

  lines.forEach((line, index) => {
    // Match lines like: VAR_NAME=value or # VAR_NAME=value
    const match = line.match(/^#?\s*([A-Z_][A-Z0-9_]*)=/);
    if (match) {
      const varName = match[1];
      // Skip common meta variables and documented-but-intentionally-unread vars
      if (!['NODE_ENV', 'PORT', 'HOST'].includes(varName) && !DOCUMENTATION_ONLY_VARS.has(varName)) {
        const meta = VAR_HINTS[varName];
        envVars.set(varName, {
          name: varName,
          line: index + 1,
          used: false,
          files: [],
          hint: meta?.hint,
          group: meta?.group,
        });
      }
    }
  });

  return envVars;
}

async function searchCodebaseForEnvVars(envVars: Map<string, EnvVar>): Promise<void> {
  const files = await glob('**/*.{ts,js,tsx,jsx}', {
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'scripts/check-env-vars.ts'],
  });
  
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    
    for (const [varName, varInfo] of envVars) {
      // Check for process.env.VAR_NAME or process.env['VAR_NAME']
      const patterns = [
        new RegExp(`process\\.env\\.${varName}\\b`),
        new RegExp(`process\\.env\\['${varName}'\\]`),
        new RegExp(`process\\.env\\["${varName}"\\]`),
      ];
      
      if (patterns.some((pattern) => pattern.test(content))) {
        varInfo.used = true;
        varInfo.files.push(file);
      }
    }
  }
}

async function main() {
  console.log('🔍 Checking for unused environment variables...\n');
  
  const envVars = await extractEnvVarsFromExample();
  console.log(`Found ${envVars.size} environment variables in .env.example`);
  
  await searchCodebaseForEnvVars(envVars);
  
  const unused = Array.from(envVars.values()).filter((v) => !v.used);
  const used = Array.from(envVars.values()).filter((v) => v.used);
  
  console.log(`✅ ${used.length} variables are used`);
  console.log(`⚠️  ${unused.length} variables are unused\n`);
  
  if (unused.length > 0) {
    // #1336 — Group missing vars by feature area and show generation hints.
    const byGroup = new Map<string, typeof unused>();
    for (const v of unused) {
      const group = v.group || 'other';
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(v);
    }

    console.log('Missing/unused environment variables:\n');
    for (const [group, vars] of byGroup) {
      console.log(`  ── ${group} ──`);
      for (const v of vars) {
        console.log(`    ${v.name} (line ${v.line})`);
        if (v.hint) console.log(`      → ${v.hint}`);
      }
      console.log();
    }
    console.log('Consider removing these from .env.example or adding a comment explaining why they exist.');
    process.exit(1);
  }
  
  console.log('✅ All environment variables in .env.example are used in the codebase');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
