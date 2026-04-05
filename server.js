/**
 * NAT funds — Express Server
 * Serves the SPA frontend and provides REST API for fund data.
 */

const express = require('express');
const path = require('path');
const { parseAMFINav, selectTopFunds } = require('./services/amfiParser');
const { fetchSchemeNav, batchFetchNavs, saveProcessedData, loadProcessedData } = require('./services/dataFetcher');
const { calculateAllMetrics, parseNavDate, recomputeRiskLevels, recomputeConsistencyScores } = require('./services/metricsCalculator');
const { initTER, syncTER, getTERByName, getTERCount, getTERDate, getTERMissCount, scheduleTERCron } = require('./services/terService');
const { initAUM, getAUMCount, getAUMPeriod, scheduleAUMCron, normaliseName } = require('./services/aumService');
const { initFundPerformance, syncAUM, getBenchmarkByName, getAUMByName, getIRByName, getRiskometerByName, getBenchmarkIndex, getBenchmarkCount, getIRCount, getRiskometerCount, scheduleFundPerformanceCron } = require('./services/fundPerformanceService');
const { initTRI, syncTRI, getTRIHistory, getTRICount, classifyBenchmark, setTRIBenchmarksForCron, scheduleTRICron } = require('./services/triService');
const { initRiskFreeRate, getRiskFreeRateMeta } = require('./services/riskFreeRate');

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory data store
let allFunds = [];
let fundsByCode = {};
let categorySummary = {};
let dataReady = false;
let loadingProgress = { phase: 'init', completed: 0, total: 0, cached: 0 };
// fundBenchmarkTRIs: schemeCode → TRI series array (from triService)
// Populated at boot; used for per-fund metrics calculation
let fundBenchmarkTRIs = {}; // schemeCode → [{date: Date, nav: number}]

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// CORS for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// ─── API Routes ─────────────────────────────────────────────

/**
 * GET /api/status
 */
app.get('/api/status', (req, res) => {
  res.json({
    ready: dataReady,
    progress: loadingProgress,
    fundCount: allFunds.length,
  });
});

/**
 * GET /api/categories
 */
app.get('/api/categories', (req, res) => {
  const { planType, optionType } = req.query;

  // If no filters requested, return full summary
  if (!planType && !optionType) {
    return res.json(categorySummary);
  }

  // Build a filtered summary that only counts funds matching the filters
  const filtered = {};
  for (const fund of allFunds) {
    if (planType && fund.planType !== planType) continue;
    if (optionType && fund.optionType !== optionType) continue;

    const key = fund.type;
    if (!filtered[key]) filtered[key] = { count: 0, subCategories: {} };
    filtered[key].count++;
    if (!filtered[key].subCategories[fund.subCategory]) {
      filtered[key].subCategories[fund.subCategory] = 0;
    }
    filtered[key].subCategories[fund.subCategory]++;
  }

  res.json(filtered);
});

/**
 * GET /api/funds
 * List funds with filtering, sorting, pagination
 */
app.get('/api/funds', async (req, res) => {
  let funds = [...allFunds];

  const { type, subCategory, planType, optionType, sortBy, order, page, limit, search, marketCap } = req.query;

  if (type) {
    funds = funds.filter(f => f.type === type);
  }
  if (subCategory) {
    const subs = subCategory.split(',');
    funds = funds.filter(f => subs.includes(f.subCategory));
  }
  if (planType) {
    funds = funds.filter(f => f.planType === planType);
  }
  if (optionType) {
    funds = funds.filter(f => f.optionType === optionType);
  }
  // Market cap filter — maps to sub-category for Equity type
  if (marketCap) {
    const caps = marketCap.split(',');
    funds = funds.filter(f => caps.includes(f.subCategory));
  }
  if (search) {
    const q = search.toLowerCase();
    funds = funds.filter(f =>
      f.schemeName.toLowerCase().includes(q) ||
      f.amc.toLowerCase().includes(q)
    );
  }

  // Sorting
  const sortField = sortBy || 'schemeName';
  const sortOrder = order === 'desc' ? -1 : 1;

  funds.sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    // For rolling returns (object with avg), sort by avg
    if (aVal && typeof aVal === 'object' && aVal.avg !== undefined) aVal = aVal.avg;
    if (bVal && typeof bVal === 'object' && bVal.avg !== undefined) bVal = bVal.avg;

    // Treat 'Insufficient Data' as null so it drops to the bottom of the rankings
    if (aVal === 'Insufficient Data') aVal = null;
    if (bVal === 'Insufficient Data') bVal = null;

    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    if (typeof aVal === 'string') {
      return aVal.localeCompare(bVal) * sortOrder;
    }
    return (aVal - bVal) * sortOrder;
  });

  // Pagination
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const totalCount = funds.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const start = (pageNum - 1) * pageSize;
  const paginated = funds.slice(start, start + pageSize);

  // Lazy evaluate metrics for paginated items if missing
  const evalPromises = paginated.map(async (fund) => {
    if (fund.cagr1y !== null || typeof fund.standardDeviation === 'string' || typeof fund.standardDeviation === 'number') {
      return; 
    }
    try {
      const navData = await fetchSchemeNav(fund.schemeCode);
      if (navData && navData.data && navData.data.length > 30) {
        const fundTRI = fundBenchmarkTRIs[fund.schemeCode] || (fund.benchmarkName ? getTRIHistory(fund.benchmarkName) : null);
        if (fundTRI && !fundBenchmarkTRIs[fund.schemeCode]) {
          fundBenchmarkTRIs[fund.schemeCode] = fundTRI; // cache locally
        }
        const metrics = calculateAllMetrics(
          navData.data,
          fund.type,
          fund.optionType || 'Growth',
          fundTRI
        );
        Object.assign(fund, metrics);
      } else if (navData && navData.data) {
         fund.standardDeviation = "Insufficient Data";
         fund.beta = "Insufficient Data";
         fund.sharpeRatio = "Insufficient Data";
      }
    } catch(err) {}
  });
  await Promise.all(evalPromises);

  res.json({
    funds: paginated,
    pagination: {
      page: pageNum,
      limit: pageSize,
      totalCount,
      totalPages,
    },
  });
});

