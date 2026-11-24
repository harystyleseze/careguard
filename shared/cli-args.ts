/**
 * Shared CLI argument parser for scripts.
 *
 * Provides consistent flag parsing and help rendering across all scripts.
 * Supports boolean flags (--flag), string flags (--key=value), and positional args.
 */

export interface Flag {
  name: string;
  shorthand?: string;
  description: string;
  required?: boolean;
  default?: string | boolean;
  type?: 'boolean' | 'string';
}

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positional: string[];
}

export class ArgParser {
  private flags: Map<string, Flag>;
  private shortnameMap: Map<string, string>;
  private scriptName: string;
  private description: string;

  constructor(scriptName: string, description: string) {
    this.scriptName = scriptName;
    this.description = description;
    this.flags = new Map();
    this.shortnameMap = new Map();
  }

  addFlag(flag: Flag): this {
    this.flags.set(flag.name, flag);
    if (flag.shorthand) {
      this.shortnameMap.set(flag.shorthand, flag.name);
    }
    return this;
  }

  parse(args: string[] = process.argv.slice(2)): ParsedArgs {
    const parsed: ParsedArgs = {
      flags: {},
      positional: [],
    };

    // Initialize with defaults
    for (const [name, flag] of this.flags) {
      if (flag.default !== undefined) {
        parsed.flags[name] = flag.default;
      }
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      // Help flag
      if (arg === '--help' || arg === '-h') {
        this.printHelp();
        process.exit(0);
      }

      // Long-form flag: --name=value or --flag
      if (arg.startsWith('--')) {
        const [key, ...valueParts] = arg.slice(2).split('=');
        const value = valueParts.join('=');
        const flagDef = this.flags.get(key);

        if (!flagDef) {
          console.error(`Unknown flag: --${key}`);
          process.exit(1);
        }

        if (flagDef.type === 'boolean' || !value) {
          parsed.flags[key] = true;
        } else {
          parsed.flags[key] = value;
        }
        continue;
      }

      // Short-form flag: -f
      if (arg.startsWith('-') && arg.length === 2) {
        const short = arg.slice(1);
        const longName = this.shortnameMap.get(short);

        if (!longName) {
          console.error(`Unknown flag: -${short}`);
          process.exit(1);
        }

        const flagDef = this.flags.get(longName);
        if (flagDef?.type === 'boolean') {
          parsed.flags[longName] = true;
        } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          parsed.flags[longName] = args[++i];
        } else {
          console.error(`Flag -${short} requires a value`);
          process.exit(1);
        }
        continue;
      }

      // Positional argument
      parsed.positional.push(arg);
    }

    // Validate required flags
    for (const [name, flag] of this.flags) {
      if (flag.required && !(name in parsed.flags)) {
        console.error(`Required flag missing: --${name}`);
        process.exit(1);
      }
    }

    return parsed;
  }

  printHelp(): void {
    console.log(`\n${this.scriptName}`);
    console.log(`${this.description}\n`);
    console.log('Usage:');
    console.log(`  node --import tsx ${this.scriptName} [OPTIONS]\n`);

    if (this.flags.size > 0) {
      console.log('Options:');
      for (const flag of this.flags.values()) {
        const shorthand = flag.shorthand ? ` / -${flag.shorthand}` : '';
        const required = flag.required ? ' (required)' : '';
        const defaultVal = flag.default !== undefined ? ` (default: ${flag.default})` : '';
        console.log(`  --${flag.name}${shorthand}  ${flag.description}${required}${defaultVal}`);
      }
    }

    console.log('  --help / -h        Show this help message\n');
  }

  getFlag<T extends string | boolean>(name: string, defaultValue?: T): T {
    return (this.flags.has(name) && this.flags.get(name)?.default !== undefined
      ? this.flags.get(name)?.default
      : defaultValue) as T;
  }
}
