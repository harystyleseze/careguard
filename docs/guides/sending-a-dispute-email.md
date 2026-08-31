# Sending a generated dispute email

When CareGuard audits a medical bill and finds errors, the **Bills** tab can generate a
ready-to-send dispute letter for you. This guide explains exactly what that feature does,
what it does *not* do, and how you actually get the letter to the provider.

For the full bill submission and audit walkthrough, see
[How to Submit and Audit a Medical Bill](submitting-a-bill.md).

---

## Where the feature lives

After a bill audit finishes on the **Bills** tab, a **Download PDF** button is always shown.
If the audit **found at least one error**, two more buttons appear next to the results:

| Button | Shown when | What it does |
|---|---|---|
| **Download PDF** | Always | Saves the full audit report as a PDF for your records. |
| **Dispute** | Errors found | Downloads a formal dispute *letter* as a PDF. |
| **Email Text** | Errors found | Opens the dispute letter as a formatted web page in a new browser tab, ready to copy into an email. |

This guide is about the **Email Text** button.

---

## What happens when you click "Email Text"

1. CareGuard builds a dispute letter from the audit result. It includes:
   - the care recipient's name and the facility name
   - every line item the audit flagged as an error (description, CPT code, amount charged,
     the fair-market rate, and what was wrong)
   - the total overcharge amount
   - a short request that the charges be reviewed and corrected
2. Your browser opens that letter as a formatted HTML page in a **new tab**.
3. Nothing is sent. The letter exists only in your browser tab until you do something with it.

---

## What is automated

- **Finding the errors.** The audit compares each charge against CMS Medicare fair-market
  rates and flags overcharges, duplicates, and upcoding.
- **Drafting the letter.** CareGuard writes the dispute text for you, formatted and
  addressed to the facility's billing department, listing each disputed line item with the
  fair rate beside it.
- **Formatting it for email.** The new tab contains clean HTML you can select and paste
  into any email client.

## What is NOT automated

- **CareGuard does not send the email.** There is no outbox, no mail server, no send
  button. The agent never contacts the provider.
- **CareGuard does not know the provider's email address.** You supply it.
- **The signature is a placeholder.** The generated letter is signed with a sample name.
  Replace it with your own name before sending.
- **No attachments are added.** If you want to include the PDF audit report as evidence,
  attach it yourself.
- **No follow-up, tracking, or negotiation.** CareGuard does not confirm delivery, chase a
  response, or handle any back-and-forth with the billing department.
- **This is not legal advice.** The letter is a starting template for a billing dispute.

---

## How to actually send it

You need your own email account (Gmail, Outlook, Apple Mail, your provider's patient
portal message system, etc.).

1. Click **Email Text**. A new tab opens with the formatted letter.
2. Read the whole letter. Check the care recipient's name, the facility name, and every
   disputed line item.
3. Replace the placeholder signature with your own name. Add anything the provider needs to
   match the letter to the account: the patient's date of birth, the account or invoice
   number, and the date of service.
4. Select the entire letter, copy it, and paste it into a new email.
5. Address the email to the provider's billing department. This address is usually on the
   bill itself or on the provider's website. If you can't find it, call the billing number
   on the statement and ask where to send a written dispute.
6. Attach the PDF audit report if you want to include the supporting detail — use the
   **Download PDF** button on the same Bills tab to save it first.
7. Send the email, and keep a copy for your records.

### If the provider only accepts mail or a portal

- **Portal:** paste the letter text into a secure message in the provider's patient
  portal.
- **Postal mail:** use the **Dispute** button instead to download the letter as a PDF,
  then print and mail it.

---

## After you send it

- Keep the PDF audit report and a copy of your sent email together.
- Providers are generally expected to respond to a written billing dispute, but timelines
  vary. Follow up by phone if you do not hear back.
- Do not pay the disputed amount while the dispute is open unless you choose to. Paying the
  undisputed portion of the bill is usually fine.

---

## Related reading

- [How to Submit and Audit a Medical Bill](submitting-a-bill.md) — submitting the bill and reading the audit
- [Glossary](glossary.md) — CPT codes, upcoding, fair-market rates, and other terms
- [FAQ](faq.md) — common questions
