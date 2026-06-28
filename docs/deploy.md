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

## Render Deploy Hook

`.github/workflows/deploy-render.yml` deploys the backend after the `CI` workflow succeeds on `main`.

Configure these GitHub Actions secrets:

- `RENDER_DEPLOY_HOOK`: Render deploy hook URL for the `careguard-api` service.
- `RENDER_API_KEY`: Render API key used to poll deploy status.
- `RENDER_SERVICE_ID`: Render service id, for example `srv-...`.
- `RENDER_DEPLOY_PAGE`: optional direct dashboard URL to include in workflow summaries. When omitted, the workflow builds a dashboard link from the service and deploy ids.

The workflow triggers the hook with:

```bash
curl -X POST "$RENDER_DEPLOY_HOOK"
```

It then polls the Render deploy API with exponential backoff for up to 5 minutes. The workflow summary links to the Render deploy page.

## Rollback

To roll back, open the GitHub Actions run for the previous known-good commit on `main` and re-run its `Deploy Render` workflow. That re-posts the Render deploy hook for that commit and lets the status poll verify the replacement deploy.
