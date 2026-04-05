const { getMonthlyReturns, calculateStdDev } = require('./services/metricsCalculator');
const { fetchSchemeNav } = require('./services/dataFetcher');
const { initRiskFreeRate } = require('./services/riskFreeRate');
const fs = require('fs');

(async () => {
  await initRiskFreeRate();
  
  const backup = JSON.parse(fs.readFileSync('./cache/processed_funds.json.bak', 'utf-8'));
  const insuffFunds = backup.funds.filter(f => f.standardDeviation === 'Insufficient Data');
  
  let wouldBeValid = 0;
  let stillInsuff = 0;
  let noData = 0;
  
  // Test ALL insufficient funds (using cached NAV data, which is fast)
  for (const fund of insuffFunds) {
    const navData = await fetchSchemeNav(fund.schemeCode);
    if (!navData || !navData.data) { noData++; continue; }
    
    const monthlyReturns = getMonthlyReturns(navData.data, 3);
    const count = Object.keys(monthlyReturns).length;
    
    if (count >= 36) {
      wouldBeValid++;
    } else {
      stillInsuff++;
    }
  }
  
  console.log('=== Results ===');
  console.log('Total "Insufficient Data" funds in cache:', insuffFunds.length);
  console.log('Would now compute valid metrics:', wouldBeValid);
  console.log('Still insufficient (< 36 months):', stillInsuff);
  console.log('No NAV data available:', noData);
  
  process.exit(0);
})();
