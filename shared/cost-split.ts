import { z } from 'zod';

/**
 * Caregiver Cost Splitting Ledger (#1220)
 *
 * Layers a collaborative expense-sharing ledger on top of Stellar payments.
 * Tracks contributor shares, calculates running net balances between caregivers,
 * and records manual settlements ("paid back").
 */

export const CostSplitShareSchema = z.object({
  caregiverId: z.string().min(1),
  caregiverName: z.string().min(1),
  amount: z.number().positive(),
  status: z.enum(['owed', 'settled']).default('owed'),
  settledAt: z.string().optional(),
  settledBy: z.string().optional(),
});

export type CostSplitShare = z.infer<typeof CostSplitShareSchema>;

export const CostSplitSchema = z.object({
  id: z.string().min(1),
  transactionId: z.string().min(1),
  recipientId: z.string().min(1),
  totalAmount: z.number().positive(),
  payerId: z.string().min(1),
  payerName: z.string().min(1),
  description: z.string().optional(),
  shares: z.array(CostSplitShareSchema),
  createdAt: z.string().min(1),
});

export type CostSplit = z.infer<typeof CostSplitSchema>;

export interface ContributorBalance {
  fromCaregiverId: string;
  fromCaregiverName: string;
  toCaregiverId: string;
  toCaregiverName: string;
  amount: number;
}

export interface ContributorBalanceSummary {
  balances: ContributorBalance[];
  totalOwed: number;
  totalSettled: number;
}

/**
 * Calculates net running balances owed between contributors across all splits.
 *
 * Time Complexity: O(S + C^2) where S is total number of shares and C is unique caregivers.
 * Space Complexity: O(C^2) for pairwise balance ledger.
 *
 * @param splits - Array of cost split records
 * @returns Summary of net amounts owed between caregiver pairs
 */
export function calculateContributorBalances(splits: CostSplit[]): ContributorBalanceSummary {
  const pairwiseDebt: Record<string, Record<string, number>> = {};
  const nameMap: Record<string, string> = {};
  let totalOwed = 0;
  let totalSettled = 0;

  for (const split of splits) {
    nameMap[split.payerId] = split.payerName;

    for (const share of split.shares) {
      nameMap[share.caregiverId] = share.caregiverName;

      if (share.status === 'settled') {
        totalSettled += share.amount;
        continue;
      }

      // Only count active debts where the contributor is not the payer
      if (share.caregiverId !== split.payerId) {
        totalOwed += share.amount;

        pairwiseDebt[share.caregiverId] ??= {};
        pairwiseDebt[share.caregiverId][split.payerId] =
          (pairwiseDebt[share.caregiverId][split.payerId] || 0) + share.amount;
      }
    }
  }

  // Compute net balances between all pairs (A, B)
  const caregiverIds = Object.keys(nameMap).sort();
  const balances: ContributorBalance[] = [];

  for (let i = 0; i < caregiverIds.length; i++) {
    for (let j = i + 1; j < caregiverIds.length; j++) {
      const a = caregiverIds[i];
      const b = caregiverIds[j];

      const aOwesB = pairwiseDebt[a]?.[b] || 0;
      const bOwesA = pairwiseDebt[b]?.[a] || 0;
      const net = +(aOwesB - bOwesA).toFixed(2);

      if (net > 0) {
        balances.push({
          fromCaregiverId: a,
          fromCaregiverName: nameMap[a] || a,
          toCaregiverId: b,
          toCaregiverName: nameMap[b] || b,
          amount: net,
        });
      } else if (net < 0) {
        balances.push({
          fromCaregiverId: b,
          fromCaregiverName: nameMap[b] || b,
          toCaregiverId: a,
          toCaregiverName: nameMap[a] || a,
          amount: -net,
        });
      }
    }
  }

  return {
    balances,
    totalOwed: +totalOwed.toFixed(2),
    totalSettled: +totalSettled.toFixed(2),
  };
}

export const computeContributorBalances = calculateContributorBalances;

export function validateCostSplitShares(
  totalAmount: number,
  shares: CostSplitShare[],
  tolerance = 0.05
): { valid: boolean; difference: number } {
  const sum = shares.reduce((acc, s) => acc + s.amount, 0);
  const diff = Math.abs(sum - totalAmount);
  return {
    valid: diff <= tolerance,
    difference: +diff.toFixed(2),
  };
}