/**
 * GET /api/fund/:schemeCode
 * Single fund detail
 */
app.get('/api/fund/:schemeCode', async (req, res) => {
  const fund = fundsByCode[req.params.schemeCode];
  if (!fund) {
    return res.status(404).json({ error: 'Fund not found' });
  }

  // Fetch live nav history (uses 24h disk cache internally)
  try {
    const navData = await fetchSchemeNav(fund.schemeCode);
    if (navData && navData.data && navData.data.length > 0) {
      // Always sync with the latest date available from the history API if it's newer
      const latestMfDateStr = navData.data[0].date;
      const currentFundDate = parseNavDate(fund.date);
      const newMfDate = parseNavDate(latestMfDateStr);
      if (newMfDate && currentFundDate && newMfDate > currentFundDate) {
        fund.nav = parseFloat(navData.data[0].nav);
        fund.date = latestMfDateStr;
      }

      // Calculate metrics on-the-fly if:
      //  (a) never calculated before, OR
      //  (b) new metrics (maxDrawdown, sortinoRatio) are missing, OR
      //  (c) flagged for TRI recompute (TRI was missing at boot but now available)
      const needsFullCalc = (fund.cagr1y === null && fund.cagr3y === null) ||
                            (navData.data.length > 30 && fund.maxDrawdown === undefined) ||
                            (fund._needsTRIRecompute === true && fundBenchmarkTRIs[fund.schemeCode]);

      if (needsFullCalc && navData.data.length > 30) {
        // Use per-fund TRI benchmark (same as boot-time calculation)
        const fundTRI = fundBenchmarkTRIs[fund.schemeCode] || null;
        const metrics = calculateAllMetrics(
          navData.data,
          fund.type,
          fund.optionType || 'Growth',
          fundTRI                      // real TRI for this fund's declared benchmark
        );
        Object.assign(fund, metrics);
        delete fund._needsTRIRecompute; // clear flag once computed

        // Compute consistency score with peers
        const peers = allFunds.filter(f => f.subCategory === fund.subCategory);
        if (peers.length > 0) {
          const { computeConsistencyScoreForFund } = require('./services/metricsCalculator');
          fund.consistencyScore = computeConsistencyScoreForFund(fund, peers);
        }

        if (navData.meta) {
          if (navData.meta.fund_house) fund.amc = navData.meta.fund_house;
          if (navData.meta.scheme_category) fund.schemeCategory = navData.meta.scheme_category;
        }
      }
    }
  } catch (err) {
    console.error(`Error processing live data for ${fund.schemeCode}`, err);
  }

  res.json(fund);
});


/**
 * GET /api/fund/:schemeCode/nav-history
 * Returns sampled monthly NAV data for charting
 * Query: period=1y|3y|5y|max (default 5y)
 */
