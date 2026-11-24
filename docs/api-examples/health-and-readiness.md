# Health and Readiness Monitoring Guide (`/health` & `/ready`)

This guide explains how third-party integrators, API consumers, and uptime monitoring tools can monitor CareGuard service availability using the `/health` and `/ready` endpoints.

---

## Overview

CareGuard provides two distinct status monitoring endpoints:

1. **Liveness Probe (`GET /health`)**: A lightweight process check confirming that the CareGuard Web server is running and accepting HTTP connections.
2. **Readiness Probe (`GET /ready`)**: A comprehensive dependency check verifying that CareGuard has valid credentials, Stellar Horizon RPC network connectivity, and OpenZeppelin x402 facilitator access to process API transactions.

---

## Liveness vs. Readiness: Key Differences

| Feature | Liveness (`GET /health`) | Readiness (`GET /ready`) |
|---|---|---|
| **Primary Purpose** | Confirms Web process is alive | Confirms service is ready to handle API requests |
| **Dependency Checks** | None (no I/O or network pings) | Verifies env secrets, Horizon RPC, & x402 facilitator |
| **Response Speed** | Instant (< 2ms) | Dependent on Horizon RPC ping (< 1.5s timeout) |
| **Use Case** | Process supervisors, container restarts | Load balancers, traffic routing, uptime monitors |

---

## Endpoint Details

### 1. Liveness Probe (`GET /health`)

The `/health` endpoint performs no background network calls and returns immediately.

- **HTTP Method**: `GET`
- **URL**: `/health`
- **Authentication**: None

#### Healthy Response (`HTTP 200 OK`)

```json
{
  "status": "ok"
}
```

#### Degraded Response (`HTTP 200 OK`)

If the server booted in degraded mode (e.g. initial Horizon unreachable at startup), `/health` indicates degraded state while remaining alive:

```json
{
  "status": "degraded",
  "degraded": true
}
```

---

### 2. Readiness Probe (`GET /ready`)

The `/ready` endpoint inspects essential service dependencies before indicating that CareGuard is ready for live traffic.

- **HTTP Method**: `GET`
- **URL**: `/ready`
- **Authentication**: None

#### What `/ready` Checks

1. **`env`**: Ensures required system environment variables (`LLM_API_KEY`, `AGENT_SECRET_KEY`, `MPP_SECRET_KEY`, `CAREGIVER_TOKEN`) are configured.
2. **`horizon`**: Pings the Stellar Horizon RPC node to verify blockchain network connectivity.
3. **`ozFacilitator`**: Verifies that the x402 payment facilitator is reachable for processing micropayments.

---

#### Healthy Response (`HTTP 200 OK`)

When all dependency checks pass and the server is ready to process queries:

```json
{
  "status": "ok",
  "checks": {
    "env": true,
    "horizon": true,
    "ozFacilitator": true
  }
}
```

---

#### Unhealthy / Degraded Response (`HTTP 503 Service Unavailable`)

If any dependency check fails or if the server is in shutdown draining mode:

```json
{
  "status": "degraded",
  "checks": {
    "env": true,
    "horizon": false,
    "ozFacilitator": true
  }
}
```

##### Example with Missing Environment Variables

```json
{
  "status": "degraded",
  "checks": {
    "env": "missing: LLM_API_KEY, AGENT_SECRET_KEY",
    "horizon": true,
    "ozFacilitator": "not yet verified"
  }
}
```

---

## Integration Recommendations

- **Use `/ready` for Uptime Alerting**: Set your external uptime monitor (e.g., Datadog, UptimeRobot, Pingdom) to poll `GET /ready` every 30–60 seconds. Expect `HTTP 200` for normal operation.
- **Use `/ready` for Load Balancing**: Configure your load balancer or reverse proxy to route traffic only to instances returning `HTTP 200` on `GET /ready`.
- **Ignore Correlation Headers**: Health and readiness endpoints are unauthenticated probe routes and intentionally omit `requestId` tracing headers for maximum performance.
