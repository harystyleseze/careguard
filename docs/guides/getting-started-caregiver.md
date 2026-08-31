# Getting Started with CareGuard — A Guide for Caregivers

This guide walks you through setting up CareGuard for the first time. You do not need any technical background — just a web browser and a few minutes.

---

## What CareGuard does

CareGuard is an AI agent that helps you manage healthcare spending for a loved one. It:

- compares medication prices across pharmacies
- catches billing mistakes before you pay a hospital bill
- checks for harmful drug interactions
- enforces spending limits you set
- logs every transaction so you can review it

The agent holds a digital wallet and can make payments on your behalf — but only within the limits you configure.

---

## Step 1: Open the dashboard

After CareGuard is set up and running, open the dashboard in your web browser:

```
http://localhost:3000
```

You will see the **Overview** tab, which is your main screen.

---

## Step 2: Understand the Overview tab

The Overview tab shows you everything at a glance:

- **Monthly Spending** — how much the agent has spent this month
- **Savings Found** — money the agent saved by finding cheaper pharmacies
- **Billing Errors** — overcharges the agent caught on medical bills
- **Agent API Costs** — the cost of running the agent's searches

Below the summary cards, you will see:

- **Budget Status** — progress bars showing how much of each category budget has been used
- **Agent Actions** — buttons to run specific tasks (compare prices, audit a bill, etc.)

---

## Step 3: Set up spending limits

Go to the **Policy tab** to configure how much the agent can spend.

The key settings are:

| Setting | What it means |
|---|---|
| Daily Spending Limit ($) | Maximum the agent can spend in one day |
| Monthly Spending Limit ($) | Maximum the agent can spend in a month |
| Medication Monthly Budget ($) | Maximum the agent can spend on medications in a month |
| Bill Monthly Budget ($) | Maximum the agent can spend on medical bills in a month |
| Caregiver Approval Threshold ($) | Payments above this amount need your approval |

For a detailed walkthrough of each setting, see [Spending Policy for Caregivers](spending-policy-for-caregivers.md).

**Tip:** Start with conservative limits and increase them as you get comfortable with the agent.

---

## Step 4: Run your first task

From the Overview tab, click one of the Agent Actions:

- **Compare Medication Prices** — the agent searches nearby pharmacies for the cheapest prices on your care recipient's medications
- **Audit Hospital Bill** — the agent scans a medical bill for errors, duplicates, and overcharges
- **Try Over-Budget Payment** — a demo that shows the agent blocking a payment that exceeds the spending policy

After you click a task, you will see the agent working in real time. When it finishes, the results appear on the Overview tab.

---

## Step 5: Review activity

Go to the **Activity tab** to see a log of every transaction the agent has made. Each entry shows:

- the time of the transaction
- what type of transaction it was (medication order, bill payment, etc.)
- a description of what happened
- the amount spent
- whether the transaction succeeded or was blocked

You can download a report of all activity from this tab.

---

## Step 6: Monitor the wallet

The **Wallet tab** shows the agent's current USDC balance on Stellar testnet. This is the fund the agent uses to make payments.

In the default setup, this uses testnet money — no real funds are involved. See [Testnet Explained](testnet-explained.md) for more details.

---

## What happens after signup

Once the dashboard is running:

1. The agent monitors the care recipient's medications and bills
2. When you click an action button, the agent performs the task
3. Every payment is checked against your spending policy before it goes through
4. All activity is logged and visible in the Activity tab

The agent does not make any payments without your knowledge. If a payment requires your approval (above the threshold), it will pause and wait for you.

---

## Tips for new caregivers

- Start by comparing medication prices — this is the safest way to see the agent in action
- Set a low approval threshold ($25-$50) until you trust the agent's decisions
- Check the Activity tab regularly to stay informed about spending
- Use the Policy tab to adjust limits as your care recipient's needs change

---

## Need help?

- [Glossary](glossary.md) — plain-language definitions of x402, USDC, testnet, spending policy, and other terms
- [Spending Policy for Caregivers](spending-policy-for-caregivers.md) — understanding the Policy tab
- [Category Budget Examples](category-budgets-examples.md) — worked examples of budget configurations
- [Testnet Explained](testnet-explained.md) — why CareGuard uses testnet money
- [What It Costs](what-it-costs.md) — the agent's own operating costs versus real payments
- [Managing Multiple Care Recipients](multiple-care-recipients.md) — current support and limitations
- [FAQ](faq.md) — common questions and answers
