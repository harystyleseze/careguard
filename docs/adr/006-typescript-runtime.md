# ADR 006: TypeScript Runtime Strategy

## Status

Accepted

## Context

`package.json` used `node --experimental-strip-types --experimental-transform-types --no-warnings server.ts` for the `start` and `dev` scripts, while all six individual-service scripts (`pharmacy-api`, `bill-audit-api`, `drug-api`, `agent`, `pharmacy-payment`) already used `node --import tsx`. The split was inconsistent and the `--experimental-*` flags are unstable: they can change or be removed in a Node minor bump, breaking the production startup command without warning.

Two stable alternatives were evaluated:

| Option | Pros | Cons |
|--------|------|------|
| **tsx throughout** (chosen) | Zero build step; dev and prod use identical runtime; already used by all service scripts | tsx is an additional runtime dep; not a precompiled artifact |
| **tsup build → dist/** | Prod runs plain JS; smaller cold-start footprint | Adds build step; requires CI to run `npm run build`; two codepaths to maintain |

## Decision

**Use `tsx` throughout** — both development and production.

- All scripts use `node --import tsx <entrypoint>.ts`.
- No separate build step is required to start the server.
- `tsx` is promoted from `devDependencies` to `dependencies` so it is available in a production `npm ci` install.
- `npm run build` runs `tsc --noEmit` (type-checking only) for CI validation.
- `render.yaml` and `Dockerfile` are updated to match.

## Consequences

### Positive

- Unified runtime across dev and prod — no flag drift between environments.
- Consistent with the existing service scripts.
- Node 22 (current LTS) and Node 24+ are both supported by tsx.
- Simpler Dockerfile and render.yaml (no build stage, no dist directory).

### Negative

- `tsx` runs in process; if the tsx loader has a bug on a new Node version, it affects production.
- Slightly higher startup latency than pre-compiled JS (negligible for this service).
- No compiled artifact to inspect or audit statically.

### Neutral

- `npm run build` is a type-check (`tsc --noEmit`) rather than a compile; CI must call it explicitly to catch type errors.
- If the team later decides to pre-compile (e.g., for a very high-load deployment), migrating to tsup is straightforward: add a `tsup.config.ts`, run `npm run build`, and point `startCommand` at `dist/server.js`.

## Node Version Support

Minimum: Node 22 (as before).  
Tested: Node 22 and Node 24. tsx works with both via `--import` loader hooks.

## Implementation Notes

```jsonc
// package.json (key scripts)
"start": "node --import tsx server.ts",
"dev":   "node --import tsx server.ts",
"build": "tsc --noEmit"
```

```yaml
# render.yaml
startCommand: node --import tsx server.ts
```

```dockerfile
# Dockerfile
CMD ["node", "--import", "tsx", "server.ts"]
```
