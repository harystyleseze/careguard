/**
 * Medical Bill Audit API — x402-protected on Stellar
 *
 * Every audit requires a real x402 payment in USDC via the OZ Facilitator.
 * POST /bill/audit — $0.01 per audit
 *
 * Fair market rate database based on Medicare reimbursement rates (CMS 2026 fee schedule).
 */

if (!process.stdout.isTTY) {
  process.env.NO_COLOR ??= "1";
  process.env.FORCE_COLOR = "0";
}

import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { applyX402Middleware, NETWORK, OZ_FACILITATOR_URL } from "../../shared/x402-middleware.ts";

const PORT = parseInt(process.env.BILL_AUDIT_API_PORT || "3002");
const PAY_TO = process.env.BILL_PROVIDER_PUBLIC_KEY;

if (!PAY_TO) throw new Error("BILL_PROVIDER_PUBLIC_KEY required in .env");

// Fair market rate database — based on CMS Medicare Physician Fee Schedule 2026
const FAIR_MARKET_RATES: Record<string, { description: string; fairRate: number }> = {
  "99213": { description: "Office visit, established patient, moderate", fairRate: 130 },
  "99214": { description: "Office visit, established patient, high", fairRate: 195 },
  "99215": { description: "Office visit, established patient, complex", fairRate: 265 },
  "70553": { description: "MRI brain with and without contrast", fairRate: 450 },
  "71046": { description: "Chest X-ray, 2 views", fairRate: 45 },
  "80053": { description: "Comprehensive metabolic panel", fairRate: 25 },
  "85025": { description: "Complete blood count (CBC)", fairRate: 15 },
  "36415": { description: "Venipuncture (blood draw)", fairRate: 10 },
  "93000": { description: "Electrocardiogram (ECG)", fairRate: 35 },
  "99232": { description: "Hospital care, moderate complexity", fairRate: 145 },
  "99233": { description: "Hospital care, high complexity", fairRate: 210 },
  "99238": { description: "Hospital discharge day management", fairRate: 160 },
  "96372": { description: "Injection, subcutaneous or intramuscular", fairRate: 25 },
  "J0170": { description: "Adrenaline/epinephrine injection", fairRate: 15 },
  "97110": { description: "Physical therapy, therapeutic exercises", fairRate: 55 },
};

interface BillItem { description: string; cptCode: string; quantity: number; chargedAmount: number; }

// Zod schema for validating bill items
const BillItemSchema = z.object({
  description: z.string().min(1, "description is required"),
  cptCode: z.string().min(1, "cptCode is required"),
  quantity: z.number().positive("quantity must be positive"),
  chargedAmount: z.number().nonnegative("chargedAmount must be non-negative"),
});

const BillAuditRequestSchema = z.object({
  lineItems: z.array(BillItemSchema).min(1, "lineItems must contain at least one item"),
});

