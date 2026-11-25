import { PRICING_DATABASE, DEFAULT_ZIP_CODE } from "../../shared/pharmacy-pricing.ts";
import { toDisplayName } from "./db.ts";

export interface PharmacySeedData {
  pharmacies: Array<{
    id: string;
    name: string;
    distanceMiles: number;
  }>;
  drugs: Array<{
    name: string;
    displayName: string;
    defaultDosage?: string;
  }>;
  prices: Array<{
    drug: string;
    pharmacyId: string;
    price: number;
  }>;
}

// Dynamically construct seed data from the shared pricing database
const pharmaciesMap = new Map<string, { id: string; name: string; distanceMiles: number }>();
const drugsList: Array<{ name: string; displayName: string }> = [];
const pricesList: Array<{ drug: string; pharmacyId: string; price: number }> = [];

for (const [drugName, zipMap] of Object.entries(PRICING_DATABASE)) {
  drugsList.push({
    name: drugName,
    displayName: toDisplayName(drugName),
  });

  const plist = zipMap[DEFAULT_ZIP_CODE] || zipMap["default"] || Object.values(zipMap)[0];
  if (plist) {
    for (const p of plist) {
      const distanceMiles = parseFloat(p.distance.replace(" mi", ""));
      if (!pharmaciesMap.has(p.id)) {
        pharmaciesMap.set(p.id, {
          id: p.id,
          name: p.pharmacy,
          distanceMiles,
        });
      }
      pricesList.push({
        drug: drugName,
        pharmacyId: p.id,
        price: p.price,
      });
    }
  }
}

export const PHARMACY_SEED_DATA: PharmacySeedData = {
  pharmacies: Array.from(pharmaciesMap.values()),
  drugs: drugsList,
  prices: pricesList,
};
