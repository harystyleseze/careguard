# Pharmacy API

x402-protected medication price comparison service. Serves `GET /pharmacy/compare` — callers pay `$0.002` per query via the OZ Facilitator on Stellar testnet.

## Storage

Pricing data lives in a SQLite file managed by `PharmacyPricingStore` (`db.ts`):

| Environment | Path |
|---|---|
| Default (dev) | `data/pharmacy-pricing.sqlite` |
| Custom | set `PHARMACY_DB_PATH` in `.env` |
| Tests | `:memory:` (never touches disk) |

The DB is created and seeded automatically on first start — no manual migration step needed.

Schema: three tables — `pharmacies`, `drugs`, `prices` (drug × pharmacy join with price).

## Inspecting the local DB

Use the project helper script instead of raw `sqlite3` CLI:

```bash
# Full summary — pharmacies, all drug prices
npx tsx scripts/inspect-pharmacy-db.ts

# Filter to a single drug
npx tsx scripts/inspect-pharmacy-db.ts --drug lisinopril
npx tsx scripts/inspect-pharmacy-db.ts --drug atorvastatin
```

If the DB file doesn't exist yet, the script prints the exact command to create it.

## Seeded drugs

| Drug | Example price range |
|---|---|
| lisinopril | $3.50 – $18.99 |
| metformin | $4.00 – $16.79 |
| atorvastatin | $6.50 – $31.99 |
| amlodipine | $4.00 – $19.99 |
| omeprazole | $5.80 – $27.99 |

Prices vary by pharmacy. Costco and Walmart are consistently cheapest; CVS, Walgreens, and Rite Aid are higher — this spread is intentional to make the price-comparison agent's value visible.

## Updating prices

Use the admin HTTP endpoints (requires `PHARMACY_ADMIN_TOKEN` or `CAREGIVER_TOKEN`):

```bash
# Upsert a price
curl -X PUT http://localhost:3004/pharmacy/prices \
  -H "Authorization: Bearer $CAREGIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"drug":"lisinopril","pharmacyId":"cvs-001","price":9.99}'

# Add a new drug
curl -X PUT http://localhost:3004/pharmacy/drugs \
  -H "Authorization: Bearer $CAREGIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"metoprolol","displayName":"Metoprolol"}'
```

## Running locally (standalone)

```bash
npm run pharmacy-api
# or via the unified server:
npm run dev
```

The service is also started as part of `docker compose up`.
