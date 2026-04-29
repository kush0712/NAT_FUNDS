const fs = require('fs');
const path = require('path');
const { calculateAllMetrics } = require('./services/metricsCalculator.js');

const fundsPath = 'cache/processed_funds.json';
const funds = JSON.parse(fs.readFileSync(fundsPath, 'utf8')).funds;

let c_stdDev_missing = 0, c_stdDev_present = 0;
let c_beta_missing = 0, c_beta_present = 0;
let c_sharpe_missing = 0, c_sharpe_present = 0;

for (const fund of funds) {
  if (fund.standardDeviation === "Insufficient Data" || fund.standardDeviation == null) {
      c_stdDev_missing++;
  } else {
      c_stdDev_present++;
  }

  // Beta and Sharpe might be properly null if not applicable (like Debt funds), so we check against "Insufficient Data" specifically or just null
  if (fund.beta === "Insufficient Data" ) {
      c_beta_missing++;
  } else if (fund.beta !== null) {
      c_beta_present++;
  }

  if (fund.sharpeRatio === "Insufficient Data") {
      c_sharpe_missing++;
  } else if (fund.sharpeRatio !== null) {
      c_sharpe_present++;
  }
}

console.log(`StdDev  - Present: ${c_stdDev_present}, Missing/Insufficient: ${c_stdDev_missing}`);
console.log(`Beta    - Present: ${c_beta_present}, Insufficient: ${c_beta_missing}`);
console.log(`Sharpe  - Present: ${c_sharpe_present}, Insufficient: ${c_sharpe_missing}`);
