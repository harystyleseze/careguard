# Glossary

CareGuard's dashboard and documentation use some payment and technical terms that may be
unfamiliar. This page explains them in plain language, with no assumed background.

Terms are grouped by topic. Within the definitions, any other term that has its own entry
is written in **bold**.

---

## Money and payments

### USDC

A digital form of US dollars. One USDC is meant to always be worth about one US dollar.
CareGuard's agent holds and spends USDC rather than dollars in a bank account. In the
default setup this is practice money (see **testnet**), not real funds.

### Stellar

The payment network CareGuard uses to move **USDC** from the agent to pharmacies and
medical providers. Think of it as the rails the payments run on. Every payment the agent
makes is recorded on Stellar and can be looked up later.

### Testnet

A practice copy of the **Stellar** network that uses play money. CareGuard runs on testnet
by default, so no real money is involved. Payments behave exactly as they would with real
funds — the same limits, the same checks — but the USDC on testnet cannot be exchanged for
real dollars. See [Testnet Explained](testnet-explained.md).

### Mainnet (also "public network")

The real **Stellar** network, where **USDC** has real value. CareGuard does *not* use
mainnet in the default setup. Running on mainnet would require separate configuration and a
real funding source.

### Wallet

The agent's account that holds its **USDC** balance. The **Wallet** tab in the dashboard
shows the current balance. This is the money the agent draws on to pay for medications,
bills, and its own lookups.

### Wallet address (also "public key")

The long string of letters and numbers that identifies the agent's **wallet** on
**Stellar** — similar to an account number. It is safe to share; it is how a payment finds
its destination.

### Transaction hash

The unique ID of a single payment on **Stellar**. The **Activity** tab shows a transaction
hash for each payment. You can paste it into the **Stellar explorer** to see the payment
independently.

### Stellar explorer (stellar.expert)

A public website — [stellar.expert](https://stellar.expert/explorer/testnet) — where you
can look up any **transaction hash** or **wallet address** and confirm the details of a
payment yourself, outside of CareGuard.

---

## Payment protocols

### x402

The method the agent uses to pay a small fee for each information lookup it does — checking
a pharmacy price, auditing a bill, checking drug interactions. Each lookup costs a fraction
of a cent. The name comes from "402 Payment Required," a standard web response that means
"pay to continue." With x402, the agent automatically makes that tiny payment and gets the
data back. These fees are the agent's operating cost, not a medication or bill payment —
see [What It Costs](what-it-costs.md).

### MPP (Machine Payments Protocol)

The method the agent uses to pay a pharmacy for a medication order. The pharmacy asks for
payment, the agent approves and signs it, and the pharmacy confirms the order. Unlike
**x402** (used for small lookup fees), MPP is used for the actual price of the medication.

### Direct USDC transfer

The method the agent uses to pay a medical provider for a bill — it simply sends the
**USDC** straight to the provider on **Stellar**. Used for bill payments, after an audit
has corrected any overcharges.

### OZ Facilitator (OpenZeppelin)

An outside service that helps settle the small **x402** lookup fees on **Stellar**. The
caregiver never interacts with it directly; it works in the background so the agent's
lookups can be paid for automatically.

---

## Spending controls

### Spending policy

The full set of limits you configure in the **Policy** tab that the agent cannot exceed:
the daily limit, the monthly limit, the medication budget, the bill budget, and the
**approval threshold**. The agent checks the spending policy before every payment and stops
if a payment would break a limit. See [Spending Policy Settings](spending-policy-for-caregivers.md).

### Approval threshold

A dollar amount you set. Any single payment above that amount is paused and waits for you
to approve it in the dashboard before it goes through. Payments at or below the amount go
through automatically. For example, with a $75 threshold, a $60 order proceeds on its own
but a $120 bill payment waits for you.

### Category budget

A monthly spending cap for one type of spending — either medications or medical bills — set
separately from the overall monthly limit. It stops one category from using up the whole
month's budget. See [Category Budget Examples](category-budgets-examples.md).

### Hold time before auto-approval

When a payment is paused by the **approval threshold**, this is how long it waits for your
response before the agent approves it automatically. Set it long enough that you have time
to review, or short enough that routine payments are not held up.

---

## The agent and audits

### Agent

The automated assistant at the center of CareGuard. It compares medication prices, checks
drug interactions, audits medical bills, and makes payments — all within your **spending
policy**. It acts on your behalf but only within the limits you set.

### LLM (large language model)

The artificial-intelligence system that powers the agent's reasoning — it reads your
request, decides which steps to take, and interprets the results. "LLM" is the general
industry term for this kind of AI.

### CPT code

A standard five-character code that identifies a specific medical procedure or service on a
bill (for example, `80053` for a metabolic blood panel). CareGuard's bill audit uses these
codes to look up what each service should cost.

### CMS Medicare fair-market rate

The benchmark price CareGuard compares your bill against. CMS (the US Centers for Medicare
& Medicaid Services) publishes standard rates for medical procedures. If a charge is far
above the fair-market rate for its **CPT code**, the audit flags it.

### Upcoding

A billing error where a provider bills for a more expensive or more complex service than
the one actually performed. CareGuard's audit flags charges that look like upcoding — for
example, a charge more than three times the **fair-market rate**.

### Dispute letter

A formal letter, generated by CareGuard from a bill audit, that lists the billing errors
found and asks the provider to correct them. CareGuard drafts and formats the letter; you
send it. See [Sending a Generated Dispute Email](sending-a-dispute-email.md).

### Caregiver token

A secret string that acts as the password for your CareGuard instance. The dashboard and
the API use it to confirm that requests are really coming from you. Keep it private.

---

## Related reading

- [Getting Started with CareGuard](getting-started-caregiver.md) — first-time setup
- [FAQ](faq.md) — common questions
- [Testnet Explained](testnet-explained.md) — why CareGuard uses practice money
- [Spending Policy Settings](spending-policy-for-caregivers.md) — configuring the limits
- [What It Costs](what-it-costs.md) — the agent's operating costs