app.get('/api/fund/:schemeCode/nav-history', async (req, res) => {
  const fund = fundsByCode[req.params.schemeCode];
  if (!fund) {
    return res.status(404).json({ error: 'Fund not found' });
  }

  try {
    const navData = await fetchSchemeNav(fund.schemeCode);
    if (!navData || !navData.data || navData.data.length === 0) {
      return res.json({ data: [] });
    }

    // Parse period
    const period = req.query.period || '5y';
    const periodYears = period === '1y' ? 1 : period === '3y' ? 3 : period === 'max' ? 100 : 5;

    // Parse, sort oldest-first, filter by period
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - periodYears);

    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split('-');
      if (parts.length !== 3) return null;
      const day = parseInt(parts[0]);
      let month;
      if (isNaN(parseInt(parts[1]))) {
        const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        month = months[parts[1]];
        if (month === undefined) return null;
      } else {
        month = parseInt(parts[1]) - 1;
      }
      return new Date(parseInt(parts[2]), month, day);
    };

    const parsed = navData.data
      .map(d => ({ date: parseDate(d.date), nav: parseFloat(d.nav), dateStr: d.date }))
      .filter(d => d.date && !isNaN(d.nav) && d.nav > 0 && d.date >= cutoff)
      .sort((a, b) => a.date - b.date);

    // Sample to ~200 data points for smooth charting
    const maxPoints = 200;
    let sampled;
    if (parsed.length <= maxPoints) {
      sampled = parsed;
    } else {
      const step = Math.floor(parsed.length / maxPoints);
      sampled = [];
      for (let i = 0; i < parsed.length; i += step) {
        sampled.push(parsed[i]);
      }
      // Always include the last point
      if (sampled[sampled.length - 1] !== parsed[parsed.length - 1]) {
        sampled.push(parsed[parsed.length - 1]);
      }
    }

    res.json({
      data: sampled.map(d => ({
        date: d.date.toISOString().split('T')[0],
        nav: d.nav,
      })),
      meta: navData.meta || {},
    });
  } catch (err) {
    console.error(`Error fetching nav history for ${fund.schemeCode}`, err);
    res.status(500).json({ error: 'Failed to fetch NAV history' });
  }
});

/**
 * GET /api/compare
 * Compare multiple funds side-by-side
 */
