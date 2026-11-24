# Using the built-in /docs API explorer

CareGuard includes a built-in API explorer that serves the OpenAPI specification in a browser-friendly UI at `/docs`.

## Open the docs UI

When the app is running locally, open:

- `http://localhost:3000/docs`

If you are running a different host or port, use that URL instead.

The page is powered by the OpenAPI spec in [docs/openapi.yml](../openapi.yml).

## What you can do there

The `/docs` UI lets you:

- browse the available endpoints
- read request and response schemas
- try simple API calls from the browser
- inspect examples and parameter names before writing code

This is especially useful for developers and integrators who want to understand the CareGuard agent and payment APIs without reading raw YAML.

## Trying an x402-protected request

Some endpoints are protected using x402 and require a wallet challenge and payment flow before the request succeeds.

In practice, the browser UI is helpful for:

1. viewing the endpoint contract
2. preparing request bodies
3. understanding the expected authentication model

But real x402 testing from the browser is limited because the browser does not automatically hold the wallet signing flow needed to complete the 402 challenge.

## Important limitations of browser testing

A browser can show the request and schema, but it usually cannot complete the full x402 payment flow on its own because the request requires signed wallet authorization and facilitator settlement.

That means:

- simple unauthenticated or documentation-only calls are fine to try
- real x402-protected transactions usually need a local client script, the dashboard, or a custom signed request flow
- the browser UI is best for exploration and specification review, not live payment simulation

## Recommended next step

If you need to test real money or payment logic, use:

- the dashboard flow in the app
- a Node or TypeScript client that signs the x402 challenge
- the local development server and the testnet wallet setup in [QUICKSTART.md](../../QUICKSTART.md)

## Related docs

- [README.md](../../README.md)
- [QUICKSTART.md](../../QUICKSTART.md)
- [docs/openapi.yml](../openapi.yml)
