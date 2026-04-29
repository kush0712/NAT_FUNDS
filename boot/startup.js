'use strict';
/**
 * boot/startup.js
 *
 * Application boot sequence.
 * Initialises all external data sources (TER, AUM, TRI, risk-free rate),
 * fetches historical NAVs, calculates fund metrics, and marks the server ready.
 *
 * Entry point: boot()   (called from server.js after app.listen())
 */


const logger = require('../shared/logger');

const { parseAMFINav, selectTopFunds }                                       = require('../services/amfiParser');
const { fetchSchemeNav, batchFetchNavs, saveProcessedData, loadProcessedData,
        fetchSchemeNav: fetchSchemeNavAlias }                                 = require('../services/dataFetcher');
const { calculateAllMetrics, parseNavDate, recomputeRiskLevels, recomputeConsistencyScores } = require('../services/metricsCalculator');
const { initTER, syncTER, getTERCount, scheduleTERCron }                     = require('../services/terService');
const { initFundPerformance, syncAUM, getBenchmarkByName, getAUMByName, getRiskometerByName,
        getBenchmarkCount, getIRCount, getRiskometerCount, scheduleAUMCron,
        getAUMCount }                                                         = require('../services/fundPerformanceService');
const { initTRI, syncTRI, getTRIHistory, getTRICount, loadTRI, saveTRI,
        setTRIBenchmarksForCron, scheduleTRICron }                           = require('../services/triService');
const { initRiskFreeRate, getRiskFreeRateMeta }                              = require('../services/riskFreeRate');

const state = require('../shared/appState');

const {
  applyTER,
  applyAUMandBenchmark,
  applyIR,
  applyRiskometer,
  printBootReconciliationReport,
} = require('./dataHelpers');

// ─── Subcategory → proxy benchmark (used when a fund's declared benchmark
//     has no TRI data, e.g. composite/foreign indices).
//     Mirrors Tickertape's category-level fallback approach. ────────────────
const SUBCATEGORY_PROXY_BENCHMARK = {
  // Equity
  'Large Cap':          'NIFTY 100 TRI',
  'Large & Mid Cap':    'NIFTY LARGEMIDCAP 250 TRI',
  'Mid Cap':            'NIFTY MIDCAP 150 TRI',
  'Small Cap':          'NIFTY SMALLCAP 250 TRI',
  'Multi Cap':          'NIFTY 500 MULTICAP 50:25:25 TRI',
  'Flexi Cap':          'NIFTY 500 TRI',
  'ELSS':               'NIFTY 500 TRI',
  'Dividend Yield':     'NIFTY DIVIDEND OPPORTUNITIES 50 TRI',
  'Value Fund':         'NIFTY 500 VALUE 50 TRI',
  'Contra Fund':        'NIFTY 500 TRI',
  'Focused Fund':       'NIFTY 500 TRI',
  'Sectoral/Thematic':  'NIFTY 500 TRI',
  // Hybrid
  'Aggressive Hybrid':        'NIFTY 50 HYBRID COMPOSITE DEBT 65:35 INDEX TRI',
  'Balanced Advantage':       'NIFTY 50 HYBRID COMPOSITE DEBT 50:50 INDEX TRI',
  'Dynamic Asset Allocation': 'NIFTY 50 HYBRID COMPOSITE DEBT 50:50 INDEX TRI',
  'Conservative Hybrid':      'NIFTY 50 HYBRID COMPOSITE DEBT 25:75 INDEX TRI',
  'Arbitrage':                'NIFTY 50 ARBITRAGE TRI',
  'Equity Savings':           'NIFTY EQUITY SAVINGS TRI',
  'Multi Asset Allocation':   'NIFTY 500 TRI',
  // Index / ETF (broad fallback)
  'Index Fund': 'NIFTY 50 TRI',
  'ETF':        'NIFTY 50 TRI',
};

// ─── Boot sequence ───────────────────────────────────────────────────────────

