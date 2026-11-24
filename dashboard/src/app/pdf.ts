import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import type {
  BillAuditResult,
  DrugInteractionResult,
  PharmacyCompareResult,
  SpendingData,
  Transaction,
  DisputeLetter,
  RecipientAllergy,
  CostSplit,
} from "../lib/types";
import { DEFAULT_PDF_THEME, type PdfTheme } from "../lib/pdf-theme";
import { formatVital, type RecipientProfile, type Vital } from "../lib/types";
import { TX_HASH_DISPLAY_LENGTH, truncateTransactionHash } from "../lib/tx-hash";

type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY: number } };

function formatTxHashDisplay(hash?: string): {
  display: string;
  decodeFailed: boolean;
} {
  if (!hash) return { display: "-", decodeFailed: false };

  if (hash.length === 64 && /^[0-9a-f]{64}$/i.test(hash)) {
    return { display: truncateTransactionHash(hash), decodeFailed: false };
  }

  if (hash.length > 64) {
    try {
      const decoded = JSON.parse(atob(hash)) as Record<string, unknown>;
      const extracted = (decoded.transaction ||
        decoded.reference ||
        decoded.hash) as unknown;
      if (typeof extracted === "string") {
        const trimmed =
          extracted.length > 16 ? `${extracted.slice(0, 16)}...` : extracted;
        return { display: trimmed, decodeFailed: false };
      }
      return { display: `${truncateTransactionHash(hash)} ?`, decodeFailed: true };
    } catch {
      return { display: `${truncateTransactionHash(hash)} ?`, decodeFailed: true };
    }
  }

  return { display: `${truncateTransactionHash(hash)} ?`, decodeFailed: true };
}

function formatRecipient(recipient: RecipientProfile): string {
  const age = typeof recipient.age === "number" ? `, ${recipient.age}` : "";
  return `${recipient.name}${age}`;
}

function addHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  theme: PdfTheme,
) {
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("CareGuard", 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(...theme.mutedColor);
  doc.text("AI Healthcare Agent on Stellar", 14, 26);

  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, 38);
  doc.setFontSize(9);
  doc.setTextColor(...theme.mutedColor);
  doc.text(subtitle, 14, 44);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 49);

  doc.setDrawColor(226, 232, 240); // slate-200
  doc.line(14, 52, 196, 52);
}

function addFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(
      "CareGuard | Stellar Testnet | All transactions verifiable on stellar.expert",
      14,
      287,
    );
    doc.text(`Page ${i} of ${pageCount}`, 186, 287, { align: "right" });
  }
}

