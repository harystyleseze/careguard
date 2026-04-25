/**
 * Drug Interaction Check API — x402-protected on Stellar
 *
 * Every check requires a real x402 payment in USDC via the OZ Facilitator.
 * GET /drug/interactions?meds=Lisinopril,Metformin — $0.001 per check
 *
 * Clinical interaction reference database based on FDA drug interaction data.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { applyX402Middleware, NETWORK, OZ_FACILITATOR_URL } from "../../shared/x402-middleware.ts";

const PORT = parseInt(process.env.DRUG_INTERACTION_API_PORT || "3003");
const PAY_TO = process.env.PHARMACY_2_PUBLIC_KEY;

if (!PAY_TO) throw new Error("PHARMACY_2_PUBLIC_KEY required in .env");

interface Interaction { drugs: [string, string]; severity: "mild" | "moderate" | "severe"; description: string; recommendation: string; }

const INTERACTIONS: Interaction[] = [
  { drugs: ["lisinopril", "potassium"], severity: "severe", description: "Lisinopril can increase potassium levels. Taking potassium supplements with ACE inhibitors may cause dangerously high potassium (hyperkalemia).", recommendation: "Monitor potassium levels regularly. Avoid potassium supplements unless directed by physician." },
  { drugs: ["metformin", "alcohol"], severity: "severe", description: "Alcohol with metformin increases risk of lactic acidosis, a rare but life-threatening condition.", recommendation: "Limit alcohol consumption. Seek immediate medical attention if experiencing unusual muscle pain." },
  { drugs: ["atorvastatin", "grapefruit"], severity: "moderate", description: "Grapefruit can increase atorvastatin blood levels, raising the risk of muscle damage (rhabdomyolysis).", recommendation: "Avoid grapefruit and grapefruit juice while taking atorvastatin." },
  { drugs: ["lisinopril", "ibuprofen"], severity: "moderate", description: "NSAIDs like ibuprofen can reduce lisinopril's effectiveness and may increase kidney damage risk.", recommendation: "Use acetaminophen (Tylenol) instead of ibuprofen for pain relief." },
  { drugs: ["amlodipine", "atorvastatin"], severity: "mild", description: "Amlodipine can slightly increase atorvastatin blood levels. Generally safe at standard doses.", recommendation: "No action needed at standard doses. Monitor for muscle pain if atorvastatin dose exceeds 20mg." },
  { drugs: ["metformin", "atorvastatin"], severity: "mild", description: "Some studies suggest statins may slightly increase blood sugar levels. Very common in diabetic patients.", recommendation: "Monitor blood sugar levels as usual. Benefits of statin therapy generally outweigh this small risk." },
  { drugs: ["omeprazole", "metformin"], severity: "mild", description: "Long-term omeprazole use may reduce vitamin B12 absorption, compounding metformin's known B12 effect.", recommendation: "Consider periodic B12 level monitoring, especially after 2+ years of concurrent use." },
  { drugs: ["lisinopril", "amlodipine"], severity: "mild", description: "Common intentional combination for blood pressure management. Both lower BP through different mechanisms.", recommendation: "Monitor for excessive blood pressure lowering (dizziness, lightheadedness)." },
];

function checkInteractions(medications: string[]) {
  const meds = medications.map(m => m.toLowerCase().trim());
  const found: any[] = [];

  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      for (const ix of INTERACTIONS) {
        const [a, b] = ix.drugs;
        if ((meds[i] === a && meds[j] === b) || (meds[i] === b && meds[j] === a)) {
          found.push({ drug1: medications[i], drug2: medications[j], severity: ix.severity, description: ix.description, recommendation: ix.recommendation });
        }
      }
    }
  }

  const severe = found.filter(f => f.severity === "severe").length;
  const moderate = found.filter(f => f.severity === "moderate").length;

  return {
    checkTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network: NETWORK, price: "$0.001", payTo: PAY_TO },
    medications, interactionCount: found.length, severeCount: severe, moderateCount: moderate,
    mildCount: found.length - severe - moderate,
    interactions: found.sort((a, b) => ({ severe: 0, moderate: 1, mild: 2 }[a.severity as string] ?? 3) - ({ severe: 0, moderate: 1, mild: 2 }[b.severity as string] ?? 3)),
    overallRisk: severe > 0 ? "high" : moderate > 0 ? "moderate" : found.length > 0 ? "low" : "none",
    summary: found.length === 0 ? "No known interactions found." : `Found ${found.length} interaction(s): ${severe} severe, ${moderate} moderate, ${found.length - severe - moderate} mild.`,
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ service: "CareGuard Drug Interaction Check API", version: "1.0.0", protocol: "x402 on Stellar", network: NETWORK, payTo: PAY_TO, price: "$0.001 per check" });
});

// x402 payment middleware
applyX402Middleware(app, {
  "GET /drug/interactions": {
    accepts: { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.001" },
    description: "Drug interaction check — $0.001 USDC",
  },
});

app.get("/drug/interactions", (req, res) => {
  const medsParam = req.query.meds as string;
  if (!medsParam) { res.status(400).json({ error: "Missing: meds (comma-separated)" }); return; }
  const medications = medsParam.split(",").map(m => m.trim()).filter(Boolean);
  if (medications.length < 2) { res.status(400).json({ error: "Need at least 2 medications" }); return; }
  res.json(checkInteractions(medications));
});

export { app, checkInteractions };

export const server = app.listen(PORT, () => {
  console.log(`\n💊 Drug Interaction API running on http://localhost:${PORT}`);
  console.log(`   x402 payment: REQUIRED (${NETWORK})`);
  console.log(`   Facilitator: ${OZ_FACILITATOR_URL}`);
  console.log(`   Pay-to: ${PAY_TO}\n`);
});
server.unref();