function auditBill(lineItems: BillItem[]) {
  const results: any[] = [];
  let totalCharged = 0, totalCorrect = 0, errorCount = 0;
  const seenCodes: Record<string, number> = {};

  for (const item of lineItems) {
    totalCharged += item.chargedAmount;
    const fairRate = FAIR_MARKET_RATES[item.cptCode];
    const fairAmount = fairRate ? fairRate.fairRate * item.quantity : null;

    seenCodes[item.cptCode] = (seenCodes[item.cptCode] || 0) + 1;
    if (seenCodes[item.cptCode] > 1 && !["96372", "97110"].includes(item.cptCode)) {
      errorCount++;
      results.push({ description: item.description, cptCode: item.cptCode, quantity: item.quantity, chargedAmount: item.chargedAmount, fairMarketRate: fairAmount, status: "duplicate", errorDescription: `Duplicate charge for CPT ${item.cptCode}. Appears ${seenCodes[item.cptCode]} times.`, suggestedAmount: 0 });
      continue;
    }

    if (fairAmount && item.chargedAmount > fairAmount * 1.5) {
      errorCount++;
      const suggestedAmount = +(fairAmount * 1.2).toFixed(2);
      totalCorrect += suggestedAmount;
      results.push({ description: item.description, cptCode: item.cptCode, quantity: item.quantity, chargedAmount: item.chargedAmount, fairMarketRate: fairAmount, status: item.chargedAmount > fairAmount * 3 ? "upcoded" : "overcharged", errorDescription: `Charged $${item.chargedAmount} — CMS fair market rate is $${fairAmount}. Overcharged by $${(item.chargedAmount - fairAmount).toFixed(2)}.`, suggestedAmount });
      continue;
    }

    const suggested = fairAmount ? Math.min(item.chargedAmount, +(fairAmount * 1.2).toFixed(2)) : item.chargedAmount;
    totalCorrect += suggested;
    results.push({ description: item.description, cptCode: item.cptCode, quantity: item.quantity, chargedAmount: item.chargedAmount, fairMarketRate: fairAmount, status: "valid", errorDescription: null, suggestedAmount: suggested });
  }

  const totalOvercharge = +(totalCharged - totalCorrect).toFixed(2);
  const savingsPercent = totalCharged > 0 ? +((totalOvercharge / totalCharged) * 100).toFixed(1) : 0;

  return {
    auditTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network: NETWORK, price: "$0.01", payTo: PAY_TO },
    totalCharged: +totalCharged.toFixed(2), totalCorrect: +totalCorrect.toFixed(2),
    totalOvercharge, savingsPercent, errorCount, lineItems: results,
    recommendation: errorCount === 0 ? "No errors detected. This bill appears correct." : `Found ${errorCount} errors totaling $${totalOvercharge} in overcharges (${savingsPercent}% of total bill). Strongly recommend filing a formal dispute.`,
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    service: "CareGuard Medical Bill Audit API", version: "1.0.0",
    protocol: "x402 on Stellar", network: NETWORK, payTo: PAY_TO, price: "$0.01 per audit",
  });
});

app.get("/bill/sample", (_req, res) => {
  res.json({
    patientName: "Rosa Garcia", facilityName: "General Hospital", dateOfService: "2026-03-15",
    lineItems: [
      { description: "Hospital care, high complexity", cptCode: "99233", quantity: 3, chargedAmount: 630 },
      { description: "Comprehensive metabolic panel", cptCode: "80053", quantity: 1, chargedAmount: 95 },
      { description: "Complete blood count (CBC)", cptCode: "85025", quantity: 1, chargedAmount: 45 },
      { description: "Complete blood count (CBC)", cptCode: "85025", quantity: 1, chargedAmount: 45 },
      { description: "Venipuncture (blood draw)", cptCode: "36415", quantity: 1, chargedAmount: 10 },
      { description: "Chest X-ray, 2 views", cptCode: "71046", quantity: 1, chargedAmount: 180 },
      { description: "Electrocardiogram (ECG)", cptCode: "93000", quantity: 1, chargedAmount: 35 },
      { description: "Office visit, complex", cptCode: "99215", quantity: 1, chargedAmount: 1250 },
      { description: "Hospital discharge day", cptCode: "99238", quantity: 1, chargedAmount: 160 },
      { description: "Injection, subcutaneous", cptCode: "96372", quantity: 2, chargedAmount: 50 },
    ],
  });
});

// x402 payment middleware
applyX402Middleware(app, {
  "POST /bill/audit": {
    accepts: { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.01" },
    description: "Medical bill audit — $0.01 USDC",
  },
});

app.post("/bill/audit", (req, res) => {
  try {
    const validatedData = BillAuditRequestSchema.parse(req.body);
    res.json(auditBill(validatedData.lineItems));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue, idx) => {
        const path = issue.path.join(".");
        return `Item ${path}: ${issue.message}`;
      });
      res.status(400).json({
        error: "Invalid lineItems",
        details: issues,
      });
    } else {
      res.status(400).json({ error: "Invalid request body" });
    }
  }
});

export { app, auditBill };

export const server = app.listen(PORT, () => {
  console.log(`\n🏥 Bill Audit API running on http://localhost:${PORT}`);
  console.log(`   x402 payment: REQUIRED (${NETWORK})`);
  console.log(`   Facilitator: ${OZ_FACILITATOR_URL}`);
  console.log(`   Pay-to: ${PAY_TO}\n`);
});
server.unref();
