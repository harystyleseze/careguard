/**
 * Quick verification script for pricing providers
 * Run with: node --import tsx scripts/test-pricing-providers.ts
 */

import { createPricingProvider, StaticProvider, GoodRxProvider, CostcoRxProvider } from '../shared/pricing-sources.ts';

async function testProvider(providerName: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${providerName.toUpperCase()} Provider`);
  console.log('='.repeat(60));
  
  const provider = createPricingProvider(providerName);
  
  // Get drug count
  const count = await provider.getDrugCount();
  console.log(`\n📊 Total drugs available: ${count}`);
  
  // Test with a common drug
  const testDrug = 'lisinopril';
  console.log(`\n💊 Testing drug: ${testDrug}`);
  
  try {
    const prices = await provider.getPrices(testDrug, '90210');
    console.log(`   Found ${prices.length} pharmacies:`);
    
    prices.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.pharmacy.padEnd(25)} $${p.price.toFixed(2).padStart(7)} (${p.distance})`);
    });
    
    const sorted = [...prices].sort((a, b) => a.price - b.price);
    const savings = sorted[sorted.length - 1].price - sorted[0].price;
    console.log(`\n   💰 Potential savings: $${savings.toFixed(2)} (${((savings / sorted[sorted.length - 1].price) * 100).toFixed(0)}%)`);
  } catch (error) {
    console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function main() {
  console.log('\n🏥 Pharmacy Pricing Provider Test Suite');
  console.log('Testing all available providers...\n');
  
  // Test all providers
  await testProvider('static');
  await testProvider('goodrx');
  await testProvider('costco');
  
  // Test provider-specific drugs
  console.log(`\n${'='.repeat(60)}`);
  console.log('Testing Provider-Specific Drugs');
  console.log('='.repeat(60));
  
  const goodrx = new GoodRxProvider();
  const testDrugs = ['sertraline', 'gabapentin', 'duloxetine'];
  
  for (const drug of testDrugs) {
    try {
      const prices = await goodrx.getPrices(drug, '90210');
      const cheapest = prices.sort((a, b) => a.price - b.price)[0];
      console.log(`\n💊 ${drug.padEnd(20)} → Cheapest: ${cheapest.pharmacy} at $${cheapest.price.toFixed(2)}`);
    } catch (error) {
      console.log(`\n💊 ${drug.padEnd(20)} → Not found`);
    }
  }
  
  // Test caching
  console.log(`\n${'='.repeat(60)}`);
  console.log('Testing Cache Performance');
  console.log('='.repeat(60));
  
  const provider = new GoodRxProvider();
  
  console.log('\n⏱️  First call (cache miss):');
  const start1 = Date.now();
  await provider.getPrices('atorvastatin', '90210');
  const time1 = Date.now() - start1;
  console.log(`   Time: ${time1}ms`);
  
  console.log('\n⏱️  Second call (cache hit):');
  const start2 = Date.now();
  await provider.getPrices('atorvastatin', '90210');
  const time2 = Date.now() - start2;
  console.log(`   Time: ${time2}ms`);
  console.log(`   Speedup: ${(time1 / time2).toFixed(1)}x faster`);
  
  console.log('\n✅ All tests completed!\n');
}

main().catch(console.error);
