# Render Deployment (Build Artifact Pipeline)

This document describes the build artifact pipeline used by the Render deployment for CareGuard.

## Overview

The project compiles TypeScript to JavaScript using the standard `tsc` compiler with a build-specific configuration. The compiled output is emitted to the `dist/` directory and served from there by the Render service.

## Build Pipeline

1. **`npm ci`** — Install exact dependency versions from `package-lock.json`.
2. **`npm run build`** — Compile TypeScript to JavaScript using `tsc -p tsconfig.build.json`.

The `tsconfig.build.json` extends the root `tsconfig.json` with the following overrides:

| Option | Value | Description |
|--------|-------|-------------|
| `noEmit` | `false` | Enable output file emission |
| `outDir` | `./dist` | Emit compiled files to the `dist/` directory |
| `rewriteRelativeImportExtensions` | `true` | Rewrite `.ts` import extensions to `.js` in the output |
| `declaration` | `false` | Skip `.d.ts` emission for the production build |
| `sourceMap` | `true` | Generate source maps for error stack traces |

### Runtime

The `startCommand` in `render.yaml` runs the compiled entrypoint:

```
node dist/server.js
```

No Node.js experimental flags (`--experimental-strip-types`, `--experimental-transform-types`) are needed at runtime because all TypeScript has been compiled to JavaScript during the build step.

## Required Node.js Version

The service must run on **Node.js 22** or later (as specified in `.nvmrc` and `package.json` `engines`).

## Verification

To verify the build locally before deployment:

```bash
npm run build
ls dist/server.js              # compiled entrypoint exists
node dist/server.js             # starts the server from compiled output
```

## Comparison with Local Development

| Aspect | Render (Production) | Local Development |
|--------|---------------------|-------------------|
| Build | `tsc` compiles to `dist/` | `tsx` runtime loads `.ts` directly |
| Start command | `node dist/server.js` | `node --import tsx server.ts` |
| Flags needed | None | None (tsx runtime) |
