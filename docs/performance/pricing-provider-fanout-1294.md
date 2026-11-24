# Pricing provider fan-out (#1294)

Run: `npm run benchmark:pricing-fanout`

`createPricingProvider()` selects one provider; the benchmark compares sequential vs `Promise.all` fan-out across `PRICING_PROVIDER_CONFIG`. Sequential sums latencies; parallel takes the max. A simulated 50ms slow provider penalises sequential fan-out only.

**Recommend:** `Promise.all` + per-provider timeouts if multi-source compare is added.

Closes #1294.
