# Disputing a Medical Bill

When CareGuard audits a medical bill and finds errors, you can generate a ready-to-send dispute letter directly from the Bills tab. This guide explains what the dispute letter is, when it appears, and how to use it.

## What triggers a dispute letter

A dispute letter option only appears after a bill has been audited and the audit finds at least one error. The Bill Audit API flags each line item as one of:

- **Overcharged** — billed more than 1.5x the CMS fair-market rate
- **Upcoded** — billed more than 3x the fair-market rate (suggests the wrong billing code was used)
- **Duplicate** — the same procedure code billed more than once

If the audit result has `errorCount > 0`, the Bills tab shows **Dispute** and **Email Text** buttons next to that bill's results. If the audit finds no errors, no dispute option is shown — there is nothing to dispute.

See [Bill Audit API example](../api-examples/bill-audit.md) for what a full audit result with findings looks like, and [Bill Audit Service internals](../services/bill-audit.md) for how overcharge, upcoding, and duplicate detection work.

## What's in the letter

The generated letter is addressed to the billing department of the facility on file for your care recipient, and lists every flagged line item with:

- The description and CPT code
- The amount charged
- The CMS fair-market rate CareGuard suggests instead
- A short explanation of the specific issue (e.g. "Duplicate charge for CPT 85025. Appears 2 times.")

It closes with the total overcharge amount and a request that the facility review and correct the bill.

## Reviewing, sending, or discarding the letter

From the Bills tab, on any audited bill with errors:

1. **Dispute** — generates the letter as a PDF and downloads it to your device (`careguard-dispute-letter-<bill-id>.pdf`). Open the PDF to review the wording and figures before doing anything with it.
2. **Email Text** — generates the same letter as an HTML email body and opens it in a new browser tab, so you can copy it into your own email client.

Neither button sends anything on your behalf. CareGuard prepares the letter; you decide whether to send it, edit it first, or discard it entirely. If you close the tab or delete the PDF without acting on it, nothing is sent and no record is created elsewhere — generating a letter has no effect on your spending policy, wallet, or the underlying bill.

## Current limitations

- **Sending is manual.** CareGuard does not email, fax, or otherwise transmit the dispute letter to the facility. You are responsible for delivering it through whatever channel the facility accepts.
- **No dispute tracking.** CareGuard does not track whether a letter was sent, whether the facility responded, or the outcome of a dispute. Once downloaded, follow-up is outside the app.
- **The letter is a draft, not legal advice.** Review the figures and wording before sending — you may want to add your own account or claim numbers, or adjust the tone for your situation.
- **The billing facility name comes from your care recipient's profile.** If it's missing or wrong, the letter falls back to a generic "General Hospital" placeholder — update the recipient's facility in their profile before generating a letter to avoid this.

## Related reading

- [Bill Audit API example](../api-examples/bill-audit.md)
- [Bill Audit Service internals](../services/bill-audit.md)
- [Submitting a bill for audit](submitting-a-bill.md)
