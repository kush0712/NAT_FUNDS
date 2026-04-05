const { getMonthlyReturns, calculateBeta } = require('./services/metricsCalculator.js');
const { fetchBenchmarkNav } = require('./services/dataFetcher.js');
const fs = require('fs');

async function run() {
  const benchData = await fetchBenchmarkNav();
  const benchReturnsDict = getMonthlyReturns(benchData.data, 3);
  
  const fundsPath = 'cache/processed_funds.json';
  const funds = JSON.parse(fs.readFileSync(fundsPath, 'utf8')).funds;
  const equityFund = funds.find(f => f.type === 'Equity' && f.navHistory && f.navHistory.length > 500);
  
  if (!equityFund) {
    // Just grab one from cache
    const fundData = JSON.parse(fs.readFileSync('cache/nav_100038.json', 'utf8'));
    const fundReturnsDict = getMonthlyReturns(fundData.data, 3);
    
    console.log("Fund returns keys:", Object.keys(fundReturnsDict).slice(0, 5));
    console.log("Bench returns keys:", Object.keys(benchReturnsDict).slice(0, 5));
    
    const commonKeys = Object.keys(fundReturnsDict)
      .filter(k => benchReturnsDict[k] !== undefined)
      .sort();
    console.log("Common keys length:", commonKeys.length);
    console.log("Beta:", calculateBeta(fundReturnsDict, benchReturnsDict));
  }
}
run();