async function boot() {
  logger.info('╔═══════════════════════════════════════════╗');
  logger.info('║        NAT funds — Fund Analytics         ║');
  logger.info('╚═══════════════════════════════════════════╝');

  // ── Risk-free rate (91-day T-bill, weekly cache) ──────────────────────────
  await initRiskFreeRate();
  const rfMeta = getRiskFreeRateMeta();
  logger.info(`[Boot] Risk-free rate: ${rfMeta.ratePercent}% (${rfMeta.source}, cached ${rfMeta.cachedAt})`);

  // ── TER index ─────────────────────────────────────────────────────────────
  await initTER();
  scheduleTERCron();

  // ── Fund Performance (daily AUM + per-fund benchmarks + IR + Riskometer) ──
  await initFundPerformance();

  // Schedule daily AUM + Riskometer cron — callback re-applies fresh data to
  // the in-memory fund list so consumers get updated values without a restart.
  scheduleAUMCron(() => {
    let riskometerPatched = 0;
    for (const f of state.allFunds) {
      const aum = getAUMByName(f.schemeName);
      if (aum !== null && aum !== undefined) f.aum = aum;
      const riskometer = getRiskometerByName(f.schemeName);
      if (riskometer) {
        f.riskLevel = riskometer;
        f._amfiRiskometer = true;
        riskometerPatched++;
      }
    }
    logger.info(`[Boot] Cron: re-applied riskometer to ${riskometerPatched} funds in memory`);
  });

  logger.info(`[Boot] Fund Performance: AUM=${getAUMCount()} schemes, Benchmarks=${getBenchmarkCount()} funds, IR=${getIRCount()} funds, Riskometer=${getRiskometerCount()} funds`);

  // ── Check for cached processed data (24h TTL) ─────────────────────────────
  const cachedData = loadProcessedData(24);
  if (cachedData) {
    state.allFunds       = cachedData.funds;
    state.categorySummary = cachedData.categories;

    state.fundsByCode = {};
    for (const f of state.allFunds) {
      applyTER(f);
      applyAUMandBenchmark(f);
      applyIR(f);
      applyRiskometer(f);
      state.fundsByCode[f.schemeCode] = f;
    }

    // Load TRI from disk cache immediately (non-blocking)
    const benchmarkNames = [...new Set(state.allFunds.map(f => f.benchmarkName).filter(Boolean))];
    setTRIBenchmarksForCron(benchmarkNames);
    scheduleTRICron();

    // loadTRI is imported at the top of this file
    loadTRI();
    for (const f of state.allFunds) {
      if (f.benchmarkName) {
        const tri = getTRIHistory(f.benchmarkName);
        if (tri) state.fundBenchmarkTRIs[f.schemeCode] = tri;
      }
    }
    logger.info(`[Boot] TRI from cache: ${getTRICount()} indices. Funds with TRI: ${Object.keys(state.fundBenchmarkTRIs).length}`);

    state.dataReady = true;
    state.loadingProgress = { phase: 'complete', completed: state.allFunds.length, total: state.allFunds.length, cached: state.allFunds.length };
    logger.info(`[Boot] Loaded ${state.allFunds.length} funds from disk cache. Server ready!`);

    printBootReconciliationReport(state.allFunds);

    // Background: fetch any missing TRI indices
    const missing = benchmarkNames.filter(b => !getTRIHistory(b));

    /**
     * Recompute beta/alpha for all equity funds that now have TRI data.
     * Reads NAV from the per-scheme disk cache — no network calls.
     */
    async function recomputeTRIMetrics() {
      // fetchSchemeNav is imported at the top of this file (used as fetchSchemeNav below)
      let recomputed = 0;
      const fundsNeedingRecompute = state.allFunds.filter(f =>
        (f.beta === 'Insufficient Data' || f.beta === null) &&
        ['Equity', 'Index', 'ETF'].includes(f.type) &&
        state.fundBenchmarkTRIs[f.schemeCode]
      );
      logger.info(`[Boot] Recomputing TRI metrics for ${fundsNeedingRecompute.length} equity funds...`);
      for (const fund of fundsNeedingRecompute) {
        try {
          const navData = await fetchSchemeNav(fund.schemeCode);
          if (!navData || !navData.data || navData.data.length <= 30) continue;
          const fundTRI = state.fundBenchmarkTRIs[fund.schemeCode];
          const metrics = calculateAllMetrics(navData.data, fund.type, fund.optionType || 'Growth', fundTRI);
          Object.assign(fund, metrics);
          if (fund._amfiRiskometer && fund._amfiRiskometer !== false) {
            const officialRisk = getRiskometerByName(fund.schemeName);
            if (officialRisk) fund.riskLevel = officialRisk;
          }
          delete fund._needsTRIRecompute;
          recomputed++;
        } catch (err) {
          logger.warn(`[Metrics] Non-fatal skip: ${fund.schemeCode} — ${err.message}`);
        }
      }
      if (recomputed > 0) {
        recomputeRiskLevels(state.allFunds);
        recomputeConsistencyScores(state.allFunds);
        saveProcessedData(state.allFunds, state.categorySummary);
        logger.info(`[Boot] TRI metrics recomputed for ${recomputed} funds and saved to cache`);
      }
    }

    /**
     * Recompute stale volatility metrics (Sharpe, Sortino, StdDev) for funds
     * where the disk cache still contains 'Insufficient Data' but the fund has
     * a valid cagr1y, or where the new cagrSinceInception field is missing.
     * No network calls — reads only from per-scheme disk cache.
     */
    async function recomputeStaleVolatilityMetrics() {
      // fetchSchemeNav is imported at the top of this file (used as fetchSchemeNav below)
      const stale = state.allFunds.filter(f =>
        (f.cagr1y !== null && (
          f.standardDeviation === 'Insufficient Data' ||
          f.sharpeRatio       === 'Insufficient Data'
        )) ||
        f.cagrSinceInception === undefined
      );

      if (stale.length === 0) {
        logger.info('[Boot] Volatility metrics: all funds up-to-date, no recompute needed.');
        return;
      }

      logger.info(`[Boot] Recomputing volatility metrics for ${stale.length} stale funds (background)...`);
      let recomputed = 0;
      for (const fund of stale) {
        try {
          const navData = await fetchSchemeNav(fund.schemeCode);
          if (!navData || !navData.data || navData.data.length <= 30) continue;
          const fundTRI = state.fundBenchmarkTRIs[fund.schemeCode] || null;
          const metrics = calculateAllMetrics(navData.data, fund.type, fund.optionType || 'Growth', fundTRI);
          Object.assign(fund, metrics);
          if (fund._amfiRiskometer && fund._amfiRiskometer !== false) {
            const officialRisk = getRiskometerByName(fund.schemeName);
            if (officialRisk) fund.riskLevel = officialRisk;
          }
          recomputed++;
        } catch (err) {
          logger.warn(`[Metrics] Non-fatal skip: ${fund.schemeCode} — ${err.message}`);
        }
      }
      if (recomputed > 0) {
        recomputeRiskLevels(state.allFunds);
        recomputeConsistencyScores(state.allFunds);
        saveProcessedData(state.allFunds, state.categorySummary);
        logger.info(`[Boot] Volatility recompute complete: ${recomputed}/${stale.length} funds updated and saved.`);
      }
    }

    if (missing.length > 0) {
      logger.info(`[Boot] Background TRI fetch for ${missing.length} missing indices...`);
      syncTRI(missing).then(async count => {
        if (count > 0) {
          // saveTRI is imported at the top of this file
          saveTRI();
          for (const f of state.allFunds) {
            if (f.benchmarkName && !state.fundBenchmarkTRIs[f.schemeCode]) {
              const tri = getTRIHistory(f.benchmarkName);
              if (tri) state.fundBenchmarkTRIs[f.schemeCode] = tri;
            }
          }
          logger.info(`[Boot] Background TRI complete: ${count} new indices fetched`);
          await recomputeTRIMetrics();
        }
      }).catch(err => logger.error('[Boot] Background TRI error:', err.message));
    } else {
      const needsRecompute = state.allFunds.some(f =>
        (f.beta === 'Insufficient Data' || f.beta === null) &&
        ['Equity', 'Index', 'ETF'].includes(f.type) &&
        state.fundBenchmarkTRIs[f.schemeCode]
      );
      if (needsRecompute) {
        logger.info(`[Boot] TRI available but metrics stale — recomputing...`);
        recomputeTRIMetrics().catch(err => logger.error('[Boot] Recompute error:', err.message));
      }
    }

    recomputeStaleVolatilityMetrics().catch(err => logger.error('[Boot] Volatility recompute error:', err.message));
    return;
  }

  // ── Phase 1: Parse AMFI NAV ───────────────────────────────────────────────
  state.loadingProgress = { phase: 'parsing', completed: 0, total: 0, cached: 0 };
  const { funds: rawFunds, categories } = await parseAMFINav();
  state.categorySummary = categories;

  // ── Phase 2: Make ALL funds available instantly ───────────────────────────
  state.allFunds = rawFunds;
  state.fundsByCode = {};
  for (const f of state.allFunds) {
    state.fundsByCode[f.schemeCode] = f;
    applyTER(f);
    applyAUMandBenchmark(f);
    applyIR(f);
    applyRiskometer(f);
  }
  logger.info(`[Boot] TER applied (${getTERCount()} schemes). AUM+Benchmarks+IR applied (${getAUMCount()} schemes).`);
  state.dataReady = true;

  const selectedFunds = selectTopFunds(rawFunds, 3000);
  logger.info(`[Boot] Selected ${selectedFunds.length} key schemes for upfront metrics processing.`);

  // ── Phase 3: Load TRI from disk cache; fetch missing in background ─────────
  const allBenchmarkNames = [...new Set(state.allFunds.map(f => f.benchmarkName).filter(Boolean))];
  logger.info(`[Boot] ${allBenchmarkNames.length} unique benchmarks across ${state.allFunds.length} funds`);
  setTRIBenchmarksForCron(allBenchmarkNames);
  scheduleTRICron();

  // loadTRI is imported at the top of this file
  loadTRI();
  for (const f of state.allFunds) {
    if (f.benchmarkName) {
      const tri = getTRIHistory(f.benchmarkName);
      if (tri) state.fundBenchmarkTRIs[f.schemeCode] = tri;
    }
  }
  logger.info(`[Boot] TRI from cache: ${getTRICount()} indices. Proceeding to fetch NAVs...`);

  // Assign proxy TRI to equity/hybrid funds whose declared benchmark has no TRI data.
  let proxyCount = 0;
  for (const f of state.allFunds) {
    if (state.fundBenchmarkTRIs[f.schemeCode]) continue;
    if (!['Equity', 'Hybrid', 'Index', 'ETF'].includes(f.type)) continue;
    const proxyName = SUBCATEGORY_PROXY_BENCHMARK[f.subCategory];
    if (!proxyName) continue;
    const proxyTRI = getTRIHistory(proxyName);
    if (!proxyTRI) continue;
    state.fundBenchmarkTRIs[f.schemeCode] = proxyTRI;
    f.benchmarkIsProxy = true;
    f.benchmarkProxyName = proxyName;
    proxyCount++;
  }
  if (proxyCount > 0) logger.info(`[Boot] Proxy TRI: ${proxyCount} equity/hybrid funds now use subcategory fallback benchmark`);

  printBootReconciliationReport(state.allFunds);

  // Background: fetch missing TRI indices (non-blocking)
  const missingBenches = allBenchmarkNames.filter(b => !getTRIHistory(b));
  if (missingBenches.length > 0) {
    logger.info(`[Boot] Background TRI fetch for ${missingBenches.length} indices...`);
    syncTRI(missingBenches).then(count => {
      if (count > 0) {
        // saveTRI is imported at the top of this file
        saveTRI();
        for (const f of state.allFunds) {
          if (f.benchmarkName && !state.fundBenchmarkTRIs[f.schemeCode]) {
            const tri = getTRIHistory(f.benchmarkName);
            if (tri) state.fundBenchmarkTRIs[f.schemeCode] = tri;
          }
        }
        logger.info(`[Boot] Background TRI complete: ${count} indices fetched`);
      }
    }).catch(err => logger.error('[Boot] Background TRI error:', err.message));
  }

  // ── Phase 4: Batch fetch historical NAVs ─────────────────────────────────
  state.loadingProgress = { phase: 'fetching', completed: 0, total: selectedFunds.length, cached: 0 };

  const schemeCodes = selectedFunds.map(f => f.schemeCode);
  const navDataMap = await batchFetchNavs(schemeCodes, (completed, total, cached) => {
    state.loadingProgress = { phase: 'fetching', completed, total, cached };
    if (completed % 50 === 0 || completed === total) {
      logger.info(`[Boot] Progress: ${completed}/${total} (${cached} from cache)`);
    }
  }, 200);

  // ── Phase 5: Calculate metrics ────────────────────────────────────────────
  state.loadingProgress = { phase: 'calculating', completed: 0, total: selectedFunds.length, cached: 0 };
  logger.info('[Boot] Calculating metrics...');

  let metricsCompleted = 0;
  for (const fund of selectedFunds) {
    const navData = navDataMap[fund.schemeCode];
    if (navData && navData.data && navData.data.length > 30) {
      const fundTRI = (() => {
        const benchName = fund.benchmarkName;
        if (!benchName) return null;
        const tri = getTRIHistory(benchName);
        if (tri) {
          state.fundBenchmarkTRIs[fund.schemeCode] = tri;
          return tri;
        }
        return null;
      })();

      const metrics = calculateAllMetrics(
        navData.data,
        fund.type,
        fund.optionType || 'Growth',
        fundTRI
      );
      Object.assign(fund, metrics);

      // Re-apply AMFI riskometer — calculateAllMetrics sets a calculated riskLevel
      // which would overwrite the official AMFI label without this guard.
      if (fund._amfiRiskometer) {
        const officialRisk = getRiskometerByName(fund.schemeName);
        if (officialRisk) fund.riskLevel = officialRisk;
      }

      if (navData.meta) {
        if (navData.meta.fund_house) fund.amc = navData.meta.fund_house;
        if (navData.meta.scheme_category) fund.schemeCategory = navData.meta.scheme_category;
      }

      if (navData.data.length > 0) {
        const latestMfDateStr = navData.data[0].date;
        const currentFundDate = parseNavDate(fund.date);
        const newMfDate = parseNavDate(latestMfDateStr);
        if (newMfDate && currentFundDate && newMfDate > currentFundDate) {
          fund.nav = parseFloat(navData.data[0].nav);
          fund.date = latestMfDateStr;
        }
      }
    }
    metricsCompleted++;
    if (metricsCompleted % 100 === 0) {
      logger.info(`[Boot] Metrics: ${metricsCompleted}/${selectedFunds.length}`);
    }
  }

  // Recompute risk levels using within-category percentile ranking.
  recomputeRiskLevels(state.allFunds);

  // Compute Consistency Scores within each sub-category.
  recomputeConsistencyScores(state.allFunds);

  // Rebuild indexes
  state.fundsByCode = {};
  for (const f of state.allFunds) {
    state.fundsByCode[f.schemeCode] = f;
  }

  state.categorySummary = {};
  for (const fund of state.allFunds) {
    const key = fund.type;
    if (!state.categorySummary[key]) {
      state.categorySummary[key] = { count: 0, subCategories: {} };
    }
    state.categorySummary[key].count++;
    if (!state.categorySummary[key].subCategories[fund.subCategory]) {
      state.categorySummary[key].subCategories[fund.subCategory] = 0;
    }
    state.categorySummary[key].subCategories[fund.subCategory]++;
  }

  saveProcessedData(state.allFunds, state.categorySummary);

  state.loadingProgress = { phase: 'complete', completed: state.allFunds.length, total: state.allFunds.length, cached: 0 };
  logger.info(`[Boot] ✓ All done! ${state.allFunds.length} funds with metrics ready.`);
}

module.exports = { boot };
