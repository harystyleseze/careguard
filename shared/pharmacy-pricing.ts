export interface PharmacyPrice {
  pharmacy: string;
  id: string;
  price: number;
  distance: string;
}

export const PRICING_DATABASE: Record<string, PharmacyPrice[]> = {
  lisinopril: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 3.50, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 12.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 15.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 18.99, distance: "3.2 mi" },
  ],
  metformin: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.00, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 11.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 13.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 16.79, distance: "3.2 mi" },
  ],
  atorvastatin: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 6.50, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 9.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 24.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 28.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 31.99, distance: "3.2 mi" },
  ],
  amlodipine: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.20, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 14.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 17.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 19.99, distance: "3.2 mi" },
  ],
  omeprazole: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 5.80, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 8.50, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 22.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 25.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 27.99, distance: "3.2 mi" },
  ],
};

export function getAvailableDrugs(): string[] {
  return Object.keys(PRICING_DATABASE);
}
