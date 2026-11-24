# Authentication for CareGuard API Consumers

CareGuard uses different credentials for different routes. A caregiver token is not an x402 payment, and neither credential should be sent to an endpoint that does not require it. Keep all tokens private and obtain them from the operator of your CareGuard deployment.

## Endpoint authentication map

| Endpoint(s) | Required scheme | Credential or header |
|---|---|---|
| `GET /pharmacy/compare`, `POST /bill/audit`, `GET /drug/interactions` | x402 payment | Respond to the `402 Payment Required` challenge and retry with a valid `X-Payment` proof. These routes do not use the caregiver token. |
| `GET /recipients`, `POST /recipients` | Caregiver token | `Authorization: Bearer <CAREGIVER_TOKEN>`; a browser cookie flow is also supported with a matching CSRF header. |
| `/agent/*` routes | Agent API key | `Authorization: Bearer <AGENT_API_KEY>`. This is separate from `CAREGIVER_TOKEN`; production deployments require the agent API key. |
| `POST /pharmacy/drugs`, `PUT /pharmacy/drugs/{drugName}`, `DELETE /pharmacy/drugs/{drugName}`, `POST /pharmacy/pharmacies`, `PUT /pharmacy/pharmacies/{pharmacyId}`, `DELETE /pharmacy/pharmacies/{pharmacyId}`, `POST /pharmacy/prices` | Pharmacy admin token | `Authorization: Bearer <PHARMACY_ADMIN_TOKEN>`. These are administrative routes, not caregiver routes. |
| `POST /pharmacy/order` | MPP payment authorization | Use the MPP challenge and authorization headers described in [Pharmacy Order API Example](pharmacy-order.md). This is a separate payment flow, not x402 or caregiver-token authentication. |
| `GET /health`, `GET /ready` | None | These health-check routes are public. |

Other routes may be available depending on the deployment. Check with its operator before relying on this list for a customized installation.

## Example: caregiver-token request

The following requests the care-recipient list. Replace the base URL with your deployment's API address and set `CAREGIVER_TOKEN` in your shell without sharing it:

```bash
curl --get "${CAREGUARD_API_URL}/recipients" \
  --header "Authorization: Bearer ${CAREGIVER_TOKEN}"
```

A missing caregiver token returns `401`; an incorrect one returns `403`. The token is configured and rotated by the deployment operator; CareGuard does not issue it through a sign-in flow.

## Example: x402 is payment, not a bearer token

For an x402-protected route, a request without proof receives `402 Payment Required`. The response describes the accepted payment. After constructing a valid proof, retry the same request with `X-Payment`. Do not put `CAREGIVER_TOKEN` in `X-Payment`, or send an x402 proof as `Authorization: Bearer`.

For details on x402 challenges, see [Paying for CareGuard Endpoints with x402](paying-with-x402.md). For the caregiver-token authorization boundary and token lifecycle, see [Authentication and Authorization Model](../security/authn-authz.md).