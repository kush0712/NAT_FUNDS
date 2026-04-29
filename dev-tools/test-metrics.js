const fs = require('fs');
const { getMonthlyReturns, calculateStdDev, calculateSharpeRatio } = require('./services/metricsCalculator.js');

const fundsPath = 'cache/processed_funds.json';
const funds = JSON.parse(fs.readFileSync(fundsPath, 'utf8')).funds;

const fund = funds.find(f => f.navHistory && f.navHistory.length > 500);

if (fund) {
  console.log("Found fund:", fund.schemeName);
  console.log("NAV History length:", fund.navHistory.length);
  const returns = getMonthlyReturns(fund.navHistory, 3);
  console.log("Monthly returns length:", Object.keys(returns).length);
  console.log("StdDev:", calculateStdDev(returns));
  //console.log("Calculated metrics:", fund.metrics);
  
  // also dump the dates
  const parsedD = fund.navHistory;
  console.log("First Date:", parsedD[0].date, "Last Date:", parsedD[parsedD.length - 1].date);
} else {
  console.log("No fund found with sufficient NAV.");
}
