# Local service setup

CareGuard runs a main server plus several local services. By default, everything binds to `localhost` on fixed ports.

## Prereqs

- Node.js `>= 22`
- Install deps: `npm ci`

## Environment

Create a `.env` file (or set env vars in your shell). The most common local setup is:

```bash
# Main agent
AGENT_SECRET_KEY=...

# Service URLs (optional; defaults shown)
PHARMACY_API_URL=http://localhost:3001
BILL_AUDIT_API_URL=http://localhost:3002
DRUG_INTERACTION_API_URL=http://localhost:3003
PHARMACY_PAYMENT_URL=http://localhost:3005

# Service recipients (required by services)
PHARMACY_1_PUBLIC_KEY=...
PHARMACY_2_PUBLIC_KEY=...
BILL_PROVIDER_PUBLIC_KEY=...

# Pharmacy payment service
MPP_SECRET_KEY=...
```

## Run all services

```bash
npm run services
```

## Run an individual service

```bash
npm run pharmacy-api
npm run bill-audit-api
npm run drug-api
npm run pharmacy-payment
```
