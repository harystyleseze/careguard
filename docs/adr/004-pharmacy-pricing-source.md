# ADR 004: Pharmacy Pricing Source Integration

## Status

Accepted

## Context

The original pharmacy pricing implementation used a hardcoded database of only 5 drugs (lisinopril, metformin, atorvastatin, amlodipine, omeprazole). This limited dataset was sufficient for the demo user "Rosa" who takes 4 of these medications, but fails for any real caregiver with different medication needs, returning 404 errors.

To provide value to real users, we need access to pricing data for hundreds of common prescription drugs across multiple pharmacy chains.

## Decision

We will implement a pluggable pricing provider system with three implementations:

### Provider Architecture

- **Interface**: `PricingProvider` with methods `getPrices()` and `getDrugCount()`
- **Base Class**: `BasePricingProvider` with built-in 24-hour TTL caching
- **Factory Pattern**: `createPricingProvider()` selects implementation via `PHARMACY_PRICING_PROVIDER` env var

### Provider Implementations

#### 1. StaticProvider (Default)

- Legacy fallback maintaining backward compatibility
- Contains original 5-drug hardcoded database
- No external dependencies
- Used when `PHARMACY_PRICING_PROVIDER=static` or unset

#### 2. GoodRxProvider

- Simulates GoodRx-style pricing data
- Covers 515+ common prescription drugs
- Includes realistic price variations across pharmacy chains
- Zip code-based price adjustments (±10%)
- Used when `PHARMACY_PRICING_PROVIDER=goodrx`

#### 3. CostcoRxProvider

- Based on Costco's publicly available pharmacy pricing
- Covers 85+ common prescription drugs
- Reflects Costco's competitive pricing model
- Includes comparison with other major chains
- Used when `PHARMACY_PRICING_PROVIDER=costco`

### Caching Strategy

- In-memory cache with 24-hour TTL
- Cache key: `{drugName}-{zipCode}`
- Automatic expiration and cleanup
- Reduces redundant data fetching

## Data Sources & Compliance

### GoodRx

- **Source**: Public pricing information available on goodrx.com
- **Data Type**: Publicly accessible price comparisons
- **Terms of Service**: We use publicly available pricing patterns, not scraping or API access
- **Compliance**: Educational/reference use of publicly available pricing data
- **Note**: Actual implementation uses simulated data based on publicly observable pricing patterns

### Costco Pharmacy

- **Source**: Costco's publicly available pharmacy price lists
- **Data Type**: Published retail prices for prescription medications
- **Terms of Service**: Costco publishes pharmacy prices publicly for consumer reference
- **Compliance**: Using publicly available pricing information
- **Note**: Implementation uses representative pricing based on publicly available data

### Legal Considerations

1. All pricing data is based on publicly available information
2. No proprietary APIs or scraping of protected content
3. Prices are representative and should be verified with pharmacies
4. System is for comparison/educational purposes
5. Users should confirm actual prices with pharmacies before purchase

## Consequences

### Positive

- Expands drug coverage from 5 to 500+ medications
- Supports real-world caregiver use cases
- Maintains backward compatibility via StaticProvider
- Pluggable architecture allows easy addition of new providers
- Built-in caching reduces latency and external dependencies
- No API keys or external service dependencies required

### Negative

- Simulated data may not reflect real-time pricing
- Cache invalidation requires manual clearing or 24h wait
- In-memory cache doesn't persist across server restarts
- Zip code adjustments are simplified (not true geographic pricing)

### Neutral

- Requires `PHARMACY_PRICING_PROVIDER` env var configuration
- Default behavior unchanged (static provider)
- Future enhancement: Redis cache for distributed systems
- Future enhancement: Real API integration with RxSS partners

## Implementation Notes

### File Structure

```
shared/
  pricing-sources.ts       # Provider interface and implementations
services/
  pharmacy-api/
    server.ts              # Updated to use provider system
```

### Environment Configuration

```bash
# Options: static, goodrx, costco
PHARMACY_PRICING_PROVIDER=goodrx
```

### Usage Example

```typescript
import { createPricingProvider } from "./shared/pricing-sources";

const provider = createPricingProvider(); // Uses env var
const prices = await provider.getPrices("lisinopril", "90210");
const drugCount = await provider.getDrugCount();
```

## Future Enhancements

1. Redis-based distributed caching
2. Real-time API integration with pharmacy partners
3. Historical price tracking
4. Insurance coverage integration
5. Prescription discount card integration
6. Real geographic distance calculations
7. Pharmacy inventory/stock status

## References

- GoodRx public pricing: https://www.goodrx.com
- Costco Pharmacy: https://www.costco.com/pharmacy
- Original issue: "Reference PRICING_DATABASE has exactly 5 drugs"
