const { getMonthlyReturns } = require('./services/metricsCalculator.js');
const { fetchBenchmarkNav } = require('./services/dataFetcher.js');

async function run() {
  const benchData = await fetchBenchmarkNav();
  if (benchData && benchData.data) {
    console.log("Benchmark NAV history length:", benchData.data.length);
    const benchReturnsDict = getMonthlyReturns(benchData.data, 3);
    console.log("Benchmark Returns length:", Object.keys(benchReturnsDict).length);
  } else {
    console.log("Could not fetch benchmark data");
  }
}
run();
