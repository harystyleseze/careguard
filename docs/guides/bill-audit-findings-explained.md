# Bill Audit Findings Explained

This guide explains the finding labels shown for line items in the **Bills** tab. CareGuard compares supported billing codes with reference Medicare rates and flags patterns to review. A finding is a reason to ask questions, not proof that a provider made an error: rates, coverage, coding rules, and medical circumstances can differ.

## Duplicate

**What it means:** The same billing code appears more than once on the bill. CareGuard flags the later occurrence; it does not determine from the code alone whether the service was actually repeated or whether the repeat was appropriate. Some repeatable therapy codes are exempt from this check.

**Example:** A bill lists a complete blood count (CBC), code `85025`, twice for the same visit. The second CBC line is marked **duplicate**.

**What to do:** Check the dates, quantities, and itemized bill. If the service was not performed twice, ask the provider's billing office to explain or remove the second charge. If it was repeated, ask them to confirm why. See [How to Dispute a Medical Bill](bill-disputes.md) for next steps.

## Overcharged

**What it means:** For a code with a reference rate, the billed amount is more than 1.5 times that rate. This comparison is a screening estimate, not a personalized insurance allowance or a guarantee of what the provider must accept.

**Example:** CareGuard's reference rate for one moderate established-patient office visit (`99213`) is $130. A $200 charge is above the $195 screening threshold (1.5 × $130), so it is marked **overcharged**.

**What to do:** Compare the line with the provider's itemized bill and your insurer's explanation of benefits. Ask the billing office and insurer to explain the amount and whether it matches the service and your plan. If it still appears incorrect, use the audit report to support a dispute. The suggested amount in the dashboard is an estimate, not a final negotiated or covered amount.

## Upcoded

**What it means:** The charge is more than three times the reference rate. This is a more severe overcharge flag and can indicate that a higher-level billing code was used than the documentation supports. CareGuard cannot determine which service was medically provided or prove that a code is wrong.

**Example:** The reference rate for code `99213` is $130. A $400 charge is above the $390 screening threshold (3 × $130), so CareGuard labels it **upcoded**.

**What to do:** Ask the provider for an itemized bill and an explanation of the code and service level. Check the insurer's explanation of benefits, and ask the provider or insurer to review the coding. If the explanation does not resolve the concern, see [How to Dispute a Medical Bill](bill-disputes.md).

## Before disputing

The comparison uses a limited set of reference rates and does not account for every insurer contract, location, or patient circumstance. Confirm the code, quantity, service date, and amount with the provider and insurer before treating a suggested amount as correct. For a step-by-step process, see [How to Dispute a Medical Bill](bill-disputes.md).