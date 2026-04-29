const fs = require('fs');
const { getMonthlyReturns, calculateStdDev, calculateSharpeRatio } = require('./services/metricsCalculator.js');

const fundsPath = 'cache/nav_100038.json';
const fundData = JSON.parse(fs.readFileSync(fundsPath, 'utf8'));
const navHistory = fundData.data;

if (navHistory && navHistory.length > 0) {
  console.log("NAV History length:", navHistory.length);
  const returns = getMonthlyReturns(navHistory, 3);
  console.log("Monthly returns length:", Object.keys(returns).length);
  console.log("StdDev:", calculateStdDev(returns));
  
  // also dump the dates
  console.log("First Date in parsed:", navHistory[navHistory.length - 1].date, "Last Date:", navHistory[0].date);
} else {
  console.log("No fund found with sufficient NAV.");
}