export function downloadBillAuditPDF(
  auditResult: BillAuditResult,
  options?: {
    errorsOnly?: boolean;
    theme?: PdfTheme;
    recipient?: RecipientProfile;
  },
) {
  const theme = options?.theme ?? DEFAULT_PDF_THEME;
  const errorsOnly = Boolean(options?.errorsOnly);
  const recipient = options?.recipient ?? {
    name: "Rosa Garcia",
    age: 78,
    facility: "General Hospital",
  };
  const recipientLabel = formatRecipient(recipient);

  const allItems = auditResult.lineItems;
  const filteredItems = errorsOnly
    ? allItems.filter((item) => item.status !== "valid")
    : allItems;
  const subtitle = errorsOnly
    ? `Patient: ${recipientLabel} | Facility: ${recipient.facility || "N/A"} | ${filteredItems.length} of ${allItems.length} items shown — errors only`
    : `Patient: ${recipientLabel} | Facility: ${recipient.facility || "N/A"}`;

  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let doc: AutoTableDoc;
  try {
    doc = new jsPDF();
  } catch (err) {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
    return;
  }
  doc.setProperties({
    title: "CareGuard Medical Bill Audit Report",
    subject: `Bill audit for ${recipient.name}`,
    author: "CareGuard",
    keywords: `${recipient.name},bill,audit,stellar`,
    creator: `CareGuard ${new Date().toISOString()}`,
  });
  addHeader(doc, "Medical Bill Audit Report", subtitle, theme);

  // Summary boxes
  let y = 58;
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Total Charged: $${auditResult.totalCharged}`, 14, y);
  doc.setTextColor(239, 68, 68); // red-500
  doc.text(`Overcharges Found: $${auditResult.totalOvercharge}`, 80, y);
  doc.setTextColor(34, 197, 94); // green-500
  doc.text(`Corrected Amount: $${auditResult.totalCorrect}`, 146, y);
  y += 4;
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9);
  doc.text(
    `${auditResult.errorCount} errors found${typeof auditResult.savingsPercent === "number" ? ` (${auditResult.savingsPercent}% of total bill)` : ""}`,
    14,
    y + 4,
  );

  // Line items table — paginated (#225)
  // didDrawPage redraws the column header on every continuation page so
  // readers always know which column they are looking at, regardless of
  // how many line items the bill contains.
  autoTable(doc, {
    startY: y + 10,
    head: [
      ["Description", "CPT Code", "Qty", "Charged", "Status", "Suggested"],
    ],
    body: filteredItems.map((item) => [
      item.description,
      item.cptCode || "-",
      item.quantity,
      `$${item.chargedAmount}`,
      item.status === "valid" ? "OK" : item.status.toUpperCase(),
      item.status !== "valid" ? `$${item.suggestedAmount}` : "-",
    ]),
    headStyles: { fillColor: theme.headerColor, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    // Wrap long descriptions so they don't overflow the cell on the right.
    columnStyles: { 0: { cellWidth: "wrap" } },
    // Repeat the column header row at the top of every continuation page.
    showHead: "everyPage",
    didDrawPage: (data) => {
      // Re-draw the CareGuard page header on every page beyond the first.
      if (data.pageNumber > 1) {
        addHeader(doc, "Medical Bill Audit Report (cont.)", subtitle, theme);
      }
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 4) {
        const val = String(data.cell.raw || "");
        if (val === "DUPLICATE") data.cell.styles.textColor = [239, 68, 68];
        else if (val === "UPCODED" || val === "OVERCHARGED")
          data.cell.styles.textColor = [245, 158, 11];
      }
    },
  });

  // Recommendation — split so jsPDF can measure line count for page-break logic.
  // maxWidth option on doc.text() wraps visually but doesn't let us count lines,
  // so use splitTextToSize and handle overflow explicitly (Issue #227).
  const REC_MAX_WIDTH = 182;
  const REC_LINE_HEIGHT = 5; // mm at fontSize 9
  const PAGE_BOTTOM = 275; // leave room above footer

  const finalY = doc.lastAutoTable?.finalY || 200;
  const recLines: string[] = doc.splitTextToSize(
    auditResult.recommendation || "",
    REC_MAX_WIDTH,
  );
  const recStartY = finalY + 8;

  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);

  if (recStartY + recLines.length * REC_LINE_HEIGHT > PAGE_BOTTOM) {
    doc.addPage();
    addHeader(doc, "Medical Bill Audit Report (cont.)", subtitle, theme);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(recLines, 14, 58);
  } else {
    doc.text(recLines, 14, recStartY);
  }

  addFooter(doc);
  try {
    doc.save("careguard-bill-audit-report.pdf");
  } catch (err) {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
  }
}

export function downloadMedicationPDF(
  params: { priceResults: PharmacyCompareResult[]; interactionResult?: DrugInteractionResult; sideEffectEntries?: Array<{ medicationId: string; description: string; severity: string; timestamp: string }> },
  options?: { theme?: PdfTheme; recipient?: RecipientProfile }
) {
  const theme = options?.theme ?? DEFAULT_PDF_THEME;
  const recipient = options?.recipient ?? {
    name: "Rosa Garcia",
    age: 78,
    facility: "General Hospital",
  };
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let doc: AutoTableDoc;
  try {
    doc = new jsPDF();
  } catch (err) {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
    return;
  }
  doc.setProperties({
    title: "CareGuard Medication Price Comparison Report",
    subject: `Medication comparison for ${recipient.name}`,
    author: "CareGuard",
    keywords: `${recipient.name},medication,prices,stellar`,
    creator: `CareGuard ${new Date().toISOString()}`,
  });
  addHeader(
    doc,
    "Medication Price Comparison Report",
    `Patient: ${formatRecipient(recipient)} | ${params.priceResults.length} Medications Compared`,
    theme,
  );

  let y = 58;
  const priceResults = params.priceResults.filter((r) => r.cheapest);
  const interactionResult = params.interactionResult;

  // Total savings summary
  const totalSavings = priceResults.reduce(
    (sum, r) => sum + (r.potentialSavings || 0),
    0,
  );
  doc.setFontSize(11);
  doc.setTextColor(...theme.accentColor);
  doc.text(
    `Total Potential Savings: $${totalSavings.toFixed(2)}/month ($${(totalSavings * 12).toFixed(2)}/year)`,
    14,
    y,
  );
  y += 8;

  // Price comparison for each drug
  for (const r of priceResults) {
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`${r.drug}`, 14, y);
    doc.setFontSize(8);
    doc.setTextColor(...theme.accentColor);
    doc.text(
      `Save $${r.potentialSavings || 0}/mo (${r.savingsPercent || 0}%)`,
      60,
      y,
    );
    y += 2;

    autoTable(doc, {
      startY: y,
      head: [["Pharmacy", "Price", "Distance", "In Stock"]],
      body: r.prices.map((p) => [
        p.pharmacyName,
        `$${p.price}`,
        p.distance || "-",
        p.inStock === true ? "Yes" : p.inStock === "unknown" ? "Unknown" : "No",
      ]),
      headStyles: { fillColor: theme.headerColor, fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === 0) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = theme.accentColor;
        }
      },
    });

    y = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 6 : y + 30;
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
  }

  // Drug interactions
  if (
    (interactionResult?.interactions?.length ?? 0) > 0 &&
    interactionResult?.interactions
  ) {
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Drug Interactions", 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Drug 1", "Drug 2", "Severity", "Recommendation"]],
      body: interactionResult.interactions.map((ix) => [
        ix.drug1,
        ix.drug2,
        ix.severity,
        ix.recommendation,
      ]),
      headStyles: { fillColor: [245, 158, 11], fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      columnStyles: { 3: { cellWidth: 70 } },
    });
    y = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 8 : y + 30;
  }

  if ((params.sideEffectEntries?.length ?? 0) > 0) {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Side Effect Journal", 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Medication", "Severity", "Observed", "Date"]],
      body: params.sideEffectEntries!.map((entry) => [
        entry.medicationId,
        entry.severity,
        entry.description.slice(0, 60),
        new Date(entry.timestamp).toLocaleDateString(),
      ]),
      headStyles: { fillColor: [14, 116, 144], fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      columnStyles: { 2: { cellWidth: 70 } },
    });
  }

  addFooter(doc);
  try {
    doc.save("careguard-medication-report.pdf");
  } catch (err) {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
  }
}

export function downloadTransactionPDF(
  transactions: Transaction[],
  spending: SpendingData | null,
  options?: {
    theme?: PdfTheme;
    recipient?: RecipientProfile;
    costSplits?: CostSplit[];
  }
) {
  const theme = options?.theme ?? DEFAULT_PDF_THEME;
  const recipient = options?.recipient ?? {
    name: "Rosa Garcia",
    age: 78,
    facility: "General Hospital",
  };
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let doc: AutoTableDoc;
  try {
    doc = new jsPDF();
  } catch (err) {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
    return;
  }
  doc.setProperties({
    title: "CareGuard Transaction Report",
    subject: `Transactions for ${recipient.name}`,
    author: "CareGuard",
    keywords: `${recipient.name},transactions,stellar`,
    creator: `CareGuard ${new Date().toISOString()}`,
  });
  addHeader(
    doc,
    "Transaction Report",
    `Patient: ${formatRecipient(recipient)} | ${transactions.length} Transactions`,
    theme,
  );

  let y = 58;

  // Spending summary
  if (spending) {
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Medications: $${spending.spending.medications.toFixed(2)}`,
      14,
      y,
    );
    doc.text(`Bills: $${spending.spending.bills.toFixed(2)}`, 70, y);
    doc.text(
      `API Fees (x402): $${spending.spending.serviceFees.toFixed(4)}`,
      120,
      y,
    );
    y += 5;
    doc.setFontSize(11);
    doc.text(`Total: $${spending.spending.total.toFixed(2)}`, 14, y);
    y += 8;
  }

  // Transactions table
  autoTable(doc, {
    startY: y,
    head: [
      ["Time", "Type", "Description", "Memo", "Amount", "Status", "Stellar Tx"],
    ],
    body: transactions.map((tx) => {
      const { display, decodeFailed } = formatTxHashDisplay(tx.stellarTxHash);
      return [
        new Date(tx.timestamp).toLocaleString(),
        tx.type,
        tx.description.slice(0, 40),
        (tx as any).memo ?? "-",
        `$${tx.amount < 0.01 ? tx.amount.toFixed(4) : tx.amount.toFixed(2)}`,
        tx.status,
        decodeFailed
          ? {
              content: display,
              styles: { fontStyle: "italic", textColor: [185, 28, 28] },
            }
          : display,
      ];
    }),
    headStyles: { fillColor: theme.headerColor, fontSize: 7 },
    bodyStyles: { fontSize: 7 },
    columnStyles: {
      2: { cellWidth: 38 },
      3: { cellWidth: 20 },
      6: { cellWidth: 25, fontStyle: "italic" },
    },
  });

  // Cost splits table (Issue #1220)
  if (options?.costSplits && options.costSplits.length > 0) {
    const finalY = (doc as any).lastAutoTable?.finalY ?? y + 50;
    let splitY = finalY + 12;
    if (splitY > 230) {
      doc.addPage();
      splitY = 30;
      addHeader(doc, "Caregiver Cost Splits", `Patient: ${formatRecipient(recipient)}`, theme);
    }
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Caregiver Cost Splits & Split Balances", 14, splitY);
    splitY += 4;

    const splitRows: any[] = [];
    for (const split of options.costSplits) {
      for (const share of split.shares) {
        splitRows.push([
          new Date(split.createdAt).toLocaleDateString(),
          split.description || "Healthcare Expense",
          `$${split.totalAmount.toFixed(2)}`,
          split.payerName,
          share.caregiverName,
          `$${share.amount.toFixed(2)}`,
          share.status === "settled" ? "Paid Back" : "Owed",
        ]);
      }
    }

    autoTable(doc, {
      startY: splitY,
      head: [["Date", "Expense", "Total", "Payer", "Contributor", "Share", "Status"]],
      body: splitRows,
      headStyles: { fillColor: theme.headerColor, fontSize: 7 },
      bodyStyles: { fontSize: 7 },
    });
  }

  addFooter(doc);
  try {
    doc.save("careguard-transaction-report.pdf");
  } catch (err) {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
  }
}

