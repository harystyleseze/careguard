# What it costs to run the agent

CareGuard's agent pays a very small fee every time it looks something up — a pharmacy
price, a bill audit, a drug interaction check. This guide explains those fees in plain
terms and, importantly, keeps them separate from the actual medication and bill payments
the agent makes on your behalf.

For the detailed engineering model, worksheets, and monthly estimation formula, see the
[Agent Cost Estimation Guide](../cost-estimation.md).

---

## Two very different kinds of money

| | Agent operating costs | Medication and bill payments |
|---|---|---|
| **What it is** | Tiny fees for the agent's own lookups (price checks, audits, interaction checks) | The real cost of the medications ordered and the corrected hospital bills paid |
| **Who gets paid** | The service that runs the price/audit/interaction lookups | The pharmacy and the medical provider |
| **Typical size** | Fractions of a cent per lookup | Dollars to hundreds of dollars |
| **Counts against your spending policy?** | No — these are not in the medication or bill budgets | Yes — every payment is checked against your daily, monthly, and category limits |

When this guide says "what it costs," it means the first column only: the agent's own
running costs. Those are what the rest of this page breaks down.

---

## Per-action operating costs

Every lookup the agent does is paid as a small fee over the Stellar payment network (in
practice money by default — see [Testnet Explained](testnet-explained.md)).

| Agent action | What it does | Cost |
|---|---|---|
| **Check one medication's price** | Queries about 5 nearby pharmacies for one drug | about **$0.01** (5 pharmacies × $0.002 each) |
| **Check drug interactions** | Checks all of the recipient's medications against each other, in one pass | **$0.001** |
| **Audit one medical bill** | Reviews every line item on a bill for overcharges, duplicates, and upcoding | **$0.01** |
| **Agent thinking (AI model)** | The language model that decides what to do | often **$0** on the free tier, up to a few tenths of a cent per task otherwise |

So a full "compare all medications, check interactions, audit a bill" run for one person
costs a few cents in operating costs — not dollars.

---

## The Maria and Rosa example

From the [README](../../README.md#use-case-maria--rosa):

> CareGuard found **$69.76/month in medication savings** and caught **$1,195 in billing
> errors** — for **$0.03 in agent API costs**.

That three-cent figure is the agent's total operating cost for the whole job:

| Part of the job | Lookups | Cost |
|---|---|---|
| Medication price comparison | 10 price queries × $0.002 | $0.020 |
| Drug interaction check | 1 check × $0.001 | $0.001 |
| Medical bill audit | 1 audit × $0.01 | $0.010 |
| **Total operating cost** | | **~$0.03** |

The **$0.03** did not buy any medication or pay any hospital bill. It only paid for the
agent's lookups. The medications Rosa actually ordered and the corrected hospital bill were
paid separately — those came out of Maria's spending budget and showed up in the Activity
tab. (In that same end-to-end test the agent's wallet spent about **$7.53** in total, which
was mostly the real medication and bill payments plus the three cents of fees.)

The point of the example: the agent spent **3 cents** to find **$69.76/month** in savings
and **$1,195** in billing errors.

---

## Where to see your own costs

- **Overview tab → Agent API Costs** shows what the agent has spent on lookups.
- **Overview tab → Monthly Spending** shows the real medication and bill payments — a
  different number.
- **Activity tab** lists every transaction with its amount and type.

---

## Related reading

- [Agent Cost Estimation Guide](../cost-estimation.md) — the technical model, per-operation table, and monthly estimation worksheet
- [Spending Policy Settings](spending-policy-for-caregivers.md) — how the limits on real payments work
- [Glossary](glossary.md) — x402, USDC, testnet, and other terms
- [Verified results](../../README.md#verified-results) — measured figures from a real end-to-end test
