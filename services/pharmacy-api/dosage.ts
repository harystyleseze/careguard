const DEFAULT_RECIPIENT_SCOPE = "default";

/**
 * Scoped storage for per-recipient medication dosage cache.
 * Maps recipientId -> (normalizedDrugName -> dosageString).
 *
 * Space Complexity: O(R * D) where R is the number of active recipient scopes and D is the number of distinct drugs.
 * Time Complexity: O(1) average lookup/insert per operation.
 */
const dosageByRecipient = new Map<string, Map<string, string>>();

export function resolveRequestedDosage(
  drug: string,
  dosage?: string,
  recipientId?: string,
): string {
  const normalizedDrug = drug.toLowerCase().trim();
  const scope = recipientId?.trim().toLowerCase() || DEFAULT_RECIPIENT_SCOPE;

  let recipientMap = dosageByRecipient.get(scope);
  if (!recipientMap) {
    recipientMap = new Map<string, string>();
    dosageByRecipient.set(scope, recipientMap);
  }

  const trimmedDosage = dosage?.trim();
  if (trimmedDosage) {
    recipientMap.set(normalizedDrug, trimmedDosage);
    return trimmedDosage;
  }

  const remembered = recipientMap.get(normalizedDrug);
  if (remembered) {
    return remembered;
  }

  return "unspecified";
}

/**
 * Clears cached dosages for a specific recipient, or all recipients if omitted.
 * Useful for test isolation and cache eviction.
 */
export function clearDosageCache(recipientId?: string): void {
  if (recipientId) {
    dosageByRecipient.delete(recipientId.trim().toLowerCase());
  } else {
    dosageByRecipient.clear();
  }
}
