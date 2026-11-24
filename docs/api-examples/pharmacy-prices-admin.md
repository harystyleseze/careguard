# Admin Pharmacy Price Upsert API Guide (`POST /pharmacy/prices`)

This guide explains how admin callers can insert or update medication pricing for pharmacies via CareGuard's `/pharmacy/prices` endpoint, required authentication credentials, and how updates affect user price comparisons.

---

## Overview

The `POST /pharmacy/prices` endpoint allows authorized administrators and automated pharmacy data sync jobs to upsert drug prices in CareGuard's pharmacy pricing store. 

If a price record already exists for the specified `drug` and `pharmacyId` pair, the existing price is updated to the new value. If no record exists, a new price record is created.

---

## Authentication & Authorization

This is an **admin-only endpoint**. Requests require Bearer token authentication via the HTTP `Authorization` header:

```http
Authorization: Bearer <PHARMACY_ADMIN_TOKEN>
```

> [!IMPORTANT]
> - `PHARMACY_ADMIN_TOKEN` must be configured in your environment variables.
> - If `PHARMACY_ADMIN_TOKEN` is unset on the server, authentication defaults to `CAREGIVER_TOKEN`.
> - Requests missing an `Authorization` header will fail with `401 Unauthorized` (`AUTH_TOKEN_MISSING`).
> - Requests with invalid tokens will fail with `403 Forbidden` (`AUTH_TOKEN_INVALID` or `AUTH_ADMIN_REQUIRED`).

---

## Request & Response Format

### Request Format

- **HTTP Method**: `POST`
- **URL**: `/pharmacy/prices`
- **Content-Type**: `application/json`

#### Body Schema

| Field | Type | Required | Description | Constraints |
|---|---|---|---|---|
| `drug` | `string` | Yes | Medication name | 1–80 characters |
| `pharmacyId` | `string` | Yes | Unique pharmacy identifier | 1–80 characters |
| `price` | `number` | Yes | Price in USD | `0 < price <= 10000` |

#### Sample Request

```bash
curl -X POST https://api.careguard.xyz/pharmacy/prices \
  -H "Authorization: Bearer my-admin-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "drug": "lisinopril",
    "pharmacyId": "cvs-phoenix-01",
    "price": 11.49
  }'
```

---

### Response Format

#### Successful Response (`200 OK`)

Returns the updated or created price record object:

```json
{
  "price": {
    "drug": "lisinopril",
    "pharmacyId": "cvs-phoenix-01",
    "price": 11.49,
    "updatedAt": "2026-08-27T20:30:00.000Z"
  }
}
```

#### Error Responses

##### `400 Bad Request` (Invalid Payload / Validation Failure)

Returned when required fields are missing or out of bounds:

```json
{
  "error": "price must be positive",
  "code": "VALIDATION_INVALID_INPUT"
}
```

##### `401 Unauthorized` (Missing Token)

Returned when no `Authorization` header is provided:

```json
{
  "error": "Missing or invalid authorization header",
  "code": "AUTH_TOKEN_MISSING"
}
```

##### `403 Forbidden` (Invalid Token)

Returned when the provided Bearer token does not match `PHARMACY_ADMIN_TOKEN`:

```json
{
  "error": "Invalid admin token",
  "code": "AUTH_ADMIN_REQUIRED"
}
```

##### `404 Not Found` (Unknown Pharmacy/Drug)

Returned when attempting to upsert pricing for a pharmacy or drug that does not exist in the database:

```json
{
  "error": "Pharmacy not found: invalid-pharmacy-id",
  "code": "NOT_FOUND_PHARMACY"
}
```

---

## Effect on Future `/pharmacy/compare` Results

CareGuard's `GET /pharmacy/compare` endpoint queries the underlying SQLite pricing store in real time. 

When a price is upserted via `POST /pharmacy/prices`:
1. **Immediate Propagation**: The price change is written atomically to the database.
2. **Updated Rankings**: Subsequent calls to `GET /pharmacy/compare` for that medication immediately include the updated price.
3. **Sorted Comparison**: Price comparison results are re-sorted from lowest to highest cost. If an upsert lowers a pharmacy's price for a drug, that pharmacy will immediately move higher in consumer search results.
