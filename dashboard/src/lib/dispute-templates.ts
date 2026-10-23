/**
 * CareGuard Dispute Reason Templates & Statutory References (#1224)
 * Client-side module for dashboard preview and PDF generation.
 */

export type DisputeReasonTemplate =
  | 'duplicate_charge'
  | 'coding_error'
  | 'balance_billing'
  | 'unbundling'
  | 'general_dispute';

export interface DisputeTemplateConfig {
  id: DisputeReasonTemplate;
  title: string;
  legalBasis: string[];
  summaryClause: string;
  demandedRemedy: string;
}

export const DISPUTE_TEMPLATES: Record<DisputeReasonTemplate, DisputeTemplateConfig> = {
  duplicate_charge: {
    id: 'duplicate_charge',
    title: 'Dispute of Unlawful Duplicate Billing & Erroneous Line Items',
    legalBasis: [
      'CMS Medicare Claims Processing Manual Chapter 1, Section 80.3.2 (Duplicate Claims)',
      'False Claims Act (31 U.S.C. § 3729 - Presentation of False or Duplicate Claims)',
      'State Uniform Healthcare Billing Guidelines regarding Exact Duplicate Submissions',
    ],
    summaryClause:
      'A formal audit revealed multiple identical charges submitted for the exact same clinical service rendered during the same session without anatomical modifiers.',
    demandedRemedy:
      'We demand the immediate removal of all identified duplicate billing entries and the issuance of a corrected itemized statement reflecting single-instance billing.',
  },
  coding_error: {
    id: 'coding_error',
    title: 'Dispute of CPT/HCPCS Coding Discrepancies & Upcoding',
    legalBasis: [
      'AMA CPT Code Book & Reporting Guidelines for Evaluation and Management (E/M)',
      'CMS National Correct Coding Initiative (NCCI) Policy Manual, Chapter 1',
      '42 U.S.C. § 1320a-7a (Civil Monetary Penalties for Inappropriate Upcoding)',
    ],
    summaryClause:
      'The itemized services were coded at a higher level of complexity than supported by the clinical medical records, or assigned inappropriate CPT codes resulting in an inflated charge.',
    demandedRemedy:
      'We demand that the disputed procedure codes be downcoded to reflect documented services and adjusted to the corresponding regional fair-market rates.',
  },
  balance_billing: {
    id: 'balance_billing',
    title: 'Dispute of Unlawful Surprise Balance Billing',
    legalBasis: [
      'No Surprises Act (Consolidated Appropriations Act of 2021, Public Law 116-260, Title I)',
      '45 CFR § 149.410 (Balance Billing Protections for Emergency Services)',
      '45 CFR § 149.420 (Balance Billing Protections for Non-Emergency Services at In-Network Facilities)',
    ],
    summaryClause:
      'Under the federal No Surprises Act, patients are protected from surprise balance billing for emergency services and non-emergency services provided by out-of-network clinicians at in-network healthcare facilities.',
    demandedRemedy:
      'We demand that all out-of-network balance billing charges above the statutory in-network rate be rescinded immediately in accordance with 45 CFR § 149.',
  },
  unbundling: {
    id: 'unbundling',
    title: 'Dispute of Unbundled Laboratory & Service Charges',
    legalBasis: [
      'CMS National Correct Coding Initiative (NCCI) Procedure-to-Procedure (PTP) Edits',
      'Medicare Claims Processing Manual Chapter 16 (Laboratory Services)',
      '42 U.S.C. § 1395y (Payment Provisions for Statutory Laboratory Panels)',
    ],
    summaryClause:
      'Our audit revealed that component services and laboratory tests were billed separately ("unbundled") when they are statutorily required to be billed under a single comprehensive panel code.',
    demandedRemedy:
      'We demand that these unbundled charges be consolidated into their corresponding comprehensive panel codes and adjusted to the bundled fair-market fee.',
  },
  general_dispute: {
    id: 'general_dispute',
    title: 'Formal Notice of Medical Bill Discrepancy & Overcharges',
    legalBasis: [
      'CMS Hospital Price Transparency Guidelines (45 CFR Part 180)',
      'Fair-Market Medical Pricing Standards based on Regional CMS Fee Schedules',
      'Fair Debt Collection Practices Act (15 U.S.C. § 1692g - Notice of Disputed Debt)',
    ],
    summaryClause:
      'An independent line-item audit of this medical bill revealed material discrepancies and overcharges when compared with regional CMS fair market benchmarks.',
    demandedRemedy:
      'We request a prompt review of the itemized discrepancies and an adjustment of the total charges to reflect fair-market rates.',
  },
};

export function inferDisputeTemplate(
  lineItems: Array<{ status?: string; errorDescription?: string | null; description?: string }>,
): DisputeReasonTemplate {
  if (
    lineItems.some(
      (i) =>
        i.status === 'duplicate' ||
        i.errorDescription?.toLowerCase().includes('duplicate'),
    )
  ) {
    return 'duplicate_charge';
  }
  if (
    lineItems.some(
      (i) =>
        i.status === 'upcoded' ||
        i.errorDescription?.toLowerCase().includes('upcoded') ||
        i.errorDescription?.toLowerCase().includes('cpt'),
    )
  ) {
    return 'coding_error';
  }
  if (
    lineItems.some(
      (i) =>
        i.errorDescription?.toLowerCase().includes('balance') ||
        i.errorDescription?.toLowerCase().includes('out-of-network') ||
        i.errorDescription?.toLowerCase().includes('surprise'),
    )
  ) {
    return 'balance_billing';
  }
  if (
    lineItems.some(
      (i) =>
        i.errorDescription?.toLowerCase().includes('unbundle') ||
        i.errorDescription?.toLowerCase().includes('panel'),
    )
  ) {
    return 'unbundling';
  }
  return 'general_dispute';
}

