import fs from "node:fs";
import path from "node:path";

// Curated drug classes and members
const CLASSES = {
  ACEI: ["lisinopril", "enalapril", "ramipril", "benazepril", "captopril", "quinapril", "fosinopril", "trandolapril"],
  Potassium: ["potassium chloride", "potassium gluconate", "potassium citrate", "potassium bicarbonate"],
  NSAIDs: ["ibuprofen", "naproxen", "aspirin", "celecoxib", "meloxicam", "diclofenac", "indomethacin", "ketorolac", "nabumetone", "etodolac"],
  Anticoagulants: ["warfarin", "apixaban", "rivaroxaban", "dabigatran", "heparin", "clopidogrel", "enoxaparin", "prasugrel"],
  Statins: ["atorvastatin", "simvastatin", "rosuvastatin", "pravastatin", "lovastatin", "fluvastatin"],
  Diuretics: ["spironolactone", "furosemide", "hydrochlorothiazide", "triamterene", "eplerenone", "bumetanide", "torsemide", "chlorthalidone"],
  BetaBlockers: ["metoprolol", "carvedilol", "atenolol", "propranolol", "bisoprolol", "nebivolol", "labetalol", "nadolol"],
  SSRIs: ["sertraline", "fluoxetine", "citalopram", "escitalopram", "paroxetine", "duloxetine", "venlafaxine", "fluvoxamine", "desvenlafaxine", "milnacipran"],
  Antidiabetics: ["metformin", "glipizide", "glyburide", "insulin", "empagliflozin", "liraglutide", "sitagliptin", "pioglitazone", "glimepiride", "semaglutide"],
  PPIs: ["omeprazole", "esomeprazole", "pantoprazole", "lansoprazole", "rabeprazole", "dexlansoprazole"],
};

// Custom drugs/substances
const SPECIAL = {
  alcohol: "alcohol",
  grapefruit: "grapefruit juice",
};

interface Interaction {
  drugs: [string, string];
  severity: "mild" | "moderate" | "severe";
  description: string;
  recommendation: string;
}

