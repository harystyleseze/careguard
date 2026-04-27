import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { BillAuditResult, DrugInteractionResult, PharmacyCompareResult, SpendingData, Transaction } from "../lib/types";
import { DEFAULT_PDF_THEME, type PdfTheme } from "../lib/pdf-theme";

type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY: number } };

function formatTxHashDisplay(hash?: string): { display: string; decodeFailed: boolean } {
  if (!hash) return { display: "-", decodeFailed: false };

  if (hash.length === 64 && /^[0-9a-f]{64}$/i.test(hash)) {
    return { display: `${hash.slice(0, 16)}...`, decodeFailed: false };
  }

  if (hash.length > 64) {
    try {
      const decoded = JSON.parse(atob(hash)) as Record<string, unknown>;
      const extracted = (decoded.transaction || decoded.reference || decoded.hash) as unknown;
      if (typeof extracted === "string") {
        const trimmed = extracted.length > 16 ? `${extracted.slice(0, 16)}...` : extracted;
        return { display: trimmed, decodeFailed: false };
      }
      return { display: `${hash.slice(0, 16)}... ?`, decodeFailed: true };
    } catch {
      return { display: `${hash.slice(0, 16)}... ?`, decodeFailed: true };
    }
  }

  return { display: `${hash.slice(0, 16)}... ?`, decodeFailed: true };
}

function addHeader(doc: jsPDF, title: string, subtitle: string, theme: PdfTheme) {
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
    doc.text("CareGuard | Stellar Testnet | All transactions verifiable on stellar.expert", 14, 287);
    doc.text(`Page ${i} of ${pageCount}`, 186, 287, { align: "right" });
  }
}

export function downloadBillAuditPDF(
  auditResult: BillAuditResult,
  options?: { errorsOnly?: boolean; theme?: PdfTheme }
) {
  const theme = options?.theme ?? DEFAULT_PDF_THEME;
  const errorsOnly = Boolean(options?.errorsOnly);

  const allItems = auditResult.lineItems;
  const filteredItems = errorsOnly ? allItems.filter((item) => item.status !== "valid") : allItems;
  const subtitle = errorsOnly
    ? `Patient: Rosa Garcia | Facility: General Hospital | ${filteredItems.length} of ${allItems.length} items shown — errors only`
    : "Patient: Rosa Garcia | Facility: General Hospital";

  const doc: AutoTableDoc = new jsPDF();
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
    y + 4
  );

  // Line items table
  autoTable(doc, {
    startY: y + 10,
    head: [["Description", "CPT Code", "Qty", "Charged", "Status", "Suggested"]],
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
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 4) {
        const val = String(data.cell.raw || "");
        if (val === "DUPLICATE") data.cell.styles.textColor = [239, 68, 68];
        else if (val === "UPCODED" || val === "OVERCHARGED") data.cell.styles.textColor = [245, 158, 11];
      }
    },
  });

  // Recommendation
  const finalY = doc.lastAutoTable?.finalY || 200;
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(auditResult.recommendation || "", 14, finalY + 8, { maxWidth: 180 });

  addFooter(doc);
  doc.save("careguard-bill-audit-report.pdf");
}

export function downloadMedicationPDF(
  params: { priceResults: PharmacyCompareResult[]; interactionResult?: DrugInteractionResult },
  options?: { theme?: PdfTheme }
) {
  const theme = options?.theme ?? DEFAULT_PDF_THEME;
  const doc: AutoTableDoc = new jsPDF();
  addHeader(doc, "Medication Price Comparison Report", "Patient: Rosa Garcia | 4 Medications Compared", theme);

  let y = 58;
  const priceResults = params.priceResults.filter(r => r.cheapest);
  const interactionResult = params.interactionResult;

  // Total savings summary
  const totalSavings = priceResults.reduce((sum, r) => sum + (r.potentialSavings || 0), 0);
  doc.setFontSize(11);
  doc.setTextColor(...theme.accentColor);
  doc.text(`Total Potential Savings: $${totalSavings.toFixed(2)}/month ($${(totalSavings * 12).toFixed(2)}/year)`, 14, y);
  y += 8;

  // Price comparison for each drug
  for (const r of priceResults) {
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`${r.drug}`, 14, y);
    doc.setFontSize(8);
    doc.setTextColor(...theme.accentColor);
    doc.text(`Save $${r.potentialSavings || 0}/mo (${r.savingsPercent || 0}%)`, 60, y);
    y += 2;

    autoTable(doc, {
      startY: y,
      head: [["Pharmacy", "Price", "Distance", "In Stock"]],
      body: r.prices.map((p) => [p.pharmacyName, `$${p.price}`, p.distance || "-", p.inStock ? "Yes" : "No"]),
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
    if (y > 260) { doc.addPage(); y = 20; }
  }

  // Drug interactions
  if (interactionResult?.interactions?.length > 0) {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Drug Interactions", 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Drug 1", "Drug 2", "Severity", "Recommendation"]],
      body: interactionResult.interactions.map((ix) => [ix.drug1, ix.drug2, ix.severity, ix.recommendation]),
      headStyles: { fillColor: [245, 158, 11], fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      columnStyles: { 3: { cellWidth: 70 } },
    });
  }

  addFooter(doc);
  doc.save("careguard-medication-report.pdf");
}

export function downloadTransactionPDF(
  transactions: Transaction[],
  spending: SpendingData | null,
  options?: { theme?: PdfTheme }
) {
  const theme = options?.theme ?? DEFAULT_PDF_THEME;
  const doc: AutoTableDoc = new jsPDF();
  addHeader(doc, "Transaction Report", `Patient: Rosa Garcia | ${transactions.length} Transactions`, theme);

  let y = 58;

  // Spending summary
  if (spending) {
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`Medications: $${spending.spending.medications.toFixed(2)}`, 14, y);
    doc.text(`Bills: $${spending.spending.bills.toFixed(2)}`, 70, y);
    doc.text(`API Fees (x402): $${spending.spending.serviceFees.toFixed(4)}`, 120, y);
    y += 5;
    doc.setFontSize(11);
    doc.text(`Total: $${spending.spending.total.toFixed(2)}`, 14, y);
    y += 8;
  }

  // Transactions table
  autoTable(doc, {
    startY: y,
    head: [["Time", "Type", "Description", "Amount", "Status", "Stellar Tx"]],
    body: transactions.map((tx) => {
      const { display } = formatTxHashDisplay(tx.stellarTxHash);
      return [
        new Date(tx.timestamp).toLocaleString(),
        tx.type,
        tx.description.slice(0, 40),
        `$${tx.amount < 0.01 ? tx.amount.toFixed(4) : tx.amount.toFixed(2)}`,
        tx.status,
        display,
      ];
    }),
    headStyles: { fillColor: theme.headerColor, fontSize: 7 },
    bodyStyles: { fontSize: 7 },
    columnStyles: { 2: { cellWidth: 45 }, 5: { cellWidth: 25, fontStyle: "italic" } },
  });

  addFooter(doc);
  doc.save("careguard-transaction-report.pdf");
}
