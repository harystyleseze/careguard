# CareGuard FAQ

Common questions caregivers ask when they first start using CareGuard's autonomous payment agent.

## Is CareGuard using real money?

Not by default. CareGuard currently operates on Stellar testnet, which means the transactions are real blockchain transactions on the test network, but they use testnet funds instead of real money. Mistakes on testnet do not cost you anything. See [testnet-explained.md](testnet-explained.md) for a plain-language explanation.

## How do I know if I'm on testnet or using real funds?

Check the **Wallet tab** — it shows the network as either "Stellar Testnet" or "Stellar Mainnet." If your CareGuard instance was set up by someone else, ask them which network it's configured for before assuming your money is safe from real spending. See [wallet-tab.md](wallet-tab.md).

## Can the agent spend as much as it wants?

No. Every payment is checked against spending limits you set yourself in the **Policy tab**: a daily limit, a monthly limit, separate budgets for medications and bills, and a per-payment approval threshold. If a payment would exceed any of these, the agent stops or asks for your approval instead of paying. See [spending-policy-for-caregivers.md](spending-policy-for-caregivers.md).

## What happens if a payment is above my approval threshold?

The agent holds the payment instead of completing it, and it shows up in the dashboard for you to approve or cancel. If you don't respond within the hold time you configured (for example, one hour), the payment is automatically approved so a time-sensitive medication order or bill doesn't get stuck indefinitely. You can shorten or lengthen this hold time in the Policy tab. See [spending-policy-for-caregivers.md](spending-policy-for-caregivers.md).

## What happens if the agent makes a mistake?

Mistakes fall into two categories, and CareGuard handles them differently:

- **A bad decision the agent shouldn't have made** (e.g. ordering from a pricier pharmacy) — you can't undo a completed Stellar payment, but every transaction is logged in the Activity tab with a link to view it on the Stellar block explorer, so nothing happens silently. On testnet, the cost of a mistake is testnet money, not real money.
- **A billing error CareGuard itself catches** — this is actually the product working as intended. When the Bill Audit finds an overcharge, duplicate charge, or upcoded procedure on a bill from a healthcare provider, it flags it and can generate a dispute letter for you to send. See [bill-disputes.md](bill-disputes.md).

There's no automatic "undo" or refund mechanism inside the app — treat every agent payment as final once it's on-chain, and use the spending limits and approval threshold to control risk up front rather than relying on reversal after the fact.

## Can I see what the agent paid for?

Yes. The **Activity tab** lists every payment and API call the agent has made, and the **Wallet tab** shows a link to view the agent's full transaction history on the Stellar block explorer. Nothing the agent spends is hidden from you.

## What is a dispute letter, and does CareGuard send it for me?

When a bill audit finds an error, you can generate a dispute letter addressed to the billing department from the Bills tab. CareGuard prepares the letter (as a downloadable PDF or an email-ready draft) but does not send it — you review it and send it yourself through whichever channel the facility accepts. See [bill-disputes.md](bill-disputes.md) for the full workflow and its current limitations.

## What are category budgets, and why would I use them?

The Policy tab lets you set one overall spending limit and separate category caps for medications and medical bills. This stops one type of spending from consuming your entire monthly budget — for example, capping medication spending at $200/month even if you've allowed $500/month overall. See [category-budgets-examples.md](category-budgets-examples.md).

## What happens if I raise a spending limit?

The dashboard asks you to confirm any limit increase. If you more than double a limit, you have to type **CONFIRM** to proceed — a deliberate friction point so that limit increases are always intentional rather than accidental clicks. See [spending-policy-for-caregivers.md](spending-policy-for-caregivers.md).

## Why did the agent stop making payments partway through the month?

Most likely one of your spending limits was reached. If the daily or monthly limit is hit, all spending stops until the period resets. If only a category budget (medications or bills) is exhausted, the other category can still spend if it has room left. Check the Policy tab to see which limit is at capacity, and raise it if you want the agent to keep spending this period.

## Why did the agent stop responding entirely?

The agent pauses itself if its Stellar wallet runs low on USDC (for payments) or XLM (for network fees), so it doesn't attempt transactions that would fail. A red banner on the dashboard tells you which balance is low and what to do. See [agent-pause-and-resume.md](agent-pause-and-resume.md).

## How do I use the API docs explorer?

Open the app's `/docs` route to explore the OpenAPI schema in a browser. See [../api-examples/using-the-docs-ui.md](../api-examples/using-the-docs-ui.md).

## Where do I start if I want to run the app locally?

Start with the [README.md](../../README.md) and then the [QUICKSTART.md](../../QUICKSTART.md) guide.

## Related reading

- [Getting Started for Caregivers](getting-started-caregiver.md)
- [Spending Policy for Caregivers](spending-policy-for-caregivers.md)
- [Testnet Explained](testnet-explained.md)
- [Agent Pause and Resume](agent-pause-and-resume.md)
- [Disputing a Medical Bill](bill-disputes.md)
## What do terms like x402, USDC, and testnet mean?

The [Glossary](glossary.md) explains the payment and technical terms used across the
dashboard and docs — x402, MPP, USDC, Stellar, testnet, spending policy, approval
threshold, and more — in plain language.

## Can I manage more than one care recipient?

Partly. CareGuard can store multiple recipients and the dashboard can switch between them,
but there is no dashboard button to add one yet, and spending limits and activity are
shared across all recipients. See [Managing Multiple Care Recipients](multiple-care-recipients.md).
