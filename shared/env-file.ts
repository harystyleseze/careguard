import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import * as dotenv from "dotenv";

export interface EnvFileLoadOptions {
  path?: string;
  override?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface EnvFileLoadResult {
  loaded: boolean;
  path: string;
  error?: Error;
}

function normalizeEnvText(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function validateEnvText(text: string): Error | null {
  const lines = normalizeEnvText(text).split(/\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(?:export\s+)?([\w.-]+)(?:\s*=\s*|:\s+)(.*)$/);
    if (!match) {
      return new Error(`line ${index + 1}: expected KEY=value`);
    }

    const rawValue = match[2].trim();
    const quote = rawValue[0];
    if ((quote === '"' || quote === "'" || quote === "`") && !rawValue.endsWith(quote)) {
      return new Error(`line ${index + 1}: unbalanced ${quote} quote`);
    }
  }

  return null;
}

export function loadEnvFile(options: EnvFileLoadOptions = {}): EnvFileLoadResult {
  const path = resolve(options.path ?? ".env");
  const env = options.env ?? process.env;

  if (!existsSync(path)) {
    return { loaded: false, path };
  }

  try {
    const raw = readFileSync(path, "utf8");
    const validationError = validateEnvText(raw);
    if (validationError) {
      return { loaded: false, path, error: validationError };
    }

    const parsed = dotenv.parse(normalizeEnvText(raw));
    for (const [key, value] of Object.entries(parsed)) {
      if (options.override || env[key] === undefined) {
        env[key] = value;
      }
    }

    return { loaded: true, path };
  } catch (error) {
    return {
      loaded: false,
      path,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function loadEnvFileOrExit(options: EnvFileLoadOptions = {}): EnvFileLoadResult {
  const result = loadEnvFile(options);

  if (result.error) {
    console.error(`Failed to parse .env: ${result.error.message}`);
    process.exit(1);
  }

  return result;
}
