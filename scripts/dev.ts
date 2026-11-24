/**
 * Dev server startup script — starts all CareGuard services.
 * Replaces concurrently to avoid Node 24 + tsx loader process tracking issues.
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { pathToFileURL } from "url";
import { logger } from "../shared/logger.ts";

export const SERVICES = [
  { name: "pharmacy", script: "services/pharmacy-api/server.ts", color: "\x1b[36m" },       // cyan
  { name: "billing",  script: "services/bill-audit-api/server.ts", color: "\x1b[33m" },      // yellow
  { name: "drugs",    script: "services/drug-interaction-api/server.ts", color: "\x1b[35m" }, // magenta
  { name: "mpp",      script: "services/pharmacy-payment/server.ts", color: "\x1b[34m" },    // blue
  { name: "agent",    script: "agent/server.ts", color: "\x1b[32m" },                         // green
];

const RESET = "\x1b[0m";

function log(name: string, color: string, data: string) {
  const lines = data.toString().trim().split("\n");
  for (const line of lines) {
    process.stdout.write(`${color}[${name}]${RESET} ${line}\n`);
  }
}

export function parseServicesToRun(argv: string[] = process.argv): typeof SERVICES {
  const validNames = SERVICES.map((s) => s.name);
  const onlyArg = argv.find((arg) => arg.startsWith("--only="));
  let requestedStr: string | undefined;

  if (onlyArg) {
    requestedStr = onlyArg.slice("--only=".length);
  } else {
    const onlyIdx = argv.indexOf("--only");
    if (onlyIdx !== -1 && argv[onlyIdx + 1] && !argv[onlyIdx + 1].startsWith("-")) {
      requestedStr = argv[onlyIdx + 1];
    }
  }

  if (!requestedStr) {
    return SERVICES;
  }

  const requestedNames = requestedStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const invalidNames = requestedNames.filter((name) => !validNames.includes(name));

  if (invalidNames.length > 0) {
    logger.error(
      { invalid: invalidNames, valid: validNames },
      `Invalid service name(s): ${invalidNames.join(", ")}. Valid service options are: ${validNames.join(", ")}`,
    );
    process.exit(1);
    return [];
  }

  return SERVICES.filter((s) => requestedNames.includes(s.name));
}

export function startDevServer(argv: string[] = process.argv): ChildProcess[] {
  const children: ChildProcess[] = [];
  const servicesToRun = parseServicesToRun(argv);

  for (const svc of servicesToRun) {
    const child = spawn("node", ["--import", "tsx", svc.script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    child.stdout?.on("data", (data) => log(svc.name, svc.color, data.toString()));
    child.stderr?.on("data", (data) => log(svc.name, "\x1b[31m", data.toString()));

    child.on("exit", (code) => {
      log(svc.name, "\x1b[31m", `exited with code ${code}`);
      // If any service crashes, kill all others
      if (code !== 0 && code !== null) {
        logger.error({ service: svc.name }, "service crashed, shutting down all services");
        for (const c of children) c.kill();
        process.exit(1);
      }
    });

    children.push(child);
  }

  process.on("SIGINT", () => {
    logger.info("shutting down all services");
    for (const c of children) c.kill();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    for (const c of children) c.kill();
    process.exit(0);
  });

  logger.info({ count: servicesToRun.length }, "starting CareGuard services");
  return children;
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === entrypointUrl) {
  startDevServer();
}


