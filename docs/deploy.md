# CareGuard Deployment

This is the production deployment guide for CareGuard.

## Dashboard (Vercel)

1. Import the repository in Vercel.
2. Set project root to `dashboard`.
3. Configure environment variable:
   - `NEXT_PUBLIC_API_URL` = your deployed CareGuard API base URL.
4. Deploy.

## Backend

Deploy the root unified server (`server.ts`) on a Node.js host that supports outbound HTTPS and environment variables.

Required environment variables include:

- `LLM_API_KEY`
- `AGENT_SECRET_KEY`
- `PHARMACY_1_PUBLIC_KEY`
- `BILL_PROVIDER_PUBLIC_KEY`
- `MPP_SECRET_KEY`
- `OZ_FACILITATOR_API_KEY` (required for public network)

See `.env.example` and `README.md` for full setup context.