export function downloadDisputeLetterPDF(
  letter: DisputeLetter,
  options?: { theme?: PdfTheme },
) {
  const theme = options?.theme ?? DEFAULT_PDF_THEME;
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let doc: jsPDF;
  try {
    doc = new jsPDF();
  } catch (err) {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
    return;
  }
  doc.setProperties({
    title: `CareGuard Dispute Letter — ${letter.recipientName}`,
    subject: `Bill dispute for ${letter.recipientName}`,
    author: "CareGuard",
    keywords: `${letter.recipientName},dispute,bill,stellar`,
    creator: `CareGuard ${new Date().toISOString()}`,
  });

  addHeader(
    doc,
    "Medical Bill Dispute Letter",
    `Patient: ${letter.recipientName} | Facility: ${letter.facility} | Overcharge: $${letter.totalOvercharge.toFixed(2)}`,
    theme,
  );

  let y = 58;
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);

  // Letter body
  const lines = letter.emailText.split("\n");
  for (const line of lines) {
    if (y > 270) {
      doc.addPage();
      y = 30;
      addHeader(
        doc,
        "Medical Bill Dispute Letter (cont.)",
        `Patient: ${letter.recipientName}`,
        theme,
      );
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
    }
    // Indent bullet points
    const indent = line.startsWith("  -") || line.startsWith("    ") ? 20 : 14;
    doc.text(line, indent, y);
    y += 6;
  }

  addFooter(doc);
  try {
    doc.save(`careguard-dispute-letter-${letter.billId}.pdf`);
  } catch (err) {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
  }
}

