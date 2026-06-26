# Drug Name Normalization

All drug name lookups in CareGuard are **case-insensitive**. Normalization happens at two layers:

## Layer 1 — Module init (source data)

Both the pharmacy pricing database and the drug-interaction database normalize their keys/pairs to lowercase **when the module is first loaded**, before any request arrives.

### `shared/pricing-sources.ts`

`StaticProvider.PRICING_DATABASE` keys are normalized via an IIFE:

```ts
private static PRICING_DATABASE = (() => {
  const raw = { Lisinopril: [...], ... };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
})();
```

`GoodRxProvider.generateDrugDatabase()` and `CostcoRxProvider.generateCostcoDrugDatabase()` use `drug.name.toLowerCase()` as the record key when building the in-memory database at construction time.

### `services/drug-interaction-api/server.ts`

`INTERACTIONS` pairs are normalized into `NORMALIZED_INTERACTIONS` at module load:

```ts
const NORMALIZED_INTERACTIONS = INTERACTIONS.map(ix => ({
  ...ix,
  drugs: [ix.drugs[0].toLowerCase(), ix.drugs[1].toLowerCase()] as [string, string],
}));
```

`checkInteractions()` then iterates `NORMALIZED_INTERACTIONS` instead of `INTERACTIONS`.

## Layer 2 — Request time (input normalization)

`checkInteractions()` already lowercases and trims every input medication before matching:

```ts
const meds = medications.map(m => m.toLowerCase().trim());
```

`GoodRxProvider.getPrices()` and `CostcoRxProvider.getPrices()` use `drugName.toLowerCase().trim()` as the lookup key.

## Why two layers?

Defense-in-depth. If a future contributor bypasses the input normalization (or the source data is updated with mixed-case keys), the module-init normalization ensures matches still succeed. Neither layer alone is sufficient insurance.

## Tests

- `services/pharmacy-api/__tests__/drug-normalization.test.ts` — verifies that 5 capitalization variants of a drug name all resolve via `.toLowerCase()` lookup.
- `services/drug-interaction-api/__tests__/drug-normalization.test.ts` — verifies that 5 capitalization variants match against normalized interaction pairs and that severity is preserved after normalization.
