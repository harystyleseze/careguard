# GET /pharmacy/compare latency vs pharmacy count (#1293)

```bash
npm run benchmark:pharmacy-compare
```

Set `BENCHMARK_ITERATIONS` (default 500) to change sample size.

## What is measured

The benchmark reproduces the CPU path in `services/pharmacy-api/server.ts`:

1. `getPharmacyPrices` (static DB baseline — five pharmacies per drug today)
2. `buildCompareResponse` + `JSON.stringify` with synthetic price lists of **10 / 100 / 1000** pharmacies

x402 payment and network I/O are excluded; they dominate real p99 in production.

## Findings

- **Aggregation is O(n) in pharmacy count.** `buildCompareResponse` maps every price, sorts the list, and serialises the full array — cost grows roughly linearly with `prices.length`.
- **Production dataset is tiny today.** `shared/pharmacy-pricing.ts` returns five pharmacies per drug/zip, so handler CPU is sub-millisecond; latency is dominated by middleware and x402.
- **Risk appears if the pricing store grows** (admin upserts, merged provider feeds) without pagination or caching.

## Recommendations

1. **Response cache** keyed by `(drug, dosage, zip)` with TTL aligned to provider cache (24h in `BasePricingProvider`).
2. **Cap or paginate** compare results (e.g. top 25 by price) when store size exceeds a threshold.
3. **Pre-index** cheapest price per `(drug, zip)` if compare stays hot and lists grow past ~100 rows.

Closes #1293.