app.get('/api/compare', async (req, res) => {
  const codes = (req.query.codes || '').split(',').filter(Boolean);
  if (codes.length < 2 || codes.length > 4) {
    return res.status(400).json({ error: 'Provide 2-4 scheme codes separated by commas' });
  }

  const funds = codes.map(code => fundsByCode[code]).filter(Boolean);
  if (funds.length < 2) {
    return res.status(404).json({ error: 'Not enough valid funds found' });
  }

  // Sync date and calculate metrics on-the-fly if missing
  for (const fund of funds) {
    try {
      const navData = await fetchSchemeNav(fund.schemeCode);
      if (navData && navData.data && navData.data.length > 0) {
        // Sync with the latest history date if newer
        const latestMfDateStr = navData.data[0].date;
        const currentFundDate = parseNavDate(fund.date);
        const newMfDate = parseNavDate(latestMfDateStr);
        if (newMfDate && currentFundDate && newMfDate > currentFundDate) {
          fund.nav = parseFloat(navData.data[0].nav);
          fund.date = latestMfDateStr;
        }

        const needsCalc = (fund.cagr1y === null && fund.cagr3y === null) ||
                          (navData.data.length > 30 && (
                            fund.maxDrawdown === undefined ||
                            fund.sortinoRatio === undefined ||
                            fund.calmarRatio === undefined ||
                            fund.jensensAlpha === undefined ||
                            fund.upsideCapture === undefined ||
                            fund.downsideCapture === undefined ||
                            fund.informationRatio === undefined ||
                            fund.consistencyScore === undefined
                          ));
        if (needsCalc && navData.data.length > 30) {
          // Use per-fund TRI benchmark for this fund
          const fundTRI = fundBenchmarkTRIs[fund.schemeCode] || null;
          const metrics = calculateAllMetrics(
            navData.data,
            fund.type,
            fund.optionType || 'Growth',
            fundTRI                    // real TRI for this fund's declared benchmark
          );
          const prevConsistencyScore = fund.consistencyScore; // preserve if already computed
          Object.assign(fund, metrics);
          // Restore pre-existing consistencyScore if the recalc didn't set one
          // (recomputeConsistencyScores runs peer-relative at boot; calculateAllMetrics doesn't set it)
          if (fund.consistencyScore === undefined && prevConsistencyScore !== undefined) {
            fund.consistencyScore = prevConsistencyScore;
          }
          // If still missing, compute it now using peers from allFunds
          if (fund.consistencyScore === undefined || fund.consistencyScore === null) {
            const peers = allFunds.filter(f => f.subCategory === fund.subCategory);
            if (peers.length > 0) {
              const { computeConsistencyScoreForFund } = require('./services/metricsCalculator');
              fund.consistencyScore = computeConsistencyScoreForFund(fund, peers);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error processing live data for ${fund.schemeCode} in compare`, err);
    }
  }

  const types = [...new Set(funds.map(f => f.type))];
  const subCats = [...new Set(funds.map(f => f.subCategory))];

  let warning = null;
  if (types.length > 1) {
    warning = `Comparing funds across different categories (${types.join(', ')}). Results may not be directly comparable.`;
  } else if (subCats.length > 1) {
    warning = `Comparing funds across sub-categories (${subCats.join(', ')}). Consider comparing within the same category for best results.`;
  }

  res.json({ funds, warning });
});

/**
 * GET /api/search
 */
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (q.length < 2) {
    return res.json({ results: [] });
  }

  const results = allFunds
    .filter(f => f.schemeName.toLowerCase().includes(q) || f.amc.toLowerCase().includes(q))
    .slice(0, 20)
    .map(f => ({
      schemeCode: f.schemeCode,
      schemeName: f.schemeName,
      type: f.type,
      subCategory: f.subCategory,
      planType: f.planType,
      optionType: f.optionType,
      nav: f.nav,
    }));

  res.json({ results });
});

// ─── TER Endpoints ──────────────────────────────────────────

/**
 * GET /ter/:schemeCode
 * Return AMFI-published TER for a scheme (O(1) lookup via funds code map).
 * Response: { nsdl_code, scheme_name, date, direct_ter, regular_ter }
 * 404 if scheme not found in TER index.
 */
app.get('/ter/:schemeCode', (req, res) => {
  const fund = fundsByCode[req.params.schemeCode];
  if (!fund) {
    return res.status(404).json({
      error: `Invalid scheme code: ${req.params.schemeCode}`,
    });
  }

  const record = getTERByName(fund.schemeName);
  if (!record) {
    return res.status(404).json({
      error: `TER data not found for scheme: ${fund.schemeName}`,
    });
  }
  
  res.json(record);
});

/**
 * GET /admin/sync-ter
 * Manually trigger a full AMFI TER sync.
 * Returns { ok, schemesProcessed, date } or { ok: false, error }.
 */
app.get('/admin/sync-ter', async (req, res) => {
  console.log('[Admin] Manual TER sync triggered');
  try {
    const count = await syncTER();
    res.json({
      ok: true,
      schemesProcessed: count,
      date: getTERDate(),
      message: `TER sync complete — ${count} schemes processed`,
    });
  } catch (err) {
    console.error('[Admin] Manual TER sync failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
/**
 * GET /admin/sync-aum
 * Manually trigger a fresh AMFI daily AUM sync via Fund Performance API.
 */
app.get('/admin/sync-aum', async (req, res) => {
  console.log('[Admin] Manual AUM sync triggered (AMFI Fund Performance API)');
  try {
    const count = await syncAUM();
    // Re-apply fresh AUM and riskometer to all in-memory funds after sync
    let riskometerUpdated = 0;
    for (const f of allFunds) {
      const aum = getAUMByName(f.schemeName);
      f.aum = aum !== null ? aum : null;
      // Re-apply riskometer (synced alongside AUM from the same API call)
      const riskometer = getRiskometerByName(f.schemeName);
      if (riskometer) {
        f.riskLevel = riskometer;
        f._amfiRiskometer = true;
        riskometerUpdated++;
      }
    }
    console.log(`[Admin] Riskometer re-applied to ${riskometerUpdated} funds`);
    res.json({
      ok: true,
      schemesProcessed: count,
      riskometerUpdated,
      message: `AUM + Riskometer sync complete — ${count} schemes updated, ${riskometerUpdated} riskometers refreshed`,
    });
  } catch (err) {
    console.error('[Admin] Manual AUM sync failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /admin/sync-tri
 * Manually trigger a full TRI refresh for all benchmarks.
 */
app.get('/admin/sync-tri', async (req, res) => {
  console.log('[Admin] Manual TRI sync triggered');
  try {
    const benchmarkNames = [...new Set(allFunds.map(f => f.benchmarkName).filter(Boolean))];
    const { saveTRI } = require('./services/triService');
    const count = await syncTRI(benchmarkNames);
    saveTRI();
    // Rebuild fundBenchmarkTRIs
    for (const f of allFunds) {
      if (f.benchmarkName) {
        const tri = getTRIHistory(f.benchmarkName);
        if (tri) fundBenchmarkTRIs[f.schemeCode] = tri;
      }
    }
    res.json({
      ok: true,
      benchmarksSynced: count,
      message: `TRI sync complete — ${count} benchmark indices refreshed`,
    });
  } catch (err) {
    console.error('[Admin] Manual TRI sync failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Boot Sequence ──────────────────────────────────────────

async function boot() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║        NAT funds — Fund Analytics         ║');
  console.log('╚═══════════════════════════════════════════╝');

  // ── Initialise risk-free rate (91-day T-bill, weekly cache) ──────────────
  await initRiskFreeRate();
  const rfMeta = getRiskFreeRateMeta();
  console.log(`[Boot] Risk-free rate: ${rfMeta.ratePercent}% (${rfMeta.source}, cached ${rfMeta.cachedAt})`);

  // ── Initialise TER index ──────────────────────────────────────────────────
  await initTER();
  scheduleTERCron();

  // ── Initialise Fund Performance (daily AUM + per-fund benchmarks) ─────────
  await initFundPerformance();
  // Schedule daily AUM + Riskometer cron. The callback re-applies fresh data to
  // the in-memory fund list so consumers get updated values without a restart.
  scheduleAUMCron(() => {
    let riskometerPatched = 0;
    for (const f of allFunds) {
      // Re-apply AUM
      const aum = getAUMByName(f.schemeName);
      if (aum !== null && aum !== undefined) f.aum = aum;
      // Re-apply SEBI riskometer
      const riskometer = getRiskometerByName(f.schemeName);
      if (riskometer) {
        f.riskLevel = riskometer;
        f._amfiRiskometer = true;
        riskometerPatched++;
      }
    }
    console.log(`[Boot] Cron: re-applied riskometer to ${riskometerPatched} funds in memory`);
  });
  console.log(`[Boot] Fund Performance: AUM=${getAUMCount()} schemes, Benchmarks=${getBenchmarkCount()} funds, IR=${getIRCount()} funds, Riskometer=${getRiskometerCount()} funds`);

  // ── Boot-time reconciliation report ────────────────────────────────────────────────────────
  // Replaces ~700 per-fund warn lines with a single at-a-glance summary.
  function printBootReconciliationReport(funds) {
    const total = funds.length;
    const pct  = (n) => `${((n / total) * 100).toFixed(1)}%`;

    // TER: count how many funds NOW have a ter value set (after applyTER ran)
    const terHit  = funds.filter(f => f.ter != null).length;
    const terMiss = getTERMissCount(); // reads and resets the counter

    // AUM: how many got an AUM value
    const aumHit = funds.filter(f => f.aum != null).length;

    // Benchmark: how many have a non-null benchmarkName
    const benchHit = funds.filter(f => f.benchmarkName).length;

    // TRI benchmark breakdown
    const uniqueBenches = [...new Set(funds.map(f => f.benchmarkName).filter(Boolean))];
    let triMapped = 0, triForeign = 0, triComposite = 0, triUnknown = 0;
    for (const b of uniqueBenches) {
      const cls = classifyBenchmark(b);
      if      (cls === 'nifty' || cls === 'bse') triMapped++;
      else if (cls === 'foreign')   triForeign++;
      else if (cls === 'composite') triComposite++;
      else                          triUnknown++;
    }
    const triWithData = funds.filter(f => f.benchmarkName && getTRIHistory(f.benchmarkName)).length;

    console.log('[Boot] ── Data Coverage Report ────────────────────────────────────────────');
    console.log(`[Boot] TER    : ${terHit}/${total} funds (${pct(terHit)}) — ${terMiss} unmatched (discontinued/legacy)`);
    console.log(`[Boot] AUM    : ${aumHit}/${total} funds (${pct(aumHit)}) — ${total - aumHit} no match (plan-level not in AMFI API)`);
    console.log(`[Boot] Bench  : ${benchHit}/${total} funds (${pct(benchHit)}) have a declared benchmark`);
    console.log(`[Boot] TRI    : ${triMapped}/${uniqueBenches.length} unique benchmarks mappable — ${triForeign} foreign, ${triComposite} composite (skipped)${triUnknown ? `, ${triUnknown} unknown` : ''}`);
    console.log(`[Boot] Funds with TRI data : ${triWithData}/${benchHit} benchmarked funds`);
    console.log('[Boot] ──────────────────────────────────────────────────────────────────');
  }

  // ─── Helper: apply TER to a fund ──────────────────────────────────────────────────────────────
  function applyTER(fund) {
    const rec = getTERByName(fund.schemeName);
    if (!rec) return;
    const isDirect =
      (fund.planType || '').toLowerCase() === 'direct' ||
      (fund.schemeName || '').toLowerCase().includes('direct');
    const ter = isDirect ? rec.direct_ter : rec.regular_ter;
    if (ter !== null && ter !== undefined) fund.ter = ter;
  }

  // ── Helper: apply daily AUM + benchmark name to a fund ───────────────────
  function applyAUMandBenchmark(fund) {
    const aum = getAUMByName(fund.schemeName);
    if (aum !== null && aum !== undefined) fund.aum = aum;
    const bench = getBenchmarkByName(fund.schemeName);
    if (bench) fund.benchmarkName = bench;
  }

  // ── Helper: apply AMFI-published IR data to a fund ───────────────────────
  function applyIR(fund) {
    const ir = getIRByName(fund.schemeName);
    if (!ir) return;
    // Pick Direct or Regular based on plan type
    const isDirect = (fund.planType || '').toLowerCase() === 'direct' ||
                     (fund.schemeName || '').toLowerCase().includes('direct');
    fund.amfiIR = {
      ir1y:  isDirect ? ir.ir1yDirect  : ir.ir1yRegular,
      ir3y:  isDirect ? ir.ir3yDirect  : ir.ir3yRegular,
      ir5y:  isDirect ? ir.ir5yDirect  : ir.ir5yRegular,
      ir10y: isDirect ? ir.ir10yDirect : ir.ir10yRegular,
    };
  }

  // ── Helper: apply SEBI riskometer to a fund (authoritative source) ───────
  // Overrides any calculated riskLevel with the official AMFI-published value.
  // Falls back to null (calculated fallback runs later via recomputeRiskLevels).
  function applyRiskometer(fund) {
    const riskometer = getRiskometerByName(fund.schemeName);
    if (riskometer) {
      fund.riskLevel = riskometer;     // SEBI-mandated, daily-updated, authoritative
      fund._amfiRiskometer = true;     // Flag: preserves this value in recomputeRiskLevels
    } else {
      fund._amfiRiskometer = false;    // No AMFI data — calculated fallback allowed
    }
  }

  // Check for cached processed data first (24h TTL)
  const cachedData = loadProcessedData(24);
  if (cachedData) {
    allFunds = cachedData.funds;
    categorySummary = cachedData.categories;

    fundsByCode = {};
    for (const f of allFunds) {
      applyTER(f);
      applyAUMandBenchmark(f);
      applyIR(f);
      applyRiskometer(f);  // Apply fresh SEBI riskometer from AMFI (daily)
      fundsByCode[f.schemeCode] = f;
    }

    // Load TRI from disk cache immediately (non-blocking)
    const benchmarkNames = [...new Set(allFunds.map(f => f.benchmarkName).filter(Boolean))];
    setTRIBenchmarksForCron(benchmarkNames);
    scheduleTRICron();

    // Load whatever TRI is already cached on disk — fast, synchronous-ish
    const { loadTRI } = require('./services/triService');
    loadTRI(); // load from disk without triggering network
    for (const f of allFunds) {
      if (f.benchmarkName) {
        const tri = getTRIHistory(f.benchmarkName);
        if (tri) fundBenchmarkTRIs[f.schemeCode] = tri;
      }
    }
    console.log(`[Boot] TRI from cache: ${getTRICount()} indices. Funds with TRI: ${Object.keys(fundBenchmarkTRIs).length}`);

    dataReady = true;
    loadingProgress = { phase: 'complete', completed: allFunds.length, total: allFunds.length, cached: allFunds.length };
    console.log(`[Boot] Loaded ${allFunds.length} funds from disk cache. Server ready!`);

    // Print reconciliation report now that TER miss-counts are known
    printBootReconciliationReport(allFunds);

    // Background: fetch any missing TRI indices without blocking server
    const missing = benchmarkNames.filter(b => !getTRIHistory(b));

    /**
     * Recompute beta/alpha for all equity funds that now have TRI data.
     * Reads NAV from the per-scheme disk cache (cache/nav_*.json).
     * Non-blocking — runs after TRI is available.
     */
    async function recomputeTRIMetrics() {
      const { fetchSchemeNav: _fetchNav } = require('./services/dataFetcher');
      let recomputed = 0;
      const fundsNeedingRecompute = allFunds.filter(f =>
        (f.beta === 'Insufficient Data' || f.beta === null) &&
        ['Equity', 'Index', 'ETF'].includes(f.type) &&
        fundBenchmarkTRIs[f.schemeCode]
      );
      console.log(`[Boot] Recomputing TRI metrics for ${fundsNeedingRecompute.length} equity funds...`);
      for (const fund of fundsNeedingRecompute) {
        try {
          // fetchSchemeNav reads from disk cache (24h TTL) — avoids network
          const navData = await _fetchNav(fund.schemeCode);
          if (!navData || !navData.data || navData.data.length <= 30) continue;
          const fundTRI = fundBenchmarkTRIs[fund.schemeCode];
          const metrics = calculateAllMetrics(
            navData.data,
            fund.type,
            fund.optionType || 'Growth',
            fundTRI
          );
          Object.assign(fund, metrics);
          // Re-apply AMFI riskometer if it was set — calculateAllMetrics sets a calculated
          // riskLevel which would overwrite the official AMFI value without this guard.
          if (fund._amfiRiskometer && fund._amfiRiskometer !== false) {
            const officialRisk = getRiskometerByName(fund.schemeName);
            if (officialRisk) fund.riskLevel = officialRisk;
          }
          delete fund._needsTRIRecompute;
          recomputed++;
        } catch (err) {
          // Non-fatal — fund keeps existing metrics
        }
      }
      if (recomputed > 0) {
        recomputeRiskLevels(allFunds);
        recomputeConsistencyScores(allFunds);
        saveProcessedData(allFunds, categorySummary);
        console.log(`[Boot] TRI metrics recomputed for ${recomputed} funds and saved to cache`);
      }
    }

    if (missing.length > 0) {
      console.log(`[Boot] Background TRI fetch for ${missing.length} missing indices...`);
      syncTRI(missing).then(async count => {
        if (count > 0) {
          const { saveTRI } = require('./services/triService');
          saveTRI();
          // Update fundBenchmarkTRIs with newly fetched data
          for (const f of allFunds) {
            if (f.benchmarkName && !fundBenchmarkTRIs[f.schemeCode]) {
              const tri = getTRIHistory(f.benchmarkName);
              if (tri) fundBenchmarkTRIs[f.schemeCode] = tri;
            }
          }
          console.log(`[Boot] Background TRI complete: ${count} new indices fetched`);
          // Actively recompute metrics — don't just flag and wait
          await recomputeTRIMetrics();
        }
      }).catch(err => console.error('[Boot] Background TRI error:', err.message));
    } else {
      // All TRI loaded from disk — recompute metrics for funds with missing beta
      const needsRecompute = allFunds.some(f =>
        (f.beta === 'Insufficient Data' || f.beta === null) &&
        ['Equity', 'Index', 'ETF'].includes(f.type) &&
        fundBenchmarkTRIs[f.schemeCode]
      );
      if (needsRecompute) {
        console.log(`[Boot] TRI available but metrics stale — recomputing...`);
        recomputeTRIMetrics().catch(err => console.error('[Boot] Recompute error:', err.message));
      }
    }

    return;
  }

  // Phase 1: Parse AMFI NAV
  loadingProgress = { phase: 'parsing', completed: 0, total: 0, cached: 0 };
  const { funds: rawFunds, categories } = await parseAMFINav();
  categorySummary = categories;

  // Phase 2: Make ALL funds available instantly
  allFunds = rawFunds;
  fundsByCode = {};
  for (const f of allFunds) {
    fundsByCode[f.schemeCode] = f;
    applyTER(f);
    applyAUMandBenchmark(f);
    applyIR(f);
    applyRiskometer(f);  // Apply SEBI riskometer immediately — no need to calculate
  }
  console.log(`[Boot] TER applied (${getTERCount()} schemes). AUM+Benchmarks+IR applied (${getAUMCount()} schemes).`);
  dataReady = true;

  const selectedFunds = selectTopFunds(rawFunds, 3000);
  console.log(`[Boot] Selected ${selectedFunds.length} key schemes for upfront metrics processing.`);

  // Phase 3: Load TRI from disk cache immediately (fast); fetch missing in background
  const allBenchmarkNames = [...new Set(allFunds.map(f => f.benchmarkName).filter(Boolean))];
  console.log(`[Boot] ${allBenchmarkNames.length} unique benchmarks across ${allFunds.length} funds`);
  setTRIBenchmarksForCron(allBenchmarkNames);
  scheduleTRICron();

  // Load whatever is already cached — instant
  const { loadTRI: _loadTRI } = require('./services/triService');
  _loadTRI();
  for (const f of allFunds) {
    if (f.benchmarkName) {
      const tri = getTRIHistory(f.benchmarkName);
      if (tri) fundBenchmarkTRIs[f.schemeCode] = tri;
    }
  }
  console.log(`[Boot] TRI from cache: ${getTRICount()} indices. Proceeding to fetch NAVs...`);

  // Print reconciliation report now that TER + AUM + TRI state is known
  printBootReconciliationReport(allFunds);

  // Background: fetch missing TRI indices (Nifty fast, BSE slow — non-blocking)
  const missingBenches = allBenchmarkNames.filter(b => !getTRIHistory(b));
  if (missingBenches.length > 0) {
    console.log(`[Boot] Background TRI fetch for ${missingBenches.length} indices...`);
    syncTRI(missingBenches).then(count => {
      if (count > 0) {
        const { saveTRI } = require('./services/triService');
        saveTRI();
        for (const f of allFunds) {
          if (f.benchmarkName && !fundBenchmarkTRIs[f.schemeCode]) {
            const tri = getTRIHistory(f.benchmarkName);
            if (tri) fundBenchmarkTRIs[f.schemeCode] = tri;
          }
        }
        console.log(`[Boot] Background TRI complete: ${count} indices fetched`);
      }
    }).catch(err => console.error('[Boot] Background TRI error:', err.message));
  }

  // Phase 4: Batch fetch historical NAVs
  loadingProgress = { phase: 'fetching', completed: 0, total: selectedFunds.length, cached: 0 };

  const schemeCodes = selectedFunds.map(f => f.schemeCode);
  const navDataMap = await batchFetchNavs(schemeCodes, (completed, total, cached) => {
    loadingProgress = { phase: 'fetching', completed, total, cached };
    if (completed % 50 === 0 || completed === total) {
      console.log(`[Boot] Progress: ${completed}/${total} (${cached} from cache)`);
    }
  }, 200);

  // Phase 5: Calculate metrics
  loadingProgress = { phase: 'calculating', completed: 0, total: selectedFunds.length, cached: 0 };
  console.log('[Boot] Calculating metrics...');

  let metricsCompleted = 0;
  for (const fund of selectedFunds) {
    const navData = navDataMap[fund.schemeCode];
    if (navData && navData.data && navData.data.length > 30) {
      // Look up this fund's declared benchmark TRI series
      const fundTRI = (() => {
        const benchName = fund.benchmarkName;
        if (!benchName) return null;
        const tri = getTRIHistory(benchName);
        if (tri) {
          fundBenchmarkTRIs[fund.schemeCode] = tri; // cache in memory
          return tri;
        }
        return null;
      })();

      const metrics = calculateAllMetrics(
        navData.data,
        fund.type,
        fund.optionType || 'Growth',
        fundTRI                    // real TRI for this fund's declared benchmark
      );
      Object.assign(fund, metrics);
      // Re-apply AMFI riskometer — calculateAllMetrics overwrites riskLevel with a
      // calculated value; the official AMFI label must take precedence.
      if (fund._amfiRiskometer) {
        const officialRisk = getRiskometerByName(fund.schemeName);
        if (officialRisk) fund.riskLevel = officialRisk;
      }

      // mfapi meta enrichment
      if (navData.meta) {
        if (navData.meta.fund_house) fund.amc = navData.meta.fund_house;
        if (navData.meta.scheme_category) fund.schemeCategory = navData.meta.scheme_category;
      }

      // Sync with the latest history date if newer
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
      console.log(`[Boot] Metrics: ${metricsCompleted}/${selectedFunds.length}`);
    }
  }

  // Fix #4 — Recompute risk levels using within-category percentile ranking.
  // Must run AFTER all fund stdDevs are populated so each category has its full peer set.
  recomputeRiskLevels(allFunds);

  // Pass 2 — Compute Consistency Scores within each sub-category.
  // Must run after all metrics (including Sortino, capture ratios) are populated.
  recomputeConsistencyScores(allFunds);

  // Rebuild index
  fundsByCode = {};
  for (const f of allFunds) {
    fundsByCode[f.schemeCode] = f;
  }

  // Rebuild category summary
  categorySummary = {};
  for (const fund of allFunds) {
    const key = fund.type;
    if (!categorySummary[key]) {
      categorySummary[key] = { count: 0, subCategories: {} };
    }
    categorySummary[key].count++;
    if (!categorySummary[key].subCategories[fund.subCategory]) {
      categorySummary[key].subCategories[fund.subCategory] = 0;
    }
    categorySummary[key].subCategories[fund.subCategory]++;
  }

  // Save to disk
  saveProcessedData(allFunds, categorySummary);

  loadingProgress = { phase: 'complete', completed: allFunds.length, total: allFunds.length, cached: 0 };
  console.log(`[Boot] ✓ All done! ${allFunds.length} funds with metrics ready.`);
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  boot().catch(err => {
    console.error('[Boot] Fatal error:', err);
  });
});
