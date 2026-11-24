#!/usr/bin/env tsx

import fs from 'node:fs/promises';
import path from 'node:path';

interface EnvVar {
  name: string;
  source: 'example' | 'validation';
}

async function extractVarsFromEnvExample(): Promise<Set<string>> {
  const envExamplePath = path.join(process.cwd(), '.env.example');
  const content = await fs.readFile(envExamplePath, 'utf-8');
  const lines = content.split('\n');

  const vars = new Set<string>();

  lines.forEach((line) => {
    const match = line.match(/^#?\s*([A-Z_][A-Z0-9_]*)=/);
    if (match) {
      const varName = match[1];
      vars.add(varName);
    }
  });

  return vars;
}

async function extractVarsFromCheckEnvVars(): Promise<Set<string>> {
  const checkEnvPath = path.join(process.cwd(), 'scripts/check-env-vars.ts');
  const content = await fs.readFile(checkEnvPath, 'utf-8');

  const vars = new Set<string>();

  // Extract DOCUMENTATION_ONLY_VARS set
  const docOnlyMatch = content.match(/const DOCUMENTATION_ONLY_VARS = new Set\(\[([\s\S]*?)\]\)/);
  if (docOnlyMatch) {
    const varMatches = docOnlyMatch[1].match(/'([A-Z_][A-Z0-9_]*)'/g);
    if (varMatches) {
      varMatches.forEach((v) => {
        vars.add(v.replace(/'/g, ''));
      });
    }
  }

  // Extract vars checked in extractEnvVarsFromExample filter
  const filterMatch = content.match(/if \(!.*?includes\(varName\) && !DOCUMENTATION_ONLY_VARS\.has\(varName\)\)/);
  if (filterMatch) {
    const skipVars = ['NODE_ENV', 'PORT', 'HOST'];
    skipVars.forEach((v) => vars.add(v));
  }

  // Extract all process.env accesses from codebase
  // This is done via glob in the actual validation, but we need to identify
  // what the validation script expects to find

  // For now, extract from the search patterns used in the validation
  const globFiles = await import('glob').then((m) => m.glob);
  const files = await globFiles('**/*.{ts,js,tsx,jsx}', {
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'scripts/check-env-vars.ts'],
  });

  for (const file of files) {
    try {
      const fileContent = await fs.readFile(file, 'utf-8');
      const matches = fileContent.match(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
      if (matches) {
        matches.forEach((m) => {
          const varName = m.replace('process.env.', '');
          vars.add(varName);
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return vars;
}

async function main() {
  console.log('🔄 Checking .env.example sync with check-env-vars.ts...\n');

  const exampleVars = await extractVarsFromEnvExample();
  const validationVars = await extractVarsFromCheckEnvVars();

  const missingInValidation = Array.from(exampleVars).filter((v) => !validationVars.has(v));
  const missingInExample = Array.from(validationVars).filter((v) => !exampleVars.has(v));

  let hasErrors = false;

  if (missingInValidation.length > 0) {
    console.log('⚠️  Variables in .env.example but not in check-env-vars.ts:');
    missingInValidation.forEach((v) => {
      console.log(`  - ${v}`);
    });
    console.log();
    hasErrors = true;
  }

  if (missingInExample.length > 0) {
    console.log('⚠️  Variables in codebase but not documented in .env.example:');
    missingInExample.forEach((v) => {
      console.log(`  - ${v}`);
    });
    console.log();
    hasErrors = true;
  }

  if (!hasErrors) {
    console.log('✅ .env.example and check-env-vars.ts are in sync');
    process.exit(0);
  } else {
    console.log('❌ Sync check failed. Update .env.example or check-env-vars.ts to match.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
