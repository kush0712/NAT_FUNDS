const fs = require('fs');
const { calculateAllMetrics } = require('./services/metricsCalculator.js');
const { fetchBenchmarkNav, fetchSchemeNav, CATEGORY_BENCHMARK_MAP } = require('./services/dataFetcher.js');

async function testBeta() {
  const funds = JSON.parse(fs.readFileSync('cache/processed_funds.json.bak', 'utf8')).funds;
  const equityFunds = funds.filter(f => f.type === 'Equity');

  const benchmarkData = await fetchBenchmarkNav();
  
  const categoryBenchmarkNavs = {};
  const uniqueBenchCodes = [...new Set(Object.values(CATEGORY_BENCHMARK_MAP))];
  for (const code of uniqueBenchCodes) {
    const data = await fetchSchemeNav(code);
    if (data && data.data) {
      categoryBenchmarkNavs[code] = data.data;
    }
  }

  let present = 0, insufficient = 0, missingBench = 0;
  let totalProcessable = 0;

  for (let i = 0; i < equityFunds.length; i++) {
    const fund = equityFunds[i];
    let navData;
    try {
        navData = JSON.parse(fs.readFileSync(`cache/nav_${fund.schemeCode}.json`, 'utf8'));
    } catch(e) { continue; }
    
    totalProcessable++;

    const benchCode = CATEGORY_BENCHMARK_MAP[fund.subCategory];
    const catBenchNav = benchCode ? categoryBenchmarkNavs[benchCode] : null;

    const metrics = calculateAllMetrics(
        navData.data,
        fund.type,
        benchmarkData ? benchmarkData.data : null,
        fund.optionType || 'Growth',
        catBenchNav
    );
    if (metrics.beta === "Insufficient Data") insufficient++;
    else if (metrics.beta !== null) present++; 
    else missingBench++;

  }
  
  console.log(`Out of ${totalProcessable} processable equity funds: Insufficient=${insufficient}, Present=${present}, MissingBench=${missingBench}`);
}
testBeta();
