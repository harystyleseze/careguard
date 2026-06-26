# Environment file syntax

CareGuard loads `.env` before the unified server imports application code. If the file cannot be parsed, startup prints `Failed to parse .env: <message>` and exits with status `1`.

## Supported lines

```bash
# Comments and blank lines are ignored.
KEY=value
KEY = value
export KEY=value
SERVICE_URL: http://localhost:3001
QUOTED_VALUE="value with spaces"
```

- Keys may contain letters, numbers, underscores, periods, and dashes.
- Values may be unquoted or quoted with matching single quotes, double quotes, or backticks.
- A UTF-8 byte order mark at the start of the file is ignored.
- Existing process environment variables are kept unless the loader is called with override mode.

## Unsupported lines

Raw multiline values are not accepted in `.env`. Encode newlines as `\n` inside a quoted value instead.

```bash
PRIVATE_KEY="line one\nline two"
```

Every non-comment line must be a complete assignment. For example, `LLM_API_KEY="unterminated` fails with a clear parse error instead of a low-level runtime crash.
