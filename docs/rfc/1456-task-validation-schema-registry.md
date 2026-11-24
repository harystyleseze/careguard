# RFC 1456: Merge `shared/task-validation.ts` checks into the agent's tool-schema validation path

**Status:** Proposed / Implemented  
**Date:** 2026-08-27  
**Issue:** [#1456](https://github.com/harystyleseze/careguard/issues/1456)  

---

## Context

`shared/task-validation.ts` (65 lines) currently implements standalone task-input validation separate from the `TOOL_INPUT_SCHEMAS`/`validateToolInput` schema registry pattern defined in `agent/tools.ts`. As a result, the codebase maintains two independent validation systems for checking input form without shared vocabulary or reused Zod schemas.

This RFC proposes folding task validation into the same schema-registry structure used for agent tool inputs while preserving security-critical behavior (control character stripping, JSON `role` object rejection, prompt injection detection, and audit logging).

---

## Acceptance Criteria

### 1. Document what `shared/task-validation.ts` currently validates and how

`shared/task-validation.ts` validates incoming agent tasks via `validateTask(raw: unknown)`:
- **Type & Length:** Uses Zod `z.string().min(10).max(5000)` to ensure string type between 10 and 5000 characters.
- **Control Character Stripping:** Removes ASCII control characters (`[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]`).
- **JSON Object Role Check:** Rejects valid JSON objects containing a `"role"` property (resisting system prompt injection via raw JSON payloads).
- **Prompt Injection Blocklist:** Checks for case-insensitive blocklist tokens (`dan `, `ignore all instructions`, `ignore previous instructions`, `disregard your instructions`, `jailbreak`, `act as if`, `you are now`, `forget your`, `new persona`). If matched, flags `suspicious: true`, increments `suspiciousTaskTotal`, and appends an audit log entry (`task.suspicious`).

### 2. Compare against `TOOL_INPUT_SCHEMAS`/`validateToolInput` pattern

- `agent/tools.ts` registers Zod schemas in `TOOL_INPUT_SCHEMAS` and validates arguments via `validateToolInput(name, input)` using `.strict()` schemas.
- `shared/task-validation.ts` implemented an imperative validation function returning `TaskValidationResult`.
- **Convergence:** Task input can be expressed as a Zod schema (`TaskInputSchema`) in the schema registry while encapsulating post-parse security sanitization and audit triggers.

### 3. Proposed Schema-Registry Convention

Define `TaskInputSchema` as a Zod schema with custom transforms and refinements:
```ts
export const TaskInputSchema = z
  .string()
  .min(10, { message: "Task must be at least 10 characters long" })
  .max(5000, { message: "Task must not exceed 5000 characters" })
  .transform((val) => val.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, ""));
```

`validateTask` uses `TaskInputSchema.safeParse(raw)` alongside the JSON-role check and blocklist auditor, uniting task validation with the Zod schema registry.

### 4. Migration Plan and Regression-Test Coverage

- Preserve `validateTask` signature and `TaskValidationResult` contract so existing consumers (`agent/server.ts`, `server.ts`) require zero breaking changes.
- Maintain existing test suite in `shared/__tests__/task-validation.test.ts` to verify full regression safety.

### 5. Preserved vs Intentionally Changed Behavior

- **Preserved Exactly:** Min length (10), max length (5000), control character stripping, JSON `"role"` rejection, blocklist detection, audit logging (`task.suspicious`), and counter tracking (`getSuspiciousTaskCount()`).
- **Intentionally Changed:** Input schema definition logic is unified with Zod schema definitions consistent with `TOOL_INPUT_SCHEMAS`.