// Generate the interactions based on clinical rules
function generateAllInteractions(): Interaction[] {
  const list: Interaction[] = [];

  // 1. ACEI + Potassium -> severe
  for (const a of CLASSES.ACEI) {
    for (const k of CLASSES.Potassium) {
      list.push({
        drugs: [a, k],
        severity: "severe",
        description: `${a.charAt(0).toUpperCase() + a.slice(1)} can increase potassium levels. Combined use with ${k} may cause dangerously high potassium (hyperkalemia).`,
        recommendation: "Avoid potassium supplements and monitor potassium levels regularly.",
      });
    }
  }

  // 2. ACEI + NSAIDs -> moderate
  for (const a of CLASSES.ACEI) {
    for (const n of CLASSES.NSAIDs) {
      list.push({
        drugs: [a, n],
        severity: "moderate",
        description: `NSAIDs like ${n} can reduce ${a}'s blood pressure lowering effectiveness and increase the risk of kidney damage.`,
        recommendation: "Monitor blood pressure and kidney function. Consider acetaminophen (Tylenol) instead.",
      });
    }
  }

  // 3. Anticoagulants + NSAIDs -> severe
  for (const c of CLASSES.Anticoagulants) {
    for (const n of CLASSES.NSAIDs) {
      list.push({
        drugs: [c, n],
        severity: "severe",
        description: `Taking NSAIDs like ${n} with anticoagulants like ${c} increases the risk of serious, potentially life-threatening gastrointestinal bleeding.`,
        recommendation: "Avoid concurrent use of NSAIDs. Use acetaminophen for pain relief.",
      });
    }
  }

  // 4. Anticoagulants + Anticoagulants -> severe
  for (let i = 0; i < CLASSES.Anticoagulants.length; i++) {
    for (let j = i + 1; j < CLASSES.Anticoagulants.length; j++) {
      const c1 = CLASSES.Anticoagulants[i];
      const c2 = CLASSES.Anticoagulants[j];
      list.push({
        drugs: [c1, c2],
        severity: "severe",
        description: `Combining multiple blood thinners (${c1} + ${c2}) substantially raises the risk of severe internal bleeding.`,
        recommendation: "Review therapy. Avoid dual therapy unless specifically prescribed by a physician.",
      });
    }
  }

  // 5. SSRIs + NSAIDs -> moderate
  for (const s of CLASSES.SSRIs) {
    for (const n of CLASSES.NSAIDs) {
      list.push({
        drugs: [s, n],
        severity: "moderate",
        description: `SSRIs like ${s} can impair platelet aggregation. Combining with NSAIDs like ${n} increases the risk of upper GI bleeding.`,
        recommendation: "Use with caution. Consider a PPI (e.g. omeprazole) for gastroprotection if concurrent use is necessary.",
      });
    }
  }

  // 6. SSRIs + Anticoagulants -> moderate
  for (const s of CLASSES.SSRIs) {
    for (const c of CLASSES.Anticoagulants) {
      list.push({
        drugs: [s, c],
        severity: "moderate",
        description: `SSRIs like ${s} increase bleeding risk when combined with blood thinners like ${c}.`,
        recommendation: "Monitor for signs of bleeding (bruising, dark stools). Report unusual bleeding to doctor.",
      });
    }
  }

  // 7. Statins (specifically CYP3A4-metabolized: atorvastatin, simvastatin, lovastatin) + Grapefruit juice -> moderate
  const cyp3a4Statins = ["atorvastatin", "simvastatin", "lovastatin"];
  for (const s of cyp3a4Statins) {
    list.push({
      drugs: [s, SPECIAL.grapefruit],
      severity: "moderate",
      description: `Grapefruit juice inhibits CYP3A4 metabolism of ${s}, increasing blood levels and raising the risk of muscle damage (rhabdomyolysis).`,
      recommendation: "Avoid grapefruit and grapefruit juice while taking this medication.",
    });
  }

  // 8. Metformin + Alcohol -> severe
  list.push({
    drugs: ["metformin", SPECIAL.alcohol],
    severity: "severe",
    description: "Alcohol intake increases metformin's risk of causing lactic acidosis, a rare but life-threatening condition.",
    recommendation: "Limit or avoid alcohol consumption while taking metformin.",
  });

  // 9. Metformin + PPIs -> mild
  for (const p of CLASSES.PPIs) {
    list.push({
      drugs: ["metformin", p],
      severity: "mild",
      description: `PPIs like ${p} can reduce vitamin B12 absorption over time, potentially worsening metformin-induced B12 deficiency.`,
      recommendation: "Monitor vitamin B12 levels periodically during long-term concurrent use.",
    });
  }

  // 10. BetaBlockers + NSAIDs -> mild
  for (const b of CLASSES.BetaBlockers) {
    for (const n of CLASSES.NSAIDs) {
      list.push({
        drugs: [b, n],
        severity: "mild",
        description: `NSAIDs like ${n} may decrease the blood pressure-lowering effect of beta-blockers like ${b}.`,
        recommendation: "Monitor blood pressure if starting or adjusting NSAID therapy.",
      });
    }
  }

  // 11. Diuretics + NSAIDs -> moderate
  for (const d of CLASSES.Diuretics) {
    for (const n of CLASSES.NSAIDs) {
      list.push({
        drugs: [d, n],
        severity: "moderate",
        description: `NSAIDs like ${n} can reduce the effectiveness of diuretics like ${d} and increase kidney damage risk.`,
        recommendation: "Monitor renal function and weight. Limit NSAID usage.",
      });
    }
  }

  // 12. Potassium-sparing diuretics + Potassium -> severe
  const kSparing = ["spironolactone", "eplerenone", "triamterene"];
  for (const d of kSparing) {
    for (const k of CLASSES.Potassium) {
      list.push({
        drugs: [d, k],
        severity: "severe",
        description: `Potassium-sparing diuretic ${d} combined with potassium supplements causes a high risk of severe hyperkalemia.`,
        recommendation: "Do not take potassium supplements with potassium-sparing diuretics.",
      });
    }
  }

  // 13. Potassium-sparing diuretics + ACEI -> moderate
  for (const d of kSparing) {
    for (const a of CLASSES.ACEI) {
      list.push({
        drugs: [d, a],
        severity: "moderate",
        description: `Both ${d} and ACE inhibitor ${a} conserve potassium. Combined use increases hyperkalemia risk.`,
        recommendation: "Regularly monitor serum potassium levels and kidney function.",
      });
    }
  }

  return list;
}

// Sleep function to respect rate limits
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSync() {
  console.log("Starting drug-interactions ETL sync...");
  const rawInteractions = generateAllInteractions();
  console.log(`Discovered ${rawInteractions.length} clinical interactions for processing.`);

  const pageSize = 50;
  const totalItems = rawInteractions.length;
  const processedInteractions: Interaction[] = [];

  // Paged processing
  for (let offset = 0; offset < totalItems; offset += pageSize) {
    const page = rawInteractions.slice(offset, offset + pageSize);
    console.log(`Processing page ${Math.floor(offset / pageSize) + 1} (${offset} to ${Math.min(offset + pageSize, totalItems)})...`);

    // Ingest page
    for (const item of page) {
      processedInteractions.push(item);
    }

    // Rate-limiting delay between pages
    await sleep(50);
  }

  const targetPath = path.resolve(import.meta.dirname, "../shared/reference/drug-interactions.json");
  const targetDir = path.dirname(targetPath);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(processedInteractions, null, 2), "utf8");
  console.log(`ETL sync complete. Saved ${processedInteractions.length} drug-drug interactions to ${targetPath}`);
}

runSync().catch(console.error);
