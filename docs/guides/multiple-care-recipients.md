# Managing multiple care recipients

Some caregivers look after more than one person — two parents, a parent and an in-law, a
relative and a neighbor. This guide explains what CareGuard supports today and what it does
not.

**Short version:** CareGuard can store more than one care recipient and the dashboard can
switch between them, but only after a second recipient has been added through the API.
There is currently **no button in the dashboard to add a care recipient**, and spending
limits and activity history are **shared across all recipients**, not tracked separately
per person.

---

## What works today

### The dashboard can switch between recipients

If **more than one** care recipient exists in the database, a recipient dropdown appears in
two places:

- the top-right of the dashboard header, next to the recipient's initials
- the **Settings** tab, next to the "Care Recipient" heading

Choosing a different recipient from the dropdown makes that person the **active recipient**.
From then on:

- new agent tasks (price comparisons, bill audits, interaction checks) use that person's
  name, age, medications, doctor, and insurance
- that person's name appears on newly generated PDFs and dispute letters

If only one recipient exists (the default), no dropdown is shown — the single recipient's
name is displayed as plain text.

### The `/recipients` API

Two endpoints back the recipient list. Both require your caregiver token.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/recipients` | Returns the full list of care recipients, sorted by name. |
| `POST` | `/recipients` | Creates a new care recipient. |

`POST /recipients` accepts a JSON body:

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Non-empty string. |
| `age` | No | Number, or omitted. |
| `medications` | No | Array of medication names. Defaults to an empty list. |
| `primary_doctor` | No | String, or omitted. |
| `insurance` | No | String, or omitted. |

Example:

```bash
curl -X POST http://localhost:3004/recipients \
  -H "Authorization: Bearer $CAREGIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Arthur Reyes",
    "age": 81,
    "medications": ["Warfarin", "Furosemide"],
    "primary_doctor": "Dr. Okafor",
    "insurance": "Medicare Part D"
  }'
```

The dashboard reads this list on load. Add a recipient with `POST /recipients`, reload the
dashboard, and the switcher dropdown appears.

CareGuard ships seeded with one recipient, **Rosa Garcia**, so the switcher is hidden until
you add at least one more.

---

## What is NOT supported yet

- **No "Add care recipient" screen in the dashboard.** The only way to add a recipient is
  the `POST /recipients` API call shown above. Non-technical caregivers will need help from
  whoever set up their CareGuard instance.
- **No editing or deleting recipients through the API.** There is no `PUT` or `DELETE` on
  `/recipients`. The **Settings** tab can edit the *active* recipient's profile fields, but
  there is no way to remove a recipient once created.
- **Spending limits are shared, not per-recipient.** The daily limit, monthly limit,
  medication budget, bill budget, and approval threshold in the **Policy** tab apply to the
  agent as a whole. Switching recipients does not give each person their own budget.
- **Activity and spending totals are shared.** The **Activity** tab and the spending
  figures on the **Overview** tab cover everything the agent has done, across all
  recipients combined. They are not filtered by the active recipient.
- **Recipients are not linked to individual caregiver logins.** Every recipient is visible
  to anyone holding the caregiver token for that instance.

---

## Practical guidance

- If you manage two people and want their budgets and activity kept fully separate, run a
  **separate CareGuard instance per person** for now. One shared instance mixes their
  spending and history.
- If a shared budget and combined history are acceptable, add the second recipient with
  `POST /recipients` and use the header dropdown to switch context before starting a task.
- Always confirm the dropdown shows the **right person** before running an agent task or
  generating a document — the active recipient's name goes onto bills, audits, and dispute
  letters.

---

## Related reading

- [Getting Started with CareGuard](getting-started-caregiver.md) — first-time setup
- [Spending Policy Settings](spending-policy-for-caregivers.md) — how the shared limits work
- [Glossary](glossary.md) — caregiver token, spending policy, and other terms