export function formatDisputeLetter(params: {
  billId: string;
  templateKey: DisputeReasonTemplate;
  recipientInfo: {
    name: string;
    facility: string;
    caregiverName: string;
    caregiverEmail: string;
  };
  disputedItems: Array<{
    description: string;
    cptCode?: string;
    chargedAmount: number;
    suggestedAmount?: number;
    errorDescription?: string | null;
    annotation?: string | null;
  }>;
  totalOvercharge: number;
}): string {
  const { billId, templateKey, recipientInfo, disputedItems, totalOvercharge } = params;
  const template = DISPUTE_TEMPLATES[templateKey] || DISPUTE_TEMPLATES.general_dispute;

  const lines: string[] = [
    `FORMAL NOTICE OF BILLING DISPUTE`,
    `Subject: ${template.title} — Bill #${billId}`,
    `Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    ``,
    `To: ${recipientInfo.facility || 'Healthcare Facility'} Billing Department`,
    `Patient Name: ${recipientInfo.name}`,
    `Account / Bill Reference: #${billId}`,
    ``,
    `Dear Billing Supervisor,`,
    ``,
    `I am writing on behalf of ${recipientInfo.name} to formally dispute the charges itemized on Bill #${billId}.`,
    ``,
    `DISPUTE REASON & LEGAL BASIS:`,
    template.summaryClause,
    ``,
    `Applicable Statutes & Federal Regulations:`,
    ...template.legalBasis.map((basis) => `  • ${basis}`),
    ``,
    `ITEMIZED DISCREPANCIES IDENTIFIED:`,
  ];

  for (const item of disputedItems) {
    lines.push(
      `  - ${item.description}${item.cptCode ? ` (CPT: ${item.cptCode})` : ''}: Billed $${item.chargedAmount.toFixed(2)}`,
    );
    if (item.suggestedAmount !== undefined) {
      lines.push(`    Fair Market / Allowable Rate: $${item.suggestedAmount.toFixed(2)}`);
    }
    if (item.errorDescription) {
      lines.push(`    Audit Finding: ${item.errorDescription}`);
    }
    if (item.annotation) {
      lines.push(`    Caregiver Note: ${item.annotation}`);
    }
    lines.push('');
  }

  lines.push(
    `Total Disputed Overcharge Amount: $${totalOvercharge.toFixed(2)}`,
    ``,
    `DEMANDED ACTION:`,
    template.demandedRemedy,
    ``,
    `Please place this account on administrative hold pending resolution of this dispute. Provide a written response within 30 days.`,
    ``,
    `Sincerely,`,
    recipientInfo.caregiverName || 'Caregiver',
    recipientInfo.caregiverEmail || 'Caregiver Contact',
  );

  return lines.join('\n');
}

export function formatDisputeHtml(params: {
  billId: string;
  templateKey: DisputeReasonTemplate;
  recipientInfo: {
    name: string;
    facility: string;
    caregiverName: string;
    caregiverEmail: string;
  };
  disputedItems: Array<{
    description: string;
    cptCode?: string;
    chargedAmount: number;
    suggestedAmount?: number;
    errorDescription?: string | null;
    annotation?: string | null;
  }>;
  totalOvercharge: number;
}): string {
  const { billId, templateKey, recipientInfo, disputedItems, totalOvercharge } = params;
  const template = DISPUTE_TEMPLATES[templateKey] || DISPUTE_TEMPLATES.general_dispute;

  const itemsHtml = disputedItems
    .map(
      (item) => `
      <li style="margin-bottom: 8px;">
        <strong>${item.description}</strong>${item.cptCode ? ` (CPT: ${item.cptCode})` : ''}: Billed $${item.chargedAmount.toFixed(2)}
        ${item.suggestedAmount !== undefined ? `<br/><span style="color: #047857;">Fair Rate: $${item.suggestedAmount.toFixed(2)}</span>` : ''}
        ${item.errorDescription ? `<br/><em style="color: #b91c1c;">Finding: ${item.errorDescription}</em>` : ''}
        ${item.annotation ? `<br/><span style="color: #0369a1;">Caregiver Note: ${item.annotation}</span>` : ''}
      </li>`,
    )
    .join('');

  const legalHtml = template.legalBasis.map((b) => `<li>${b}</li>`).join('');

  return `
    <div style="font-family: sans-serif; color: #0f172a; line-height: 1.5;">
      <h2 style="color: #1e3a8a;">${template.title}</h2>
      <p><strong>Bill Reference:</strong> #${billId}<br/><strong>Patient:</strong> ${recipientInfo.name}<br/><strong>Facility:</strong> ${recipientInfo.facility || 'Healthcare Facility'}</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0;"/>
      <p><strong>Dispute Basis:</strong> ${template.summaryClause}</p>
      <p><strong>Applicable Regulations:</strong></p>
      <ul>${legalHtml}</ul>
      <h3>Itemized Discrepancies:</h3>
      <ul>${itemsHtml}</ul>
      <p><strong>Total Overcharge: $${totalOvercharge.toFixed(2)}</strong></p>
      <div style="background-color: #f8fafc; border-left: 4px solid #0284c7; padding: 12px; margin: 16px 0;">
        <strong>Demanded Remedy:</strong> ${template.demandedRemedy}
      </div>
      <p>Sincerely,<br/><strong>${recipientInfo.caregiverName || 'Caregiver'}</strong><br/>${recipientInfo.caregiverEmail || ''}</p>
    </div>
  `.trim();
}
