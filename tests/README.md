# Test Fixtures & Factories

## factories.ts

Factories for every interface in `shared/types.ts`. Each factory produces realistic,
deterministic fixture data consistent with the Rosa Garcia persona.

### Usage

```ts
import { makeTx, makePolicy } from "../tests/factories.ts";

const tx = makeTx({ amount: 100, status: "blocked" });
const policy = makePolicy({ billMonthlyBudget: 400 });
```

### Available Factories

| Factory | Type | Notes |
|---|---|---|
| `makeMedication` | `Medication` | Defaults to Lisinopril 10mg |
| `makePharmacyPrice` | `PharmacyPrice` | Random pharmacy from known set |
| `makePriceComparisonResult` | `PriceComparisonResult` | 3 pharmacy prices, cheapest/most expensive computed |
| `makeBillLineItem` | `BillLineItem` | Random charged amount + fair market rate |
| `makeBillAuditResult` | `BillAuditResult` | 3 line items, 1 upcoded |
| `makeSpendingPolicy` | `SpendingPolicy` | Default values matching Rosa's policy |
| `makeTransaction` | `Transaction` | Random type (medication/bill/service_fee) with appropriate amounts |
| `makeAgentAction` | `AgentAction` | Random tool with a generated transaction |
| `makeCareRecipient` | `CareRecipient` | Rosa Garcia with 4 medications |
| `makeAlert` | `Alert` | Random alert type, defaults to policy_blocked scenario |

Every factory accepts a partial `overrides` object:

```ts
makeTransaction({ amount: 600, status: "blocked" })
```

### Determinism

A seeded PRNG (`seed = 42`) ensures all factory outputs are reproducible across test runs.
