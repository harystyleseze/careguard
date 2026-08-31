# CareGuard FAQ

## Is CareGuard using real money?

Not by default. CareGuard currently operates on Stellar testnet, which means the transactions are real blockchain transactions on the test network, but they use testnet funds instead of real money. See [testnet-explained.md](testnet-explained.md) for a plain-language explanation.

## What do the category budgets do?

The Policy tab lets you set one overall spending limit and separate category caps for medications and medical bills. This helps prevent one type of spending from consuming the entire monthly budget. See [category-budgets-examples.md](category-budgets-examples.md).

## How do I use the API docs explorer?

Open the app's `/docs` route to explore the OpenAPI schema in a browser. See [../api-examples/using-the-docs-ui.md](../api-examples/using-the-docs-ui.md).

## Where do I start if I want to run the app locally?

Start with the [README.md](../../README.md) and then the [QUICKSTART.md](../../QUICKSTART.md) guide.

## What do terms like x402, USDC, and testnet mean?

The [Glossary](glossary.md) explains the payment and technical terms used across the
dashboard and docs — x402, MPP, USDC, Stellar, testnet, spending policy, approval
threshold, and more — in plain language.

## Can I manage more than one care recipient?

Partly. CareGuard can store multiple recipients and the dashboard can switch between them,
but there is no dashboard button to add one yet, and spending limits and activity are
shared across all recipients. See [Managing Multiple Care Recipients](multiple-care-recipients.md).
