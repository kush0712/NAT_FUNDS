'use strict';

const logger = require('../shared/logger');/**
 * routes/api.js
 *
 * All /api/* REST endpoints for the NAT funds application.
 * Business logic and in-memory state live in shared/appState.js;
 * this file is responsible only for HTTP request/response handling.
 */

const express = require('express');
const router  = express.Router();

const state = require('../shared/appState');

const { fetchSchemeNav }                     = require('../services/dataFetcher');
const { calculateAllMetrics, parseNavDate, computeConsistencyScoreForFund } = require('../services/metricsCalculator');
const { getTRIHistory }                      = require('../services/triService');

// ─── GET /api/status ─────────────────────────────────────────────────────────
/**
 * Returns server readiness and loading progress.
 * Polled by the frontend during the loading screen.
 */
router.get('/status', (req, res) => {
  res.json({
    ready:     state.dataReady,
    progress:  state.loadingProgress,
    fundCount: state.allFunds.length,
  });
});

// ─── GET /api/categories ─────────────────────────────────────────────────────
/**
 * Returns category/sub-category counts, optionally filtered by planType and optionType.
 */
router.get('/categories', (req, res) => {
  const { planType, optionType } = req.query;

  if (!planType && !optionType) {
    return res.json(state.categorySummary);
  }

  const filtered = {};
  for (const fund of state.allFunds) {
    if (planType  && fund.planType  !== planType)  continue;
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

// ─── GET /api/funds ───────────────────────────────────────────────────────────
/**
 * List funds with filtering, sorting, and pagination.
 * Query params: type, subCategory, planType, optionType, marketCap, search,
 *               sortBy, order, page, limit
 */
router.get('/funds', async (req, res) => {
  let funds = [...state.allFunds];

  const { type, subCategory, planType, optionType, sortBy, order, page, limit, search, marketCap } = req.query;

  if (type)        funds = funds.filter(f => f.type === type);
  if (subCategory) { const subs = subCategory.split(','); funds = funds.filter(f => subs.includes(f.subCategory)); }
  if (planType)    funds = funds.filter(f => f.planType === planType);
  if (optionType)  funds = funds.filter(f => f.optionType === optionType);
  if (marketCap)   { const caps = marketCap.split(','); funds = funds.filter(f => caps.includes(f.subCategory)); }
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

    if (aVal && typeof aVal === 'object' && aVal.avg !== undefined) aVal = aVal.avg;
    if (bVal && typeof bVal === 'object' && bVal.avg !== undefined) bVal = bVal.avg;

    if (aVal === 'Insufficient Data') aVal = null;
    if (bVal === 'Insufficient Data') bVal = null;

    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    if (typeof aVal === 'string') return aVal.localeCompare(bVal) * sortOrder;
    return (aVal - bVal) * sortOrder;
  });

  // Pagination
  const pageNum  = Math.max(1, parseInt(page)  || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const totalCount = funds.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const start    = (pageNum - 1) * pageSize;
  const paginated = funds.slice(start, start + pageSize);

  // Lazy-evaluate metrics for paginated items if missing
  const evalPromises = paginated.map(async (fund) => {
    if (fund.cagr1y !== null || typeof fund.standardDeviation === 'string' || typeof fund.standardDeviation === 'number') {
      return;
    }
    try {
      const navData = await fetchSchemeNav(fund.schemeCode);
      if (navData && navData.data && navData.data.length > 30) {
        const fundTRI = state.fundBenchmarkTRIs[fund.schemeCode] || (fund.benchmarkName ? getTRIHistory(fund.benchmarkName) : null);
        if (fundTRI && !state.fundBenchmarkTRIs[fund.schemeCode]) {
          state.fundBenchmarkTRIs[fund.schemeCode] = fundTRI;
        }
        const metrics = calculateAllMetrics(navData.data, fund.type, fund.optionType || 'Growth', fundTRI);
        Object.assign(fund, metrics);
      } else if (navData && navData.data) {
        fund.standardDeviation = 'Insufficient Data';
        fund.beta              = 'Insufficient Data';
        fund.sharpeRatio       = 'Insufficient Data';
      }
    } catch (err) {
      logger.warn(`[API /funds] Lazy-eval skip: ${fund.schemeCode} — ${err.message}`);
    }
  });
  await Promise.all(evalPromises);

  res.json({
    funds: paginated,
    pagination: { page: pageNum, limit: pageSize, totalCount, totalPages },
  });
});

// ─── GET /api/fund/:schemeCode ────────────────────────────────────────────────
/**
 * Single fund detail — includes live NAV sync and on-the-fly metrics recalculation
 * when the cached values are stale or newly available metrics are missing.
 */
router.get('/fund/:schemeCode', async (req, res) => {
  const fund = state.fundsByCode[req.params.schemeCode];
  if (!fund) {
    return res.status(404).json({ error: 'Fund not found' });
  }

  try {
    const navData = await fetchSchemeNav(fund.schemeCode);
    if (navData && navData.data && navData.data.length > 0) {
      // Sync with latest history date if newer than cached
      const latestMfDateStr  = navData.data[0].date;
      const currentFundDate  = parseNavDate(fund.date);
      const newMfDate        = parseNavDate(latestMfDateStr);
      if (newMfDate && currentFundDate && newMfDate > currentFundDate) {
        fund.nav  = parseFloat(navData.data[0].nav);
        fund.date = latestMfDateStr;
      }

      const needsFullCalc =
        (fund.cagr1y === null && fund.cagr3y === null) ||
        (navData.data.length > 30 && fund.maxDrawdown === undefined) ||
        (fund.cagr1y !== null && (
          fund.standardDeviation === 'Insufficient Data' ||
          fund.sharpeRatio       === 'Insufficient Data'
        )) ||
        fund.cagrSinceInception === undefined ||
        (fund._needsTRIRecompute === true && state.fundBenchmarkTRIs[fund.schemeCode]);

      if (needsFullCalc && navData.data.length > 30) {
        const fundTRI = state.fundBenchmarkTRIs[fund.schemeCode] || null;
        const metrics = calculateAllMetrics(navData.data, fund.type, fund.optionType || 'Growth', fundTRI);
        Object.assign(fund, metrics);
        delete fund._needsTRIRecompute;

        const peers = state.allFunds.filter(f => f.subCategory === fund.subCategory);
        if (peers.length > 0) {
          fund.consistencyScore = computeConsistencyScoreForFund(fund, peers);
        }

        if (navData.meta) {
          if (navData.meta.fund_house)     fund.amc          = navData.meta.fund_house;
          if (navData.meta.scheme_category) fund.schemeCategory = navData.meta.scheme_category;
        }
      }
    }
  } catch (err) {
    logger.error(`Error processing live data for ${fund.schemeCode}`, err);
  }

  res.json(fund);
});

// ─── GET /api/fund/:schemeCode/nav-history ────────────────────────────────────
/**
 * Returns sampled monthly NAV data for charting.
 * Query: period=1y|3y|5y|max (default 5y)
 */
router.get('/fund/:schemeCode/nav-history', async (req, res) => {
  const fund = state.fundsByCode[req.params.schemeCode];
  if (!fund) {
    return res.status(404).json({ error: 'Fund not found' });
  }

  try {
    const navData = await fetchSchemeNav(fund.schemeCode);
    if (!navData || !navData.data || navData.data.length === 0) {
      return res.json({ data: [] });
    }

    const period      = req.query.period || '5y';
    const periodYears = period === '1y' ? 1 : period === '3y' ? 3 : period === 'max' ? 100 : 5;

    const now    = new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - periodYears);

    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split('-');
      if (parts.length !== 3) return null;
      const day = parseInt(parts[0]);
      let month;
      if (isNaN(parseInt(parts[1]))) {
        const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
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

    const maxPoints = 200;
    let sampled;
    if (parsed.length <= maxPoints) {
      sampled = parsed;
    } else {
      const step = Math.floor(parsed.length / maxPoints);
      sampled = [];
      for (let i = 0; i < parsed.length; i += step) sampled.push(parsed[i]);
      if (sampled[sampled.length - 1] !== parsed[parsed.length - 1]) {
        sampled.push(parsed[parsed.length - 1]);
      }
    }

    res.json({
      data: sampled.map(d => ({ date: d.date.toISOString().split('T')[0], nav: d.nav })),
      meta: navData.meta || {},
    });
  } catch (err) {
    logger.error(`Error fetching nav history for ${fund.schemeCode}`, err);
    res.status(500).json({ error: 'Failed to fetch NAV history' });
  }
});

// ─── GET /api/compare ─────────────────────────────────────────────────────────
/**
 * Compare 2–4 funds side-by-side.
 * Query: codes=schemeCode1,schemeCode2,...
 */
router.get('/compare', async (req, res) => {
  const codes = (req.query.codes || '').split(',').filter(Boolean);
  if (codes.length < 2 || codes.length > 4) {
    return res.status(400).json({ error: 'Provide 2-4 scheme codes separated by commas' });
  }

  const funds = codes.map(code => state.fundsByCode[code]).filter(Boolean);
  if (funds.length < 2) {
    return res.status(404).json({ error: 'Not enough valid funds found' });
  }

  for (const fund of funds) {
    try {
      const navData = await fetchSchemeNav(fund.schemeCode);
      if (navData && navData.data && navData.data.length > 0) {
        const latestMfDateStr = navData.data[0].date;
        const currentFundDate = parseNavDate(fund.date);
        const newMfDate       = parseNavDate(latestMfDateStr);
        if (newMfDate && currentFundDate && newMfDate > currentFundDate) {
          fund.nav  = parseFloat(navData.data[0].nav);
          fund.date = latestMfDateStr;
        }

        const needsCalc =
          (fund.cagr1y === null && fund.cagr3y === null) ||
          (fund.cagr1y !== null && (
            fund.standardDeviation === 'Insufficient Data' ||
            fund.sharpeRatio       === 'Insufficient Data'
          )) ||
          fund.cagrSinceInception === undefined ||
          (navData.data.length > 30 && (
            fund.maxDrawdown       === undefined ||
            fund.sortinoRatio      === undefined ||
            fund.calmarRatio       === undefined ||
            fund.jensensAlpha      === undefined ||
            fund.upsideCapture     === undefined ||
            fund.downsideCapture   === undefined ||
            fund.informationRatio  === undefined ||
            fund.consistencyScore  === undefined
          ));

        if (needsCalc && navData.data.length > 30) {
          const fundTRI = state.fundBenchmarkTRIs[fund.schemeCode] || null;
          const metrics = calculateAllMetrics(navData.data, fund.type, fund.optionType || 'Growth', fundTRI);
          const prevConsistencyScore = fund.consistencyScore;
          Object.assign(fund, metrics);
          if (fund.consistencyScore === undefined && prevConsistencyScore !== undefined) {
            fund.consistencyScore = prevConsistencyScore;
          }
          if (fund.consistencyScore === undefined || fund.consistencyScore === null) {
            const peers = state.allFunds.filter(f => f.subCategory === fund.subCategory);
            if (peers.length > 0) {
              fund.consistencyScore = computeConsistencyScoreForFund(fund, peers);
            }
          }
        }
      }
    } catch (err) {
      logger.error(`Error processing live data for ${fund.schemeCode} in compare`, err);
    }
  }

  const types   = [...new Set(funds.map(f => f.type))];
  const subCats = [...new Set(funds.map(f => f.subCategory))];
  let warning = null;
  if (types.length > 1) {
    warning = `Comparing funds across different categories (${types.join(', ')}). Results may not be directly comparable.`;
  } else if (subCats.length > 1) {
    warning = `Comparing funds across sub-categories (${subCats.join(', ')}). Consider comparing within the same category for best results.`;
  }

  res.json({ funds, warning });
});

// ─── GET /api/search ─────────────────────────────────────────────────────────
/**
 * Full-text search across schemeName and AMC. Returns top 20 matches.
 * Query: q=<string>  (minimum 2 characters)
 */
router.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (q.length < 2) {
    return res.json({ results: [] });
  }

  const results = state.allFunds
    .filter(f => f.schemeName.toLowerCase().includes(q) || f.amc.toLowerCase().includes(q))
    .slice(0, 20)
    .map(f => ({
      schemeCode:  f.schemeCode,
      schemeName:  f.schemeName,
      type:        f.type,
      subCategory: f.subCategory,
      planType:    f.planType,
      optionType:  f.optionType,
      nav:         f.nav,
    }));

  res.json({ results });
});

module.exports = router;
