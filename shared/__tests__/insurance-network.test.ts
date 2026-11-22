/**
 * Insurance network checks for price comparison and bill audits (#1234).
 */
import { describe, it, expect } from "vitest";
import {
  addProviderNetworkFinding,
  annotatePharmacyNetwork,
  emptyInsuranceNetwork,
  networkStatusFor,
  type InsuranceNetwork,
} from "../insurance-network.ts";

const network: InsuranceNetwork = {
  plan: "Medicare Part D",
  pharmacies: [{ id: "pharm-2", name: "Walgreens" }, { name: "CVS Pharmacy" }],
  providers: [{ name: "General Hospital" }],
  updatedAt: null,
  updatedBy: null,
};

const comparison = {
  drug: "Lisinopril",
  prices: [
    { pharmacyName: "Costco Pharmacy", pharmacyId: "pharm-1", price: 4 },
    { pharmacyName: "Walgreens", pharmacyId: "pharm-2", price: 9 },
    { pharmacyName: "cvs pharmacy", pharmacyId: "pharm-3", price: 12 },
  ],
  cheapest: { pharmacyName: "Costco Pharmacy", pharmacyId: "pharm-1", price: 4 },
};

describe("networkStatusFor", () => {
  it("matches by id or by normalized name", () => {
    expect(networkStatusFor(network.pharmacies, { id: "pharm-2", name: "Other" })).toBe("in_network");
    expect(networkStatusFor(network.pharmacies, { name: "CVS  pharmacy!" })).toBe("in_network");
    expect(networkStatusFor(network.pharmacies, { name: "Costco Pharmacy" })).toBe("out_of_network");
  });

  it("is unknown, not out-of-network, when no list is configured", () => {
    expect(networkStatusFor([], { name: "Costco Pharmacy" })).toBe("unknown");
  });
});

describe("annotatePharmacyNetwork", () => {
  it("flags out-of-network pharmacies with an explanation", () => {
    const result = annotatePharmacyNetwork(comparison, network);
    expect(result.prices.map((p: any) => p.networkStatus)).toEqual(["out_of_network", "in_network", "in_network"]);
    expect(result.prices[0].networkNote).toMatch(/not on the in-network pharmacy list for the Medicare Part D plan/);
    expect(result.prices[1].networkNote).toBeUndefined();
  });

  it("explains when the cheapest option is out-of-network and names the cheapest in-network one", () => {
    const result = annotatePharmacyNetwork(comparison, network);
    expect(result.cheapest.networkStatus).toBe("out_of_network");
    expect(result.network).toMatchObject({
      configured: true,
      outOfNetworkCount: 1,
      cheapestInNetwork: { pharmacyName: "Walgreens", price: 9 },
    });
    expect(result.network.explanation).toMatch(/cheapest in-network option is Walgreens at \$9\.00/);
  });

  it("marks everything unknown and says how to fix it when no list exists", () => {
    const result = annotatePharmacyNetwork(comparison, emptyInsuranceNetwork());
    expect(result.prices.every((p: any) => p.networkStatus === "unknown")).toBe(true);
    expect(result.network.configured).toBe(false);
    expect(result.network.explanation).toMatch(/Settings/);
  });

  it("leaves error results untouched", () => {
    const error = { ok: false, reason: "NO_PRICES_FOUND" };
    expect(annotatePharmacyNetwork(error, network)).toBe(error);
  });
});

describe("addProviderNetworkFinding", () => {
  const audit = { totalCharged: 1200, errorCount: 0, lineItems: [], recommendation: "No errors detected." };

  it("adds an out_of_network_provider finding without counting it as a billing error", () => {
    const result = addProviderNetworkFinding(audit, network, { name: "Sunrise Specialty Clinic" });
    expect(result.providerNetworkStatus).toBe("out_of_network");
    expect(result.errorCount).toBe(0);
    expect(result.findings).toEqual([
      expect.objectContaining({
        type: "out_of_network_provider",
        providerName: "Sunrise Specialty Clinic",
        amountAtRisk: 1200,
        explanation: expect.stringMatching(/balance billing/),
      }),
    ]);
    expect(result.recommendation).toMatch(/out-of-network: confirm coverage/);
  });

  it("adds no finding for an in-network provider", () => {
    const result = addProviderNetworkFinding(audit, network, { name: "General Hospital" });
    expect(result.providerNetworkStatus).toBe("in_network");
    expect(result.findings).toBeUndefined();
  });

  it("does nothing without a provider or for a failed audit", () => {
    expect(addProviderNetworkFinding(audit, network, {})).toBe(audit);
    const failed = { ok: false, reason: "INVALID" };
    expect(addProviderNetworkFinding(failed, network, { name: "X" })).toBe(failed);
  });
});
