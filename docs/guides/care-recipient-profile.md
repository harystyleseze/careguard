# Care Recipient Profile — A Guide for Caregivers

This guide explains the profile fields for a care recipient, which fields are required, and how to manage the profile after initial setup.

---

## What is a care recipient profile

A care recipient is the person you are managing healthcare for using CareGuard. The profile stores key information about them that the agent uses for medication comparisons, bill audits, and other tasks.

---

## Profile fields

| Field | Required | Description |
|---|---|---|
| **name** | Yes | The care recipient's full name. Used to identify them in the dashboard and in agent logs. |
| **age** | No | The care recipient's age. Can be used by the agent for age-related health considerations. |
| **medications** | No | A list of medications the care recipient currently takes. The agent uses this for drug interaction checks and medication price comparisons. |
| **primary doctor** | No | The name and location of the care recipient's primary care physician (e.g. "Dr. Chen, General Hospital"). |
| **insurance** | No | The care recipient's insurance provider and plan (e.g. "Medicare Part D"). |

---

## Creating a care recipient profile

Profiles are created when you first set up CareGuard. The system comes with a default profile for demonstration purposes.

To create a new care recipient profile, use the CareGuard API:

```bash
curl -X POST http://localhost:3000/recipients \
  -H "Authorization: Bearer YOUR_CAREGIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Maria Lopez",
    "age": 72,
    "medications": ["Metformin", "Lisinopril"],
    "primary_doctor": "Dr. Smith, City Clinic",
    "insurance": "Medicare Advantage"
  }'
```

Only **name** is required. All other fields are optional.

### Creating a profile with only a name

```bash
curl -X POST http://localhost:3000/recipients \
  -H "Authorization: Bearer YOUR_CAREGIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "James Wilson"
  }'
```

---

## Viewing care recipient profiles

To list all care recipient profiles:

```bash
curl http://localhost:3000/recipients \
  -H "Authorization: Bearer YOUR_CAREGIVER_TOKEN"
```

This returns an array of all profiles in the system.

---

## Editing a care recipient profile

> **Important:** There is currently **no update endpoint** for care recipient profiles. Once a profile is created, the following fields **cannot be changed** through the API:

- **name** — the care recipient's name is permanent after creation
- **age** — cannot be updated after creation
- **medications** — the medication list is fixed at creation time
- **primary doctor** — cannot be updated after creation
- **insurance** — cannot be updated after creation

If you need to change any of these fields, you would need to:

1. Create a new care recipient profile with the correct information
2. Use the new profile going forward

> **Note:** This is a known limitation. A `PUT` or `PATCH` endpoint for updating profiles may be added in a future release.

---

## How the profile is used

The agent uses care recipient profile information in several ways:

| Field | How it is used |
|---|---|
| **name** | Displayed in the dashboard and transaction logs |
| **medications** | Used for drug interaction checks and medication price comparisons |
| **primary_doctor** | May be referenced in bill audit reports |
| **insurance** | May be used for insurance-related claims processing |

---

## Tips

- **Add all current medications** when creating the profile — this ensures drug interaction checks are accurate
- **Keep the medication list up to date** — if you need to change medications, create a new profile
- **Include the insurance provider** — this helps the agent understand coverage context
- **Name format** — use the care recipient's common name so it is easy to identify in the dashboard

---

## Related reading

- [Getting Started](getting-started-caregiver.md) — full setup walkthrough
- [Spending Policy](spending-policy-for-caregivers.md) — configuring spending limits
- [Wallet Tab](wallet-tab.md) — understanding the agent's wallet
- [FAQ](faq.md) — common questions and answers
