# CareGuard Agent

The CareGuard agent coordinates healthcare spending with LLM tool-use and Stellar payments.

## Billing Data

Never invent. The only billing data source is fetch_rosa_bill, which returns a sample bill for the demo. In production this is replaced with real EDI feeds.

When auditing Rosa's bill, the agent should use `fetch_and_audit_bill`, which fetches the sample bill and audits it in one step. The agent must not fabricate bill line items, totals, overcharges, or corrected amounts outside data returned by the billing tools.
