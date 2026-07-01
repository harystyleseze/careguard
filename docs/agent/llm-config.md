# LLM Configuration Guide

## Temperature Settings

CareGuard uses differentiated temperature settings to balance determinism with natural language generation:

### Tool-Call Temperature (Default: 0)

For agentic loop iterations where the LLM is deciding which tools to call, we use **temperature = 0** to ensure:
- **Deterministic function calling**: The same user query will consistently trigger the same tools
- **Reduced variance**: Eliminates noise in tool selection, making the agent more predictable
- **Better evaluation**: Regression eval tests show lower flakiness with `temperature=0`

**Environment Variable**: `LLM_TOOL_TEMPERATURE` (default: `0`)

### Summary Temperature (Default: 0.3)

For the final summary response after all tool calls complete, we use **temperature = 0.3** to:
- **Add natural variation**: The summary response can be phrased differently on repeated calls
- **Maintain usefulness**: Still deterministic enough for reproducible results, but with slight variation
- **Improve readability**: Avoids robotic-sounding repeated outputs

**Environment Variable**: `LLM_SUMMARY_TEMPERATURE` (default: `0.3`)

## Configuration

### Environment Variables

```bash
# Tool-call rounds: temperature for function selection (0 = deterministic)
LLM_TOOL_TEMPERATURE=0

# Final summary: temperature for natural language generation (0.3 = slightly creative)
LLM_SUMMARY_TEMPERATURE=0.3

# Other LLM settings
LLM_MODEL=llama-3.3-70b-versatile
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=<your-api-key>
```

## Rationale

### Why Temperature 0 for Tools?

- **Agentic loops require consistency**: When the LLM decides to call `audit_medical_bill`, it should always call that tool (not `compare_pharmacy_prices`) for the same input
- **Reduces eval flakiness**: Tests run on the agent's behavior are more stable when the same query produces the same tool sequence
- **Cost efficiency**: Fewer retries needed when tool behavior is predictable

### Why Temperature 0.3 for Summaries?

- **Natural language variance**: Some unpredictability is OK in the final summary—it still conveys the same information
- **Improved UX**: Users aren't seeing identical responses on each interaction
- **Better approximation of human communication**: A human would phrase the same answer slightly differently each time
- **Historical default**: Groq's default temperature (~1.0) is too high; 0.3 strikes a balance

## Monitoring

At startup, the agent logs its temperature configuration:

```json
{
  "llmToolTemperature": 0,
  "llmSummaryTemperature": 0.3
}
```

The agent tracks:
- **Token usage per iteration** (in metrics)
- **Context window utilization** (warns if > 80%)
- **Tool call success rate** (via audit logs)

## Tuning

If you experience:

1. **Too many tool retries**: Increase `LLM_TOOL_TEMPERATURE` slightly (e.g., 0 → 0.1)
2. **Inconsistent tool calls**: Decrease `LLM_TOOL_TEMPERATURE` to ensure it's strictly 0
3. **Summaries sound robotic**: Increase `LLM_SUMMARY_TEMPERATURE` (e.g., 0.3 → 0.5)
4. **Summaries are inconsistent**: Decrease `LLM_SUMMARY_TEMPERATURE` (e.g., 0.3 → 0.1)

## Regression Testing

When making temperature changes:

1. Run the eval test suite: `pnpm test agent/__tests__/llm-bill-fabrication.eval.test.ts`
2. Compare token usage before/after
3. Log the results and rationale in `CHANGELOG.md`

Example from a tuning session:

```markdown
**LLM Temperature Adjustment**
- Changed tool temperature from 0 to 0.1
- Result: Tool retry rate stayed < 2%, summary variance increased (expected)
- Token consumption: +1.2% (acceptable)
```
---

## max_tokens Heuristic (Issue #280)

To optimize costs, CareGuard uses a context-aware heuristic for `max_tokens` instead of a fixed value:

### Token Budget by Iteration Type

| Iteration Type | max_tokens | Use Case |
| --- | --- | --- |
| **Tool-result processing** | 512 | Processing tool results, deciding next action |
| **Simple queries** | 1024 | "Did Rosa take her med?" style queries |
| **Full summaries** | 4096 | Complex reasoning, final output |

### Heuristic Logic

```
if (iteration === 0) → max_tokens = 1024  // First query often simple
else if (processing 1-3 prior tool results) → max_tokens = 512  // Small context
else if (processing 4+ prior tool results) → max_tokens = 1024  // More synthesis
else if (iteration > 8) → max_tokens = 4096  // Late iterations need full budget
else → max_tokens = 1024  // Default conservative
```

### Cost Savings Example

A simple medication adherence check that used to consume 4096 tokens now uses:
- **Iteration 0** (query): 1024 tokens
- **Iteration 1** (tool call): 512 tokens
- **Total**: ~1500 tokens (63% reduction vs. fixed 4096)

### Configuration

```bash
# Override the default token budgets if needed
LLM_MAX_TOKENS_TOOL_RESULT=512    # For processing tool results
LLM_MAX_TOKENS_SIMPLE=1024         # For simple queries  
LLM_MAX_TOKENS_SUMMARY=4096        # For full summaries
```

### Token Usage Alerts

The agent tracks cumulative token usage and alerts when the running average exceeds 50% of the summary max:

```
WARN: LLM token usage exceeds 50% of budget threshold
  averageTokensPerRun: 2100
  averageUsageRatio: 51.2%
  runCount: 47
```

**Response strategies**:
- Increase token budgets if queries legitimately need more tokens
- Simplify prompts if average is consistently high
- Check if tools are producing large result sets (consider pagination)

### Monitoring

Check token consumption in metrics:
```
agent_llm_tokens_total{kind="prompt"} / agent_llm_tokens_total{kind="completion"}
agentLlmContextUsageRatio (warns at 80% of context window)
```

Run token analysis:
```bash
pnpm run check-llm-budget  # Shows token consumption by query type