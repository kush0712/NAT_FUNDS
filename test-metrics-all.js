const fs = require('fs');
const path = require('path');
const { getMonthlyReturns, calculateStdDev, calculateSharpeRatio } = require('./services/metricsCalculator.js');

const cacheDir = 'cache';
const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('nav_') && f.endsWith('.json'));

let sufficient = 0;
let insufficient = 0;

for (const file of files) {
  try {
    const fundData = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
    const navHistory = fundData.data;
    if (navHistory && navHistory.length > 0) {
      const returns = getMonthlyReturns(navHistory, 3);
      if (Object.keys(returns).length >= 36) {
        sufficient++;
      } else {
        insufficient++;
      }
    } else {
      insufficient++;
    }
  } catch(e) {}
}

console.log(`Sufficient: ${sufficient}, Insufficient: ${insufficient}`);
