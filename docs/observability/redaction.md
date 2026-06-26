# Tool Call Log Redaction

CareGuard logs agent tool calls as structured fields, but tool inputs can contain
care recipient identifiers, billing details, payment amounts, line items,
locations, medication lists, and caregiver contact details.

## Convention

Tool-call logs must use an explicit per-tool allowlist. Any input field that is
not allowlisted is logged as:

```text
<redacted: field_name>
```

Do not truncate raw JSON strings as a privacy control. Truncation can still leak
sensitive values depending on object field order.

## Implementation

The allowlist lives in `agent/tool-log-redaction.ts`:

- `SAFE_TOOL_LOG_FIELDS` defines fields that are safe to include for each tool.
- `redactToolCallInput(toolName, input)` applies the allowlist.
- `buildToolCallLogFields(toolName, input)` returns the structured logger
  payload used by `agent/server.ts`.

Unknown tool names default to redacting every input field.

## Adding Or Changing Tools

When adding a new tool input:

1. Add the tool name to `SAFE_TOOL_LOG_FIELDS`.
2. Allowlist only fields that are operationally useful and not sensitive.
3. Add or update the representative input in
   `agent/__tests__/tool-log-redaction.test.ts`.
4. Keep payment amounts, care recipient IDs, billing line items, caregiver
   contact details, free-text descriptions, and raw JSON payloads redacted by
   default.
