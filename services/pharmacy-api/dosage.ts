const dosageByDrug = new Map<string, string>();

export function resolveRequestedDosage(drug: string, dosage?: string) {
  const normalizedDrug = drug.toLowerCase().trim();
  const resolved = dosage?.trim() || dosageByDrug.get(normalizedDrug) || 'unspecified';
  dosageByDrug.set(normalizedDrug, resolved);
  return resolved;
}
