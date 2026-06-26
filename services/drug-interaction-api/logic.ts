import { z } from "zod";
import { delimitedFreeTextListSchema } from "../../shared/free-text.ts";

export interface Interaction {
  drugs: [string, string];
  severity: "mild" | "moderate" | "severe";
  description: string;
  recommendation: string;
}

export const INTERACTIONS: Interaction[] = [
  {
    drugs: ["lisinopril", "potassium"],
    severity: "severe",
    description:
      "Lisinopril can increase potassium levels. Taking potassium supplements with ACE inhibitors may cause dangerously high potassium (hyperkalemia).",
    recommendation:
      "Monitor potassium levels regularly. Avoid potassium supplements unless directed by physician.",
  },
  {
    drugs: ["metformin", "alcohol"],
    severity: "severe",
    description:
      "Alcohol with metformin increases risk of lactic acidosis, a rare but life-threatening condition.",
    recommendation:
      "Limit alcohol consumption. Seek immediate medical attention if experiencing unusual muscle pain.",
  },
  {
    drugs: ["atorvastatin", "grapefruit"],
    severity: "moderate",
    description:
      "Grapefruit can increase atorvastatin blood levels, raising the risk of muscle damage (rhabdomyolysis).",
    recommendation:
      "Avoid grapefruit and grapefruit juice while taking atorvastatin.",
  },
  {
    drugs: ["lisinopril", "ibuprofen"],
    severity: "moderate",
    description:
      "NSAIDs like ibuprofen can reduce lisinopril's effectiveness and may increase kidney damage risk.",
    recommendation:
      "Use acetaminophen (Tylenol) instead of ibuprofen for pain relief.",
  },
  {
    drugs: ["amlodipine", "atorvastatin"],
    severity: "mild",
    description:
      "Amlodipine can slightly increase atorvastatin blood levels. Generally safe at standard doses.",
    recommendation:
      "No action needed at standard doses. Monitor for muscle pain if atorvastatin dose exceeds 20mg.",
  },
  {
    drugs: ["metformin", "atorvastatin"],
    severity: "mild",
    description:
      "Some studies suggest statins may slightly increase blood sugar levels. Very common in diabetic patients.",
    recommendation:
      "Monitor blood sugar levels as usual. Benefits of statin therapy generally outweigh this small risk.",
  },
  {
    drugs: ["omeprazole", "metformin"],
    severity: "mild",
    description:
      "Long-term omeprazole use may reduce vitamin B12 absorption, compounding metformin's known B12 effect.",
    recommendation:
      "Consider periodic B12 level monitoring, especially after 2+ years of concurrent use.",
  },
  {
    drugs: ["lisinopril", "amlodipine"],
    severity: "mild",
    description:
      "Common intentional combination for blood pressure management. Both lower BP through different mechanisms.",
    recommendation:
      "Monitor for excessive blood pressure lowering (dizziness, lightheadedness).",
  },
];

export const NORMALIZED_INTERACTIONS = INTERACTIONS.map((interaction) => ({
  ...interaction,
  drugs: [
    interaction.drugs[0].toLowerCase(),
    interaction.drugs[1].toLowerCase(),
  ] as [string, string],
}));

export const DrugInteractionsQuerySchema = z
  .object({
    meds: delimitedFreeTextListSchema("meds"),
  })
  .strict()
  .refine(
    ({ meds }) => meds.length >= 2,
    "Need at least 2 medications",
  )
  .transform(({ meds }) => ({ medications: meds }));

export type DrugInteractionsQuery = z.infer<typeof DrugInteractionsQuerySchema>;

function sortPairsBySeverity(pairs: any[]) {
  const severityOrder: Record<string, number> = {
    severe: 0,
    moderate: 1,
    mild: 2,
  };

  return pairs.sort((left, right) => {
    const severityDiff =
      (severityOrder[left.severity] ?? 3) - (severityOrder[right.severity] ?? 3);
    if (severityDiff !== 0) {
      return severityDiff;
    }

    const leftKey = [left.drug1, left.drug2].sort().join("|");
    const rightKey = [right.drug1, right.drug2].sort().join("|");
    return leftKey.localeCompare(rightKey);
  });
}

export function checkInteractions(medications: string[]) {
  const normalizedMedications = medications.map((medication) =>
    medication.toLowerCase().trim(),
  );
  const found: Array<{
    drug1: string;
    drug2: string;
    severity: Interaction["severity"];
    description: string;
    recommendation: string;
  }> = [];

  for (let left = 0; left < normalizedMedications.length; left++) {
    for (let right = left + 1; right < normalizedMedications.length; right++) {
      for (const interaction of NORMALIZED_INTERACTIONS) {
        const [first, second] = interaction.drugs;
        if (
          (normalizedMedications[left] === first &&
            normalizedMedications[right] === second) ||
          (normalizedMedications[left] === second &&
            normalizedMedications[right] === first)
        ) {
          found.push({
            drug1: medications[left],
            drug2: medications[right],
            severity: interaction.severity,
            description: interaction.description,
            recommendation: interaction.recommendation,
          });
        }
      }
    }
  }

  const severeCount = found.filter(
    (interaction) => interaction.severity === "severe",
  ).length;
  const moderateCount = found.filter(
    (interaction) => interaction.severity === "moderate",
  ).length;

  return {
    medications,
    interactionCount: found.length,
    severeCount,
    moderateCount,
    mildCount: found.length - severeCount - moderateCount,
    interactions: sortPairsBySeverity(found),
    overallRisk:
      severeCount > 0
        ? "high"
        : moderateCount > 0
          ? "moderate"
          : found.length > 0
            ? "low"
            : "none",
    summary:
      found.length === 0
        ? "No known interactions found."
        : `Found ${found.length} interaction(s): ${severeCount} severe, ${moderateCount} moderate, ${found.length - severeCount - moderateCount} mild.`,
  };
}