export function downloadDisputeLetterEmail(letter: DisputeLetter): string {
  // Returns email-ready HTML
  return letter.emailHtml;
}

// ── Caregiver Accountability Report PDF (Feature: audit export) ───────────────

import type { AuditLogEvent } from "../lib/types";

export interface AuditExportOptions {
  from?: string;
  to?: string;
  theme?: PdfTheme;
  recipient?: RecipientProfile;
  caregiverName?: string;
}

/**
 * Generate and download a PDF of caregiver-relevant audit events.
 * Data is the filtered list returned by GET /agent/audit/caregiver-export.
 *
 * Mirrors the template used by downloadTransactionPDF:
 *   addHeader → summary row → autoTable → addFooter → doc.save()
 */
export function downloadAuditLogPDF(
  events: AuditLogEvent[],
  options?: AuditExportOptions,
): void {
  const theme = options?.theme ?? DEFAULT_PDF_THEME;
  const recipient = options?.recipient ?? {
    name: "Rosa Garcia",
    age: 78,
    facility: "General Hospital",
  };
  const caregiverName = options?.caregiverName ?? "Caregiver";
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  const fromLabel = options?.from
    ? new Date(options.from).toLocaleDateString()
    : "All time";
  const toLabel = options?.to
    ? new Date(options.to).toLocaleDateString()
    : "Now";
  const subtitle = `Patient: ${formatRecipient(recipient)} | ${events.length} events | ${fromLabel} – ${toLabel}`;

  let doc: AutoTableDoc;
  try {
    doc = new jsPDF();
  } catch {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
    return;
  }

  doc.setProperties({
    title: "CareGuard Accountability Report",
    subject: `Audit log for ${recipient.name}`,
    author: "CareGuard",
    keywords: `${recipient.name},audit,accountability,policy`,
    creator: `CareGuard ${new Date().toISOString()}`,
  });

  addHeader(doc, "Caregiver Accountability Report", subtitle, theme);

  let y = 58;

  // Summary line
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Caregiver: ${caregiverName}`, 14, y);
  y += 6;
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "Shows policy changes, approvals, pauses, and payment resets. Internal technical events are excluded.",
    14,
    y,
  );
  y += 8;

  // Events table
  autoTable(doc, {
    startY: y,
    head: [["Time", "Event", "Actor", "Details"]],
    body: events.map((ev) => {
      const details = ev.details
        ? Object.entries(ev.details)
            .filter(
              ([k]) => !["hash", "prevHash", "ip", "userAgent"].includes(k),
            )
            .map(
              ([k, v]) =>
                `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`,
            )
            .join("; ")
            .slice(0, 80)
        : "-";
      return [
        new Date(ev.timestamp).toLocaleString(),
        ev.event,
        ev.actor,
        details,
      ];
    }),
    headStyles: { fillColor: theme.headerColor, fontSize: 7 },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 45 },
      2: { cellWidth: 20 },
      3: { cellWidth: "auto" },
    },
    showHead: "everyPage",
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        addHeader(
          doc,
          "Caregiver Accountability Report (cont.)",
          subtitle,
          theme,
        );
      }
    },
  });

  addFooter(doc);
  try {
    doc.save("careguard-accountability-report.pdf");
  } catch {
    toast.error(`Couldn't generate PDF — try again (Req ID: ${requestId})`);
  }
}
