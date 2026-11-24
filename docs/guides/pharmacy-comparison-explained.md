# Pharmacy Price Comparisons Explained

The **Medications** tab compares the prices CareGuard found for a medication and shows a potential lower-cost option. Use the results as a comparison aid, then confirm the price and availability with the pharmacy before ordering.

## How your ZIP code is used

The comparison accepts a five-digit ZIP code. CareGuard uses it to select a location-specific set of pharmacy prices and distance estimates when that medication has data for that ZIP. The displayed distance is informational; pharmacies are **ranked by price, not by distance**.

If there is no matching ZIP entry, the comparison falls back to ZIP code `90210`. The response identifies the ZIP used and whether a fallback occurred. A fallback result may not represent pharmacies or prices near you. Ask whoever manages your CareGuard installation how its ZIP code is configured if the results do not look local.

## What the savings figure means

CareGuard subtracts the lowest listed price from the highest listed price to calculate the potential dollar savings. It calculates the percentage as that difference divided by the highest listed price. For example, if the listed prices range from $3.50 to $18.99, the difference is $15.49, or about 81.6% of the highest listed price.

This is a comparison between the prices CareGuard found, not necessarily a saving against what you currently pay. A monthly savings label is an estimate based on the comparison; actual costs may differ by prescription, quantity, insurance, discount eligibility, and pharmacy.

## Current coverage and limitations

The built-in reference dataset currently includes five medications: lisinopril, metformin, atorvastatin, amlodipine, and omeprazole. ZIP-specific entries are limited; unsupported medication and ZIP combinations use the `90210` fallback. A deployment may have different configured pricing data, so ask its administrator about local coverage.

The listed amounts are reference comparison data, not a live quote. CareGuard does not confirm your insurance coverage or guarantee a pharmacy's current price or stock. Call the pharmacy to confirm the exact medication, dosage, quantity, price, and availability before making a decision. Finding a lower price does not place an order; ordering is a separate action.

For how results appear on the dashboard, see [Medications Tab](medications-tab.md).