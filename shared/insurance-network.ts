/**
 * Insurance network checks (#1234).
 *
 * A recipient's record only carries a free-text `insurance` plan name, so
 * nothing told the caregiver whether the pharmacy the agent picked, or the
 * provider on a bill, was in-network — a common source of surprise costs.
 *
 * With no external payer integration, the caregiver maintains the in-network
 * pharmacy and provider lists by hand (stored per recipient in
 * services/care-recipients/db.ts). These helpers annotate
 * compare_pharmacy_prices and audit_medical_bill results against that list.
 * When no list has been configured nothing is marked out-of-network: an
 * empty list means "unknown", never "everything is out of network".
 */

export interface NetworkEntry {
  /** Pharmacy or provider id as the price/bill APIs report it, when known. */
  id?: string;
  /** Display name; also used for matching when ids aren't available. */
  name: string;
}

export interface InsuranceNetwork {
  /** Plan name, defaulting to the recipient's `insurance` field. */
  plan: string | null;
  pharmacies: NetworkEntry[];
  providers: NetworkEntry[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export type NetworkStatus = "in_network" | "out_of_network" | "unknown";

export const MAX_NETWORK_ENTRIES = 200;

export function emptyInsuranceNetwork(plan: string | null = null): InsuranceNetwork {
  return { plan, pharmacies: [], providers: [], updatedAt: null, updatedBy: null };
}

/** Case/punctuation-insensitive name key, so "CVS Pharmacy #123" matches "cvs pharmacy 123". */
export function normalizeNetworkName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** In-network when the id or normalized name is on the list; unknown when the list is empty. */
export function networkStatusFor(
  entries: readonly NetworkEntry[],
  candidate: { id?: string | null; name?: string | null },
): NetworkStatus {
  if (entries.length === 0) return "unknown";
  const id = candidate.id?.trim();
  const name = candidate.name ? normalizeNetworkName(candidate.name) : "";
  const listed = entries.some(
    (entry) =>
      (id && entry.id && entry.id.trim() === id) ||
      (name && normalizeNetworkName(entry.name) === name),
  );
  return listed ? "in_network" : "out_of_network";
}

function planLabel(network: InsuranceNetwork): string {
  return network.plan?.trim() ? `the ${network.plan.trim()} plan` : "the recipient's insurance plan";
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Explanation shown alongside an out-of-network pharmacy, not just a badge. */
export function explainOutOfNetworkPharmacy(name: string, network: InsuranceNetwork): string {
  return (
    `${name} is not on the in-network pharmacy list for ${planLabel(network)}. ` +
    `Insurance may cover less of this prescription there, or nothing at all, so the amount ` +
    `actually owed can be higher than the listed price. Check with the plan before ordering, ` +
    `or add the pharmacy to the in-network list if it is covered.`
  );
}

/** Explanation for an out-of-network provider charge on a bill. */
export function explainOutOfNetworkProvider(name: string, network: InsuranceNetwork, amount: number): string {
  return (
    `${name} is not on the in-network provider list for ${planLabel(network)}. ` +
    `Out-of-network care is often reimbursed at a lower rate or not at all, and the provider may ` +
    `bill the difference (balance billing), so the ${money(amount)} on this bill may not be what ` +
    `insurance pays. Ask the plan how this claim was processed, and whether the No Surprises Act ` +
    `protects it (e.g. emergency care or an out-of-network clinician at an in-network facility), ` +
    `before paying.`
  );
}

interface PriceLike {
  pharmacyName?: string;
  pharmacyId?: string;
  price?: number;
  [key: string]: unknown;
}

/**
 * Adds `networkStatus` (and an explanation when out-of-network) to each
 * pharmacy in a compare_pharmacy_prices result, plus a `network` summary that
 * calls out when the cheapest option is out-of-network and names the
 * cheapest in-network alternative.
 */
export function annotatePharmacyNetwork<T extends Record<string, any>>(data: T, network: InsuranceNetwork): T {
  if (!data || !Array.isArray(data.prices)) return data;

  const annotate = (price: PriceLike | undefined) => {
    if (!price || typeof price !== "object") return price;
    const status = networkStatusFor(network.pharmacies, { id: price.pharmacyId, name: price.pharmacyName });
    return {
      ...price,
      networkStatus: status,
      ...(status === "out_of_network"
        ? { networkNote: explainOutOfNetworkPharmacy(String(price.pharmacyName ?? "This pharmacy"), network) }
        : {}),
    };
  };

  const prices = (data.prices as PriceLike[]).map(annotate) as Array<PriceLike & { networkStatus: NetworkStatus }>;
  const configured = network.pharmacies.length > 0;
  const outOfNetwork = prices.filter((p) => p.networkStatus === "out_of_network");
  const inNetwork = prices
    .filter((p) => p.networkStatus === "in_network" && typeof p.price === "number")
    .sort((a, b) => (a.price as number) - (b.price as number));
  const cheapest = annotate(data.cheapest as PriceLike | undefined) as (PriceLike & { networkStatus?: NetworkStatus }) | undefined;

  let explanation: string;
  if (!configured) {
    explanation =
      "No in-network pharmacy list is set up for this recipient, so network status is unknown. " +
      "Add the plan's in-network pharmacies in Settings to have out-of-network options flagged.";
  } else if (outOfNetwork.length === 0) {
    explanation = `All compared pharmacies are in-network for ${planLabel(network)}.`;
  } else if (cheapest?.networkStatus === "out_of_network") {
    const alt = inNetwork[0];
    explanation =
      `The cheapest option, ${cheapest.pharmacyName}, is out-of-network for ${planLabel(network)}, ` +
      `so its listed price may not reflect what insurance covers. ` +
      (alt
        ? `The cheapest in-network option is ${alt.pharmacyName} at ${money(alt.price as number)}.`
        : "None of the compared pharmacies are in-network.");
  } else {
    explanation =
      `${outOfNetwork.length} of ${prices.length} compared pharmacies are out-of-network ` +
      `(${outOfNetwork.map((p) => p.pharmacyName).join(", ")}); the cheapest option is in-network.`;
  }

  return {
    ...data,
    prices,
    ...(cheapest ? { cheapest } : {}),
    network: {
      plan: network.plan,
      configured,
      outOfNetworkCount: outOfNetwork.length,
      cheapestInNetwork: inNetwork[0]
        ? { pharmacyName: inNetwork[0].pharmacyName, pharmacyId: inNetwork[0].pharmacyId, price: inNetwork[0].price }
        : null,
      explanation,
    },
  };
}

export interface OutOfNetworkFinding {
  type: "out_of_network_provider";
  providerName: string;
  providerId?: string;
  /** Total charged on the bill, all of which is exposed to out-of-network pricing. */
  amountAtRisk: number;
  explanation: string;
}

/**
 * Adds an out-of-network provider finding to an audit_medical_bill result.
 * It is a separate finding type in `findings`, not a line-item error: the
 * charges may be priced correctly yet still not be covered.
 */
export function addProviderNetworkFinding<T extends Record<string, any>>(
  audit: T,
  network: InsuranceNetwork,
  provider: { id?: string; name?: string },
): T {
  if (!audit || typeof audit !== "object" || audit.ok === false) return audit;
  if (!provider.id && !provider.name) return audit;

  const status = networkStatusFor(network.providers, provider);
  const providerName = provider.name || provider.id || "This provider";
  const withStatus = { ...audit, providerNetworkStatus: status };
  if (status !== "out_of_network") return withStatus;

  const amountAtRisk = Number(audit.totalCharged) || 0;
  const finding: OutOfNetworkFinding = {
    type: "out_of_network_provider",
    providerName,
    ...(provider.id ? { providerId: provider.id } : {}),
    amountAtRisk: +amountAtRisk.toFixed(2),
    explanation: explainOutOfNetworkProvider(providerName, network, amountAtRisk),
  };
  const findings = Array.isArray(audit.findings) ? audit.findings : [];
  const recommendation =
    typeof audit.recommendation === "string" && audit.recommendation.trim()
      ? `${audit.recommendation} ${providerName} is out-of-network: confirm coverage with the plan before paying.`
      : `${providerName} is out-of-network: confirm coverage with the plan before paying.`;
  return { ...withStatus, findings: [...findings, finding], recommendation };
}
