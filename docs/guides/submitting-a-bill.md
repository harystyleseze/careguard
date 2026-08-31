# How to Submit and Audit a Medical Bill

This guide provides a step-by-step walkthrough for caregivers submitting medical bills for automated auditing in the CareGuard dashboard.

---

## Overview

Medical bills frequently contain billing errors, duplicate charges, or excessive fees. CareGuard helps caregivers audit hospital and clinic bills automatically by comparing charged prices against **CMS Medicare Fair-Market Rates**.

---

## How to Submit a Bill (Bills Tab)

Caregivers can submit medical bills directly through the CareGuard dashboard under the **Bills** tab.

### Submission Methods

1. **Manual Entry**: Enter line items individually (ideal for paper bills or itemized receipts).
2. **Digital Record / Agent Upload**: Instruct the AI Agent in the chat interface to fetch or import an existing medical record or bill (e.g., *"Audit Rosa's hospital bill from General Hospital"*).

---

## Required Bill Information

When submitting a medical bill for audit, each line item requires four key fields:

| Field Name | Description | Example |
|---|---|---|
| **Description** | A brief name or explanation of the medical service provided | *"Comprehensive metabolic panel"* |
| **CPT Code** | 5-digit Current Procedural Terminology billing code (or 5-character HCPCS code starting with `J`) | `80053` |
| **Quantity** | Number of times the procedure or service was performed | `1` |
| **Charged Amount** | The total dollar amount billed by the healthcare facility for this item | `$95.00` |

---

## What Happens After Submission?

Once a bill is submitted, CareGuard automatically audits every line item in real time:

```
[ Billed Line Items ] ──> [ CMS Medicare Fair Rate Lookup ] ──> [ Overcharge & Upcoding Analysis ] ──> [ Audit Report & Dispute Options ]
```

### Automatic Audit Checks

1. **Duplicate Detection**: Identifies procedures or tests billed multiple times on the same date (excluding repeatable therapy codes like `96372`).
2. **Overcharge Identification**: Flags any line item where the charged amount exceeds **1.5×** the CMS Medicare fair-market rate.
3. **Upcoding Detection**: Identifies severe overcharges exceeding **3×** the fair-market rate, which often indicates an incorrect high-complexity billing code was assigned.
4. **Valid Item Verification**: Confirms charges that fall within standard fair-market guidelines.

---

## Understanding Your Audit Results

After processing completes, the **Bills** tab displays a comprehensive summary:

- **Total Charged**: The original total dollar amount billed by the hospital.
- **Overcharges Found**: Total dollar amount identified as excessive or invalid.
- **Corrected Fair Amount**: The adjusted total bill amount based on fair-market rates.
- **Line Item Breakdown**: A detailed list showing each item, fair-market price comparisons, and error flags.

---

## Taking Action on Billed Errors

If CareGuard finds billing errors on your submission, you can immediately take action from the **Bills** tab:

1. **Download PDF Audit Report**: Generate a downloadable PDF report detailing all audit findings to keep for your records or share with insurance.
2. **Generate Dispute Letter**: Click **Dispute** to automatically create a formal, formatted dispute letter addressed to the healthcare facility's billing department, downloaded as a PDF.
3. **Email Text Template**: Click **Email Text** to open the dispute letter as a formatted page in a new browser tab, ready to copy into an email you send yourself. CareGuard does not send the email — see [Sending a Generated Dispute Email](sending-a-dispute-email.md) for what is and is not automated and how to get the letter to the provider.

---

## Need Help?

If you have questions about specific CPT codes or need assistance submitting a complex bill, type a prompt in the CareGuard chat (e.g., *"Can you explain the charge for CPT 99215 on Rosa's bill?"*) and your AI caregiver assistant will help guide you!
