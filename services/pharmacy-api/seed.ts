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

export const PHARMACY_SEED_DATA: PharmacySeedData = {
  pharmacies: [
    { id: "costco-001", name: "Costco Pharmacy", distanceMiles: 2.1 },
    { id: "walmart-001", name: "Walmart Pharmacy", distanceMiles: 1.8 },
    { id: "cvs-001", name: "CVS Pharmacy", distanceMiles: 0.5 },
    { id: "walgreens-001", name: "Walgreens", distanceMiles: 0.8 },
    { id: "riteaid-001", name: "Rite Aid", distanceMiles: 3.2 },
  ],
  drugs: [
    { name: "lisinopril", displayName: "Lisinopril" },
    { name: "metformin", displayName: "Metformin" },
    { name: "atorvastatin", displayName: "Atorvastatin" },
    { name: "amlodipine", displayName: "Amlodipine" },
    { name: "omeprazole", displayName: "Omeprazole" },
  ],
  prices: [
    { drug: "lisinopril", pharmacyId: "costco-001", price: 3.5 },
    { drug: "lisinopril", pharmacyId: "walmart-001", price: 4.0 },
    { drug: "lisinopril", pharmacyId: "cvs-001", price: 12.99 },
    { drug: "lisinopril", pharmacyId: "walgreens-001", price: 15.49 },
    { drug: "lisinopril", pharmacyId: "riteaid-001", price: 18.99 },
    { drug: "metformin", pharmacyId: "costco-001", price: 4.0 },
    { drug: "metformin", pharmacyId: "walmart-001", price: 4.0 },
    { drug: "metformin", pharmacyId: "cvs-001", price: 11.99 },
    { drug: "metformin", pharmacyId: "walgreens-001", price: 13.49 },
    { drug: "metformin", pharmacyId: "riteaid-001", price: 16.79 },
    { drug: "atorvastatin", pharmacyId: "costco-001", price: 6.5 },
    { drug: "atorvastatin", pharmacyId: "walmart-001", price: 9.0 },
    { drug: "atorvastatin", pharmacyId: "cvs-001", price: 24.99 },
    { drug: "atorvastatin", pharmacyId: "walgreens-001", price: 28.49 },
    { drug: "atorvastatin", pharmacyId: "riteaid-001", price: 31.99 },
    { drug: "amlodipine", pharmacyId: "costco-001", price: 4.2 },
    { drug: "amlodipine", pharmacyId: "walmart-001", price: 4.0 },
    { drug: "amlodipine", pharmacyId: "cvs-001", price: 14.99 },
    { drug: "amlodipine", pharmacyId: "walgreens-001", price: 17.49 },
    { drug: "amlodipine", pharmacyId: "riteaid-001", price: 19.99 },
    { drug: "omeprazole", pharmacyId: "costco-001", price: 5.8 },
    { drug: "omeprazole", pharmacyId: "walmart-001", price: 8.5 },
    { drug: "omeprazole", pharmacyId: "cvs-001", price: 22.99 },
    { drug: "omeprazole", pharmacyId: "walgreens-001", price: 25.49 },
    { drug: "omeprazole", pharmacyId: "riteaid-001", price: 27.99 },
  ],
};
