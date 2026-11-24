export interface PharmacyPrice {
  pharmacy: string;
  id: string;
  price: number;
  distance: string;
}

export const DEFAULT_ZIP_CODE = "90210";

export const PRICING_DATABASE: Record<string, Record<string, PharmacyPrice[]>> = {
  lisinopril: {
    "90210": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 3.50, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 12.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 15.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 18.99, distance: "3.2 mi" },
    ],
    "10001": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.20, distance: "3.5 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.50, distance: "2.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 14.50, distance: "0.4 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 16.99, distance: "0.6 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 19.50, distance: "1.2 mi" },
    ],
    "33101": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 3.10, distance: "4.0 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 3.80, distance: "1.5 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 11.50, distance: "0.8 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 14.00, distance: "1.1 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 17.25, distance: "2.5 mi" },
    ],
    default: [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 3.50, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 12.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 15.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 18.99, distance: "3.2 mi" },
    ],
  },
  metformin: {
    "90210": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.00, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 11.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 13.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 16.79, distance: "3.2 mi" },
    ],
    "10001": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.80, distance: "3.5 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.50, distance: "2.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 13.50, distance: "0.4 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 15.20, distance: "0.6 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 18.00, distance: "1.2 mi" },
    ],
    default: [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.00, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 11.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 13.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 16.79, distance: "3.2 mi" },
    ],
  },
  atorvastatin: {
    "90210": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 6.50, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 9.00, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 24.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 28.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 31.99, distance: "3.2 mi" },
    ],
    "10001": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 7.80, distance: "3.5 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 10.50, distance: "2.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 27.50, distance: "0.4 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 31.00, distance: "0.6 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 34.75, distance: "1.2 mi" },
    ],
    "33101": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 6.00, distance: "4.0 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 8.50, distance: "1.5 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 23.25, distance: "0.8 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 26.75, distance: "1.1 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 29.50, distance: "2.5 mi" },
    ],
    default: [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 6.50, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 9.00, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 24.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 28.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 31.99, distance: "3.2 mi" },
    ],
  },
  amlodipine: {
    "90210": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.20, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 14.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 17.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 19.99, distance: "3.2 mi" },
    ],
    "10001": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 5.00, distance: "3.5 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.75, distance: "2.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 16.75, distance: "0.4 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 19.25, distance: "0.6 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 21.50, distance: "1.2 mi" },
    ],
    "33101": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 3.90, distance: "4.0 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 3.75, distance: "1.5 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 13.75, distance: "0.8 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 16.25, distance: "1.1 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 18.50, distance: "2.5 mi" },
    ],
    default: [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.20, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 14.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 17.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 19.99, distance: "3.2 mi" },
    ],
  },
  omeprazole: {
    "90210": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 5.80, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 8.50, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 22.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 25.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 27.99, distance: "3.2 mi" },
    ],
    "10001": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 6.90, distance: "3.5 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 9.75, distance: "2.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 25.50, distance: "0.4 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 28.25, distance: "0.6 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 30.50, distance: "1.2 mi" },
    ],
    "33101": [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 5.40, distance: "4.0 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 8.00, distance: "1.5 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 21.25, distance: "0.8 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 24.00, distance: "1.1 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 26.50, distance: "2.5 mi" },
    ],
    default: [
      { pharmacy: "Costco Pharmacy", id: "costco-001", price: 5.80, distance: "2.1 mi" },
      { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 8.50, distance: "1.8 mi" },
      { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 22.99, distance: "0.5 mi" },
      { pharmacy: "Walgreens", id: "walgreens-001", price: 25.49, distance: "0.8 mi" },
      { pharmacy: "Rite Aid", id: "riteaid-001", price: 27.99, distance: "3.2 mi" },
    ],
  },
};

export function getPharmacyPrices(
  drugName: string,
  zipCode?: string,
): { prices: PharmacyPrice[]; usedZipCode: string; isFallbackZip: boolean } {
  const norm = drugName.trim().toLowerCase();
  const entry = PRICING_DATABASE[norm];
  if (!entry) {
    throw new Error(`Drug not found: ${drugName}`);
  }
  const zip = zipCode?.trim();
  if (zip && entry[zip]) {
    return { prices: entry[zip], usedZipCode: zip, isFallbackZip: false };
  }
  const defaultPrices = entry[DEFAULT_ZIP_CODE] ?? entry["default"];
  return { prices: defaultPrices, usedZipCode: DEFAULT_ZIP_CODE, isFallbackZip: true };
}

export function getAvailableDrugs(): string[] {
  return Object.keys(PRICING_DATABASE);
}
