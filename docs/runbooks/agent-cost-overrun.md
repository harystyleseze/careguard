# Runbook: Agent Spending Budget Overrun

**Symptom**

The `AgentSpendingBudgetOverrun` alert fires in Prometheus. The alert message
includes the category that exceeded its threshold:

> Agent spending in category `medications` exceeds budget threshold

The Grafana **Spending by Category** panel on the Overview dashboard shows a
spike in one of `medications`, `bills`, or `service_fees` that is well above the
normal baseline.

**Impact**

- The agent is spending USDC faster than the configured budget allows. If left
  unchecked, the agent wallet will be depleted and subsequent legitimate
  transactions will fail.
- A runaway agent loop can burn through the monthly medication budget
  ($300 default) or bill budget ($500 default) in a single session, leaving
  nothing for the rest of the month.
- Service-fee overruns (x402 API costs) are typically small in absolute terms
  but indicate a loop that is making excessive API calls.

## Diagnosis

1. **Identify the category.** The alert's `$labels.category` tells you which
   spending category is over budget: `medications`, `bills`, or `service_fees`.

2. **Check the Spending by Category panel.** In Grafana, open the CareGuard
   Overview dashboard and look at the "Spending by Category" stat panel. A
   sudden jump in any category confirms the overrun. Compare against the
   normal baseline (medications should be the largest category; service fees
   should be minimal).

3. **Check for agent loops.** Look at the "Agent Runs" panel — a spike in
   `agent_runs_total` alongside the spending spike suggests the agent is
   looping (making repeated runs that each spend money). Also check
   `agent_iteration_limit_total` — if it's increasing, the agent is hitting
   the iteration cap, which is a loop symptom.

4. **Check the spending policy.** Review the current policy on the dashboard's
   Policy tab. Verify that `dailyLimit`, `monthlyLimit`,
   `medicationMonthlyBudget`, and `billMonthlyBudget` are set to sensible
   values. See [docs/SPENDING-POLICY.md](../SPENDING-POLICY.md) for the defaults
   and validation rules.

5. **Check the audit log.** Look at `data/audit.log.jsonl` for recent payment
   entries to see what the agent is actually buying:
   ```sh
   tail -20 data/audit.log.jsonl | jq .
   ```

## Mitigation

**Immediate: pause the agent.** This stops all spending while you investigate:

```sh
curl -X POST $AGENT_URL/agent/pause
```

Or click "Pause agent" in the dashboard.

**If the wallet is low**, see [wallet-low.md](wallet-low.md) for funding
instructions.

**If the spending policy is too permissive**, tighten the limits via the
dashboard Policy tab or by editing `data/recipients/<id>/policy.json`. Lower
the `dailyLimit` or the relevant category monthly budget to a value that gives
enough runway for the rest of the month.

## Remediation

1. **Fix the root cause of the loop.** If the agent is looping, check the LLM
   prompt and tool-call logic. A common cause is the LLM repeatedly calling the
   same tool with the same arguments. See
   [llm-rate-limit.md](llm-rate-limit.md) if provider throttling is involved.

2. **Adjust budget thresholds in the alert.** The alert thresholds in
   `docker/prometheus/rules.yml` are derived from the default monthly budgets
   in `docs/SPENDING-POLICY.md`:
   - medications: $50/hr (17% of the $300 monthly budget)
   - bills: $200/hr (40% of the $500 monthly budget)
   - service_fees: $5/hr (API costs are normally ~$0.03/run)

   If your deployment uses different budget figures, update the thresholds in
   the `AgentSpendingBudgetOverrun` alert rule to match.

3. **Resume the agent** once the root cause is fixed and the policy is
   appropriately tightened:
   ```sh
   curl -X POST $AGENT_URL/agent/resume
   ```

## Post-mortem template

```
Date / duration:
Category that overran:
Total overspend ($):
Root cause: [ runaway agent loop | misconfigured policy | unexpected large bill | other ]
Detection lag: (time from first spending spike to alert firing)
Mitigation taken: [ paused agent | tightened policy | funded wallet ]
Remediation:
Action items:
```

## Related

- [Spending Policy](../SPENDING-POLICY.md) — budget limits, validation rules, and enforcement flow
- [wallet-low.md](wallet-low.md) — agent paused due to low wallet balance
- [llm-rate-limit.md](llm-rate-limit.md) — LLM provider throttling (a common cause of agent loops)
- `docker/prometheus/rules.yml` — `AgentSpendingBudgetOverrun` alert definition
- `shared/metrics.ts` — `agent_spending_usd` gauge definition
