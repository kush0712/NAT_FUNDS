const { getMonthlyReturns } = require('./services/metricsCalculator.js');
const { fetchSchemeNav, CATEGORY_BENCHMARK_MAP } = require('./services/dataFetcher.js');

async function checkBenchmarks() {
  const codes = [...new Set(Object.values(CATEGORY_BENCHMARK_MAP))];
  for (const code of codes) {
    const data = await fetchSchemeNav(code);
    if (data && data.data) {
      const returns = getMonthlyReturns(data.data, 3);
      console.log(`Code ${code} - Nav history: ${data.data.length}, Monthly Returns length: ${Object.keys(returns).length}`);
    } else {
      console.log(`Code ${code} - Failed to fetch`);
    }
  }
}
checkBenchmarks();
