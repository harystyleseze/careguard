# CareGuard Agent

The CareGuard agent coordinates healthcare spending with LLM tool-use and Stellar payments.

## Billing Data

Never invent. The only billing data source is fetch_rosa_bill, which returns a sample bill for the demo. In production this is replaced with real EDI feeds.

When auditing Rosa's bill, the agent should use `fetch_and_audit_bill`, which fetches the sample bill and audits it in one step. The agent must not fabricate bill line items, totals, overcharges, or corrected amounts outside data returned by the billing tools.

## Tool Schemas

Every entry in `TOOL_DEFINITIONS` must use an object schema with `additionalProperties: false`. Pair schema changes with the strict zod validator in `validateToolInput` so LLM-supplied unknown fields are rejected with a clear error instead of being ignored.

Use empty `properties: {}` for no-argument tools. Do not add dummy fields such as `_unused`.

## Mock Network

Set `MOCK_NETWORK=1` in tests to replace x402 and MPP payment calls with deterministic fake receipts. Mock network mode is for development and CI only; startup fails when `MOCK_NETWORK=1` and `NODE_ENV=production`.
