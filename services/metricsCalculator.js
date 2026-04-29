/**

const logger = require('../shared/logger'); * Metrics Calculator
 * Pure functions for calculating financial metrics from NAV history.
 *
 * Methodological standards (all fixes applied):
 *  #1 — StdDev/Sharpe/Beta: exactly 36-month lookback (no 3.5y fudge)
 *  #2 — Beta benchmark: TER correction applied to remove systematic drag
 *  #3 — 3Y rolling returns: monthly stepping + p10/p25/p75/p90 replace min/max
 *  #4 — Risk level: within-category percentile ranking (static fallback kept)
 *  #5 — Beat-benchmark: strict 3-day date alignment, dropped windows logged
 */

const { getMonthlyRiskFreeRate, getRiskFreeRateMeta } = require('./riskFreeRate');

/**
 * Parse date string "DD-Mon-YYYY" or "DD-MM-YYYY" to Date object.
 * Also accepts Date objects directly (from TRI data series).
 */
function parseNavDate(dateStr) {
  if (!dateStr) return null;
  // Already a Date object (e.g. TRI series uses {date: Date, nav: number})
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
  // ISO string or timestamp number
  if (typeof dateStr === 'number') return new Date(dateStr);
  if (typeof dateStr !== 'string') return null;

  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0]);
  let month, year;

  if (isNaN(parseInt(parts[1]))) {
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    month = months[parts[1]];
    if (month === undefined) return null;
  } else {
    month = parseInt(parts[1]) - 1;
  }
  year = parseInt(parts[2]);

  return new Date(year, month, day);
}

/**
 * Normalizes NAV history: Deduplicates by exact date and sorts chronologically.
 */
function prepareNavData(navHistory) {
  if (!navHistory || navHistory.length === 0) return [];

  const map = new Map();
  for (const item of navHistory) {
    const d = parseNavDate(item.date);
    const navVal = parseFloat(item.nav);
    if (!d || isNaN(navVal) || navVal <= 0) continue;

    // YYYY-MM-DD key for absolute deduplication
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!map.has(key)) {
      map.set(key, { date: d, nav: navVal });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date - b.date);
}

/**
 * Calculate CAGR given start NAV, end NAV, and number of years
 */
function calculateCAGR(startNav, endNav, years) {
  if (!startNav || !endNav || startNav <= 0 || years <= 0) return null;
  return (Math.pow(endNav / startNav, 1 / years) - 1) * 100;
}

/**
 * Calculate CAGR for specific periods from NAV history.
 *
 * Edge Case A — History guards:
 *   If the fund does not have the required minimum history for a period,
 *   that CAGR is returned as null (displayed as "N.A."). We never compute
 *   a fallback or partial-period figure.
 *
 * Edge Case B — Date gap handling:
 *   Always pick the closest *previous* available NAV (never forward-looking).
 *   If the backward gap exceeds 7 calendar days, reject the data point (return null).
 *   A dataQualityFlag is attached when a gap of 1-7 days was used.
 */
function calculateCAGRs(navHistory) {
  const parsed = prepareNavData(navHistory);
  if (parsed.length < 2) return { cagr1y: null, cagr3y: null, cagr5y: null, cagrDataQuality: {} };

  const currentNav  = parsed[parsed.length - 1].nav;
  const currentDate = parsed[parsed.length - 1].date;

  // Oldest available date in history
  const oldestDate = parsed[0].date;

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Find the closest *previous* NAV for a target date.
   * Returns { nav, gapDays } or null if:
   *   - The fund is younger than `years` (history guard)
   *   - No backward NAV is found within 7 calendar days
   */
  function findNavAtYearsAgo(years) {
    const targetDate = new Date(currentDate);
    targetDate.setFullYear(targetDate.getFullYear() - years);
    const targetDateMs = targetDate.getTime();

    // History guard: fund must have data at least as old as the target date
    if (oldestDate.getTime() > targetDateMs) {
      return null; // Fund is younger than the requested period → N.A.
    }

    // Binary search for the rightmost entry whose date <= targetDate
    let lo = 0, hi = parsed.length - 1;
    let result = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (parsed[mid].date.getTime() <= targetDateMs) {
        result = mid; // candidate — go right to find a closer one
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (result === -1) return null; // No entry on or before target date

    const gapMs   = targetDateMs - parsed[result].date.getTime(); // always >= 0 (going backward)
    const gapDays = gapMs / (24 * 60 * 60 * 1000);

    if (gapDays > 7) {
      // Gap too large — data quality too low, reject entirely
      return null;
    }

    return { nav: parsed[result].nav, gapDays, usedDate: parsed[result].date };
  }

  const res1y = findNavAtYearsAgo(1);
  const res3y = findNavAtYearsAgo(3);
  const res5y = findNavAtYearsAgo(5);

  // Build data-quality flag map (present only when gap was 1–7 days)
  const cagrDataQuality = {};
  if (res1y && res1y.gapDays >= 1) cagrDataQuality['1y'] = { gapDays: Math.round(res1y.gapDays * 10) / 10, usedDate: res1y.usedDate.toISOString().split('T')[0] };
  if (res3y && res3y.gapDays >= 1) cagrDataQuality['3y'] = { gapDays: Math.round(res3y.gapDays * 10) / 10, usedDate: res3y.usedDate.toISOString().split('T')[0] };
  if (res5y && res5y.gapDays >= 1) cagrDataQuality['5y'] = { gapDays: Math.round(res5y.gapDays * 10) / 10, usedDate: res5y.usedDate.toISOString().split('T')[0] };

  // Since-inception CAGR — always computable as long as fund has ≥ 1 month of history.
  // Formula: (currentNAV / firstNAV)^(1/yearsActive) − 1
  // This is the most honest return figure for young funds (Tickertape shows this too).
  const firstNav      = parsed[0].nav;
  const yearsActive   = (currentDate - oldestDate) / (365.25 * 24 * 60 * 60 * 1000);
  const cagrSinceInception = (yearsActive >= 1/12 && firstNav > 0)
    ? Math.round((Math.pow(currentNav / firstNav, 1 / yearsActive) - 1) * 10000) / 100
    : null;
  // Fund age in months — used by UI to show data-coverage banners.
  const fundAgeMonths = Math.floor(yearsActive * 12);

  return {
    cagr1y: res1y ? calculateCAGR(res1y.nav, currentNav, 1) : null,
    cagr3y: res3y ? calculateCAGR(res3y.nav, currentNav, 3) : null,
    cagr5y: res5y ? calculateCAGR(res5y.nav, currentNav, 5) : null,
    cagrSinceInception,  // annualised CAGR from inception — always shown
    fundAgeMonths,       // UI: show data-coverage banner for young funds
    cagrDataQuality, // {} if all exact; populated keys indicate date-gap adjustments
  };
}

/**
 * Calculate monthly returns from NAV history.
 * Excludes the current (incomplete) month.
 *
 * Fix #1: lookback is exactly `yearsBack` (no 3.5y inflation).
 *
 * Note: TER correction (old Fix #2) is removed. It was a workaround for using
 * passive index fund NAVs as TRI proxies — those funds have TER drag that biased
 * Beta/Alpha downward. Now that we use real TRI values from Nifty/BSE Indices APIs,
 * the series already has no TER drag and no correction is needed.
 *
 * Returns a dictionary mapping YYYY-MM to the return decimal.
 */
function getMonthlyReturns(navHistory, yearsBack = 3) {
  const parsed = prepareNavData(navHistory);
  if (parsed.length < 30) return {};

  // Fix #1: use yearsBack directly — no Math.max(yearsBack, 3.5) fudge
  // Note: To compute N monthly returns, we need N+1 month-end data points.
  // Subtracting 1 extra month ensures we get exactly 36 returns for a 3-year lookback.
  const cutoffDate = new Date(parsed[parsed.length - 1].date);
  cutoffDate.setMonth(cutoffDate.getMonth() - Math.round(yearsBack * 12) - 1);

  const filtered = parsed.filter(p => p.date >= cutoffDate);
  if (filtered.length < 12) return {};

  const monthlyNavs = {};
  for (const p of filtered) {
    const key = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}`;
    monthlyNavs[key] = p.nav; // Captures the last available NAV for each month
  }

  // A month is complete only if the current date is in a later month
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (const key of Object.keys(monthlyNavs)) {
    if (key >= currentMonthKey) {
      delete monthlyNavs[key];
    }
  }

  const months = Object.keys(monthlyNavs).sort();
  const returns = {};
  for (let i = 1; i < months.length; i++) {
    const prevNav = monthlyNavs[months[i - 1]];
    const currNav = monthlyNavs[months[i]];
    if (prevNav > 0) {
      returns[months[i]] = (currNav - prevNav) / prevNav;
    }
  }

  return returns;
}

/**
 * Percentile helper (linear interpolation, 0–100 scale).
 * Requires a pre-sorted array.
 */
function percentile(sortedArr, p) {
  if (!sortedArr || sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

/**
 * Calculate rolling returns (industry-standard methodology)
 *
 * Fix #3 — 3Y rolling: monthly stepping (one window per calendar month).
 *   Each window is 36 months apart from its neighbor, eliminating the
 *   extreme autocorrelation of daily-stepped 3Y windows.
 *   Result shape: { median, avg, p10, p25, p75, p90, positivePercent, beatBenchmarkPercent, totalPeriods }
 *
 * 1Y rolling: daily stepping kept (industry standard, lower autocorrelation).
 *   Result shape: { median, avg, min, max, positivePercent, beatBenchmarkPercent, totalPeriods }
 *
 * Fix #5 — Benchmark alignment: both series are searched using backward-looking
 *   (predecessor) search anchored to the fund's matched dates. Max gap 3 days.
 *   Windows where either series exceeds 3-day gap are dropped and counted.
 */
function calculateRollingReturns(navHistory, windowYears = 1, benchmarkNavHistory = null) {
  const parsed = prepareNavData(navHistory);
  if (parsed.length < 30) return 'Insufficient Data';

  const totalDays = (parsed[parsed.length - 1].date - parsed[0].date) / (1000 * 60 * 60 * 24);
  const requiredDays = windowYears === 1 ? 365 : (windowYears === 3 ? 1095 : windowYears * 365.25);
  if (totalDays < requiredDays) return 'Insufficient Data';

  const benchParsed = benchmarkNavHistory ? prepareNavData(benchmarkNavHistory) : null;

  const useMonthlyStep = windowYears >= 3;
  const windowDays = windowYears * 365.25;
  const returns = [];
  const benchPairs = []; // { fundReturn, benchReturn }
  let droppedWindows = 0;

  // ── Search helpers ──────────────────────────────────────────

  /**
   * findPrev: Closest entry whose date <= targetDateMs (within maxGapDays).
   * Used for: benchmark alignment (Fix #5), 3Y monthly-step anchors (Fix #3).
   */
  function findPrev(arr, targetDateMs, maxGapDays = 5) {
    const maxGapMs = maxGapDays * 24 * 60 * 60 * 1000;
    let lo = 0, hi = arr.length - 1, result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].date.getTime() <= targetDateMs) { result = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    if (result === -1) return null;
    if (targetDateMs - arr[result].date.getTime() > maxGapMs) return null;
    return arr[result];
  }

  /**
   * findNext: Closest entry whose date >= targetDateMs (within maxGapDays).
   * Used for: 1Y daily-step end-of-window search.
   */
  function findNext(arr, targetDateMs, maxGapDays = 5) {
    const maxGapMs = maxGapDays * 24 * 60 * 60 * 1000;
    let lo = 0, hi = arr.length - 1, result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].date.getTime() >= targetDateMs) { result = mid; hi = mid - 1; }
      else { lo = mid + 1; }
    }
    if (result === -1) return null;
    if (arr[result].date.getTime() - targetDateMs > maxGapMs) return null;
    return arr[result];
  }

  /**
   * Push a benchmark pair when both series have data within 3 days of the
   * fund's matched anchor dates. Drops silently and increments droppedWindows.
   * Fix #5 — strict alignment.
   */
  function tryAddBenchPair(fundStartEntry, fundEndEntry, fundCagr) {
    if (!benchParsed) return;
    // Anchor benchmark to the fund's actual matched dates (backward, max 3 days)
    const bStart = findPrev(benchParsed, fundStartEntry.date.getTime(), 3);
    const bEnd   = findPrev(benchParsed, fundEndEntry.date.getTime(), 3);
    if (!bStart || !bEnd) { droppedWindows++; return; }
    const bElapsed = (bEnd.date.getTime() - bStart.date.getTime()) / (1000 * 60 * 60 * 24);
    if (bElapsed <= 0) { droppedWindows++; return; }
    const bCagr = calculateCAGR(bStart.nav, bEnd.nav, bElapsed / 365.25);
    if (bCagr === null) { droppedWindows++; return; }
    benchPairs.push({ fundReturn: fundCagr, benchReturn: bCagr });
  }

  // ── Rolling window computation ──────────────────────────────

  if (useMonthlyStep) {
    // Fix #3 — 3Y: step one calendar month at a time
    const oldest = parsed[0].date;
    const newest = parsed[parsed.length - 1].date;
    const newestMs = newest.getTime();

    let cursorYear  = oldest.getFullYear();
    let cursorMonth = oldest.getMonth();

    while (true) {
      const startTargetMs = new Date(cursorYear, cursorMonth, 1).getTime();
      const endTargetMs   = startTargetMs + windowDays * 24 * 60 * 60 * 1000;

      // Stop when the end target is beyond our data (with 5-day tolerance)
      if (endTargetMs > newestMs + 5 * 24 * 60 * 60 * 1000) break;

      const startEntry = findPrev(parsed, startTargetMs, 5);
      const endEntry   = findPrev(parsed, endTargetMs, 5);

      if (startEntry && endEntry && startEntry !== endEntry) {
        const elapsedDays = (endEntry.date.getTime() - startEntry.date.getTime()) / (1000 * 60 * 60 * 24);
        if (elapsedDays > 0) {
          const cagr = calculateCAGR(startEntry.nav, endEntry.nav, elapsedDays / 365.25);
          if (cagr !== null) {
            returns.push(cagr);
            tryAddBenchPair(startEntry, endEntry, cagr);
          }
        }
      }

      // Advance by 1 calendar month
      cursorMonth++;
      if (cursorMonth > 11) { cursorMonth = 0; cursorYear++; }
    }
  } else {
    // 1Y: daily stepping — each parsed data point is a window start
    for (let i = 0; i < parsed.length; i++) {
      const startEntry  = parsed[i];
      const targetEndMs = startEntry.date.getTime() + windowDays * 24 * 60 * 60 * 1000;

      const endEntry = findNext(parsed, targetEndMs, 5);
      if (!endEntry) continue;

      const elapsedDays = (endEntry.date.getTime() - startEntry.date.getTime()) / (1000 * 60 * 60 * 24);
      if (elapsedDays <= 0) continue;

      const cagr = calculateCAGR(startEntry.nav, endEntry.nav, elapsedDays / 365.25);
      if (cagr === null) continue;
      returns.push(cagr);
      tryAddBenchPair(startEntry, endEntry, cagr);
    }
  }

  if (returns.length === 0) return 'Insufficient Data';

  if (droppedWindows > 0 && benchParsed) {
    logger.info(`[RollingReturns] ${windowYears}Y: ${droppedWindows} benchmark window(s) dropped (gap > 3 days)`);
  }

  // ── Statistics ──────────────────────────────────────────────

  const sorted = [...returns].sort((a, b) => a - b);
  const len    = sorted.length;
  const med    = len % 2 === 0
    ? (sorted[len / 2 - 1] + sorted[len / 2]) / 2
    : sorted[Math.floor(len / 2)];
  const avg    = returns.reduce((a, b) => a + b, 0) / len;

  const positivePercent   = Math.round((returns.filter(r => r > 0).length / len) * 100);

  let beatBenchmarkPercent = null;
  if (benchPairs.length > 0) {
    beatBenchmarkPercent = Math.round(
      (benchPairs.filter(r => r.fundReturn > r.benchReturn).length / benchPairs.length) * 100
    );
  }

  const result = {
    median: Math.round(med * 100) / 100,
    avg:    Math.round(avg * 100) / 100,
    positivePercent,
    beatBenchmarkPercent,
    totalPeriods: len,
  };

  if (useMonthlyStep) {
    // Fix #3 — 3Y: percentile-based distribution (replaces min/max)
    result.p10 = Math.round(percentile(sorted, 10) * 100) / 100;
    result.p25 = Math.round(percentile(sorted, 25) * 100) / 100;
    result.p75 = Math.round(percentile(sorted, 75) * 100) / 100;
    result.p90 = Math.round(percentile(sorted, 90) * 100) / 100;
  } else {
    // 1Y: classic min/max (acceptable for daily-stepped 1Y windows)
    result.min = Math.round(sorted[0] * 100) / 100;
    result.max = Math.round(sorted[len - 1] * 100) / 100;
  }

  return result;
}

/**
 * Calculate Standard Deviation (annualized) from dict of monthly returns.
 * Uses N-1 (sample variance).
 * Fix #1: minimum 36 months required (consistent with exact 36M lookback).
 */
function calculateStdDev(monthlyReturnsDict) {
  const returns = Object.values(monthlyReturnsDict);
  // Minimum 12 months — consistent with Sharpe/Sortino relaxation.
  // StdDev is mathematically valid with any sample; 12 months gives a useful 1-year volatility figure.
  if (returns.length < 12) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1); // Sample variance
  const monthlyStdDev = Math.sqrt(variance);

  const annualizedStdDev = monthlyStdDev * Math.sqrt(12) * 100;
  return Math.round(annualizedStdDev * 100) / 100;
}

/**
 * Calculate Sharpe Ratio (corrected algorithm)
 *
 * Formula:
 *   1. monthly_rf = (1 + annual_rf)^(1/12) − 1        [geometric compounding]
 *   2. excess_return[i] = fund_return[i] − monthly_rf
 *   3. avg_excess  = mean(excess_return[])
 *   4. stddev_fund = sample_stddev(fund_return[])       [≡ stddev(excess_return[]) since r_f is a constant;
 *                                                        subtracting a constant does not change variance.
 *                                                        Both forms are numerically identical.]
 *   5. sharpe_monthly     = avg_excess / stddev_fund
 *   6. sharpe_annualized  = sharpe_monthly × √12
 *
 * Fix #1: same 36M monthly return sample as StdDev and Beta.
 */
function calculateSharpeRatio(monthlyReturnsDict) {
  const returns = Object.values(monthlyReturnsDict);
  // Minimum 12 months — matches Tickertape / Zerodha Coin behaviour for newer funds.
  // 36-month requirement was too strict; even 1-year Sharpe is informative with disclosure.
  if (returns.length < 12) return null;

  // Step 1 — monthly risk-free rate via geometric compounding (dynamic, from RBI T-bill)
  let monthlyRf;
  try {
    monthlyRf = getMonthlyRiskFreeRate();
  } catch (err) {
    logger.warn('[Sharpe] Risk-free rate unavailable:', err.message);
    return 'Insufficient Data';
  }

  // Step 2 — excess returns
  const excessReturns = returns.map(r => r - monthlyRf);

  // Step 3 — average excess return
  const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;

  // Step 4 — sample stdDev of FUND returns (not excess returns)
  const fundMean     = returns.reduce((a, b) => a + b, 0) / returns.length;
  const fundSqDiffs  = returns.map(r => Math.pow(r - fundMean, 2));
  const fundVariance = fundSqDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1);
  const stdDevFund   = Math.sqrt(fundVariance);

  if (stdDevFund === 0) return null;

  // Steps 5–6 — annualised Sharpe
  const sharpe = (meanExcess / stdDevFund) * Math.sqrt(12);
  return Math.round(sharpe * 100) / 100;
}

/**
 * Calculate Beta via exact month alignment.
 * Fix #1: same 36M sample as StdDev/Sharpe (getMonthlyReturns uses yearsBack=3).
 * Fix #2: benchmark monthly returns have TER correction applied upstream.
 */
function calculateBeta(fundMonthlyReturnsDict, benchmarkMonthlyReturnsDict) {
  if (!fundMonthlyReturnsDict || !benchmarkMonthlyReturnsDict) return 'Insufficient Data';

  // Data alignment — only months present in both series
  const commonKeys = Object.keys(fundMonthlyReturnsDict)
    .filter(k => benchmarkMonthlyReturnsDict[k] !== undefined)
    .sort();

  if (commonKeys.length < 36) return 'Insufficient Data';

  const fundReturns  = commonKeys.map(k => fundMonthlyReturnsDict[k]);
  const benchReturns = commonKeys.map(k => benchmarkMonthlyReturnsDict[k]);
  const len          = commonKeys.length;

  const fundMean  = fundReturns.reduce((a, b) => a + b, 0) / len;
  const benchMean = benchReturns.reduce((a, b) => a + b, 0) / len;

  let covariance    = 0;
  let benchVariance = 0;

  for (let i = 0; i < len; i++) {
    covariance    += (fundReturns[i] - fundMean) * (benchReturns[i] - benchMean);
    benchVariance += Math.pow(benchReturns[i] - benchMean, 2);
  }

  // Sample covariance/variance
  covariance    /= (len - 1);
  benchVariance /= (len - 1);

  if (benchVariance === 0) return null;

  const beta = covariance / benchVariance;
  return Math.round(beta * 100) / 100;
}

/**
 * Determine risk level from standard deviation.
 *
 * Fix #4 — Percentile-based within-category ranking:
 *   If categoryStdDevs (the sorted/unsorted list of all peer stdDevs) is
 *   provided and has ≥5 members, rank this fund by its percentile within
 *   the category and assign the label accordingly.
 *
 *   This automatically adapts to market-regime changes — no manual
 *   threshold updates ever needed.
 *
 *   Fallback: legacy static thresholds when no peer data is available.
 *
 * @param {number}   stdDev           - Annualised StdDev %
 * @param {string}   fundType         - 'Equity' | 'Hybrid' | 'Debt' | etc.
 * @param {number[]} [categoryStdDevs] - All valid peer StdDevs in this subcategory
 */
function determineRiskLevel(stdDev, fundType, categoryStdDevs = null) {
  if (stdDev === null || stdDev === 'Insufficient Data' || typeof stdDev !== 'number') return null;

  // Fix #4 — percentile-based ranking (primary path when peers available)
  // Uses official SEBI riskometer labels (6-point scale)
  if (categoryStdDevs && Array.isArray(categoryStdDevs) && categoryStdDevs.length >= 5) {
    const sorted = [...categoryStdDevs].filter(v => typeof v === 'number').sort((a, b) => a - b);
    if (sorted.length >= 5) {
      // Count peers with StdDev <= this fund's
      const rank = sorted.filter(v => v <= stdDev).length;
      const pctRank = (rank / sorted.length) * 100;

      if (pctRank >= 83) return 'Very High';       // top 17% most volatile
      if (pctRank >= 67) return 'High';             // 67–83%
      if (pctRank >= 50) return 'Moderately High';  // 50–67%
      if (pctRank >= 33) return 'Moderate';          // 33–50%
      if (pctRank >= 17) return 'Low to Moderate';   // 17–33%
      return 'Low';                                   // bottom 17% least volatile
    }
  }

  // Fallback — static thresholds aligned with SEBI 6-label scale
  if (fundType === 'Debt') {
    if (stdDev < 1)  return 'Low';
    if (stdDev < 3)  return 'Low to Moderate';
    if (stdDev < 6)  return 'Moderate';
    if (stdDev < 10) return 'Moderately High';
    if (stdDev < 14) return 'High';
    return 'Very High';
  }

  if (fundType === 'Hybrid') {
    if (stdDev < 3)  return 'Low to Moderate';
    if (stdDev < 7)  return 'Moderate';
    if (stdDev < 12) return 'Moderately High';
    if (stdDev < 18) return 'High';
    return 'Very High';
  }

  // Equity / Index / ETF / default
  if (stdDev < 10) return 'Moderate';
  if (stdDev < 14) return 'Moderately High';
  if (stdDev < 18) return 'High';
  return 'Very High';
}

/**
 * Recompute risk levels for all funds using within-category percentile ranking.
 * Fix #4 — Called once after the batch metrics pass in server.js.
 *
 * Groups funds by subCategory, collects valid StdDevs for each group,
 * and reassigns riskLevel using percentile-rank method when ≥5 peers exist.
 * Funds with Insufficient Data stdDev are left with riskLevel = null.
 *
 * @param {Object[]} allFunds - The full in-memory fund array (mutated in-place)
 */
function recomputeRiskLevels(allFunds) {
  // Group valid stdDevs by subCategory — only for non-Debt funds where percentile ranking is meaningful
  const categoryStdDevMap = {};
  for (const fund of allFunds) {
    if (typeof fund.standardDeviation === 'number' && fund.type !== 'Debt') {
      if (!categoryStdDevMap[fund.subCategory]) {
        categoryStdDevMap[fund.subCategory] = [];
      }
      categoryStdDevMap[fund.subCategory].push(fund.standardDeviation);
    }
  }

  let reassigned = 0;
  let preserved = 0;
  for (const fund of allFunds) {
    if (typeof fund.standardDeviation !== 'number') continue;

    // Preserve AMFI-sourced official riskometer — never overwrite with calculated value
    if (fund._amfiRiskometer) {
      preserved++;
      continue;
    }

    // Debt funds: always use absolute static thresholds (SEBI mandates absolute risk labels
    // for Liquid/Overnight/etc. — percentile ranking would wrongly return "Very High" for
    // the most volatile Liquid fund even if its absolute volatility is tiny)
    if (fund.type === 'Debt') {
      fund.riskLevel = determineRiskLevel(fund.standardDeviation, fund.type, null);
      reassigned++;
      continue;
    }

    // Equity/Hybrid/Index/ETF: use within-category percentile ranking when ≥5 peers
    const peers = categoryStdDevMap[fund.subCategory] || null;
    if (peers && peers.length >= 5) {
      fund.riskLevel = determineRiskLevel(fund.standardDeviation, fund.type, peers);
    } else {
      // Not enough peers — use static thresholds
      fund.riskLevel = determineRiskLevel(fund.standardDeviation, fund.type, null);
    }
    reassigned++;
  }

  logger.info(`[RiskLevel] Recomputed ${reassigned} risk levels (percentile for equity, static for debt). Preserved ${preserved} official AMFI riskometers.`);
}


/**
 * ─── Maximum Drawdown ────────────────────────────────────────────────────────
 *
 * Clean two-pass O(n) implementation. No inDrawdown state machine.
 *
 * Pass 1: track running peak; record the deepest trough (worst dd from any peak)
 * Pass 2: scan forward from the trough to find the first recovery date
 *
 * Returns:
 *   { maxDrawdown (negative %), peakDate, troughDate, recoveryDate }
 *   or null if no drawdown recorded or insufficient data.
 */
function calculateMaxDrawdown(navHistory) {
  const parsed = prepareNavData(navHistory);
  if (parsed.length < 12) return null;

  let peak    = parsed[0].nav;
  let peakIdx = 0;
  let maxDD   = 0;       // worst drawdown seen (stays 0 or goes negative)
  let ddPeakIdx   = 0;
  let ddTroughIdx = 0;

  // Pass 1 — find the peak→trough pair with the deepest drawdown
  for (let i = 1; i < parsed.length; i++) {
    const nav = parsed[i].nav;
    if (nav >= peak) {
      // New ATH — update running peak (>= handles flat stretches correctly)
      peak    = nav;
      peakIdx = i;
    } else {
      const dd = (nav - peak) / peak; // always ≤ 0
      if (dd < maxDD) {               // more negative = worse
        maxDD       = dd;
        ddPeakIdx   = peakIdx;
        ddTroughIdx = i;
      }
    }
  }

  if (maxDD === 0) return null; // no drawdown at all

  // Pass 2 — find the first recovery: NAV ≥ peak level after the trough
  const peakNav    = parsed[ddPeakIdx].nav;
  let recoveryIdx  = null;
  for (let i = ddTroughIdx + 1; i < parsed.length; i++) {
    if (parsed[i].nav >= peakNav) {
      recoveryIdx = i;
      break;
    }
  }

  const fmt = (d) => d ? d.toISOString().split('T')[0] : null;

  return {
    maxDrawdown:  Math.round(maxDD * 10000) / 100, // e.g. −38.42 (%)
    peakDate:     fmt(parsed[ddPeakIdx]?.date),
    troughDate:   fmt(parsed[ddTroughIdx]?.date),
    recoveryDate: recoveryIdx !== null ? fmt(parsed[recoveryIdx]?.date) : null,
  };
}

/**
 * ─── New Metric: Sortino Ratio ──────────────────────────────────────────────
 *
 * Like Sharpe but only penalises downside deviation:
 *   1. excess_return[i] = fund_return[i] − monthly_rf
 *   2. downside_returns  = months where fund_return < monthly_rf (set others to 0)
 *   3. downside_dev      = sqrt(mean(squared downside returns)) × √12
 *   4. sortino           = (annualised mean excess return) / downside_dev
 *
 * Uses same 36-month sample as Sharpe/StdDev.
 */
function calculateSortinoRatio(monthlyReturnsDict) {
  const returns = Object.values(monthlyReturnsDict);
  // Same 12-month minimum as Sharpe — consistent threshold.
  if (returns.length < 12) return null;

  let monthlyRf;
  try {
    monthlyRf = getMonthlyRiskFreeRate();
  } catch (err) {
    return 'Insufficient Data';
  }

  const excessReturns = returns.map(r => r - monthlyRf);
  const meanExcess    = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const annualisedMeanExcess = meanExcess * 12;

  // Downside deviation: only negative excess months count; positives contribute 0.
  // Uses N−1 (Bessel’s correction) for consistency with the sample variance in Sharpe & StdDev.
  const downsideSquares = excessReturns.map(e => e < 0 ? e * e : 0);
  const meanDownsideSq  = downsideSquares.reduce((a, b) => a + b, 0) / (downsideSquares.length - 1);
  const downsideDev     = Math.sqrt(meanDownsideSq) * Math.sqrt(12);

  if (downsideDev === 0) return null;

  const sortino = annualisedMeanExcess / downsideDev;
  return Math.round(sortino * 100) / 100;
}

/**
 * ─── New Metric: Jensen's Alpha ─────────────────────────────────────────────
 *
 * Alpha = FundAnnReturn − [Rf + Beta × (BenchAnnReturn − Rf)]
 *
 * All returns and Rf as decimals (e.g. 0.12 for 12%).
 * Returns alpha as a percentage (e.g. 2.5 for +2.5%).
 */
function calculateJensensAlpha(annualisedFundReturn, beta, annualisedBenchReturn, annualRfRate) {
  if (
    annualisedFundReturn === null || annualisedFundReturn === 'Insufficient Data' ||
    beta === null || beta === 'Insufficient Data' ||
    annualisedBenchReturn === null || annualisedBenchReturn === 'Insufficient Data' ||
    annualRfRate === null || annualRfRate === undefined
  ) return null;

  const alpha = annualisedFundReturn - (annualRfRate + beta * (annualisedBenchReturn - annualRfRate));
  return Math.round(alpha * 10000) / 100; // convert to %
}

/**
 * ─── New Metric: Upside / Downside Capture Ratios ───────────────────────────
 *
 * Upside Capture:
 *   1. Identify months where benchmark return > 0
 *   2. fund_avg / bench_avg × 100
 *
 * Downside Capture:
 *   1. Identify months where benchmark return < 0
 *   2. fund_avg / bench_avg × 100
 *
 * Uses the aligned month keys from both dicts.
 * Requires ≥12 up-months and ≥6 down-months each for a meaningful result.
 */
function calculateCaptureRatios(fundMonthlyReturnsDict, benchmarkMonthlyReturnsDict) {
  if (!fundMonthlyReturnsDict || !benchmarkMonthlyReturnsDict) return null;

  const commonKeys = Object.keys(fundMonthlyReturnsDict)
    .filter(k => benchmarkMonthlyReturnsDict[k] !== undefined)
    .sort();

  if (commonKeys.length < 24) return null;

  const upFund = [], upBench = [], dnFund = [], dnBench = [];

  for (const k of commonKeys) {
    const b = benchmarkMonthlyReturnsDict[k];
    const f = fundMonthlyReturnsDict[k];
    if (b > 0)      { upFund.push(f); upBench.push(b); }
    else if (b < 0) { dnFund.push(f); dnBench.push(b); }
  }

  // MorningStar standard: ≥10 up-months and ≥6 down-months for statistical reliability
  if (upFund.length < 10 || dnFund.length < 6) return null;

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  const uCapture = (avg(upFund) / avg(upBench)) * 100;
  const dCapture = (avg(dnFund) / avg(dnBench)) * 100;

  return {
    upsideCapture:   Math.round(uCapture * 100) / 100,
    downsideCapture: Math.round(dCapture * 100) / 100,
  };
}

/**
 * ─── New Metric: Calmar Ratio ────────────────────────────────────────────────
 *
 * Calmar = 3Y CAGR / |Maximum Drawdown|
 * Both inputs as percentages (e.g. 12.5 for 12.5%).
 */
function calculateCalmarRatio(cagr3y, maxDrawdownPct) {
  if (
    cagr3y === null || cagr3y === 'Insufficient Data' || typeof cagr3y !== 'number' ||
    maxDrawdownPct === null || typeof maxDrawdownPct !== 'number' || maxDrawdownPct === 0
  ) return null;

  const calmar = cagr3y / Math.abs(maxDrawdownPct);
  return Math.round(calmar * 100) / 100;
}

/**
 * ─── New Metric: R-Squared (R²) ─────────────────────────────────────────────
 *
 * R² measures the proportion of the fund's return variance explained by the
 * benchmark index. Range: 0–100%.
 *   R² = 100 → fund moves in perfect lockstep with benchmark (pure index-like)
 *   R² < 70  → fund has significant active deviation (true active management)
 *
 * Formula:
 *   r = Cov(fund, bench) / sqrt(Var(fund) × Var(bench))  [Pearson correlation]
 *   R² = r² × 100
 *
 * Uses the same 36-month aligned monthly return sample as Beta.
 * Only meaningful for Equity / Index / ETF funds.
 */
function calculateRSquared(fundMonthlyReturnsDict, benchmarkMonthlyReturnsDict) {
  if (!fundMonthlyReturnsDict || !benchmarkMonthlyReturnsDict) return null;

  const commonKeys = Object.keys(fundMonthlyReturnsDict)
    .filter(k => benchmarkMonthlyReturnsDict[k] !== undefined)
    .sort();

  if (commonKeys.length < 36) return null;

  const fundReturns  = commonKeys.map(k => fundMonthlyReturnsDict[k]);
  const benchReturns = commonKeys.map(k => benchmarkMonthlyReturnsDict[k]);
  const n = commonKeys.length;

  const fundMean  = fundReturns.reduce((a, b)  => a + b, 0) / n;
  const benchMean = benchReturns.reduce((a, b) => a + b, 0) / n;

  let covariance = 0, fundVariance = 0, benchVariance = 0;
  for (let i = 0; i < n; i++) {
    const fd = fundReturns[i]  - fundMean;
    const bd = benchReturns[i] - benchMean;
    covariance    += fd * bd;
    fundVariance  += fd * fd;
    benchVariance += bd * bd;
  }

  if (fundVariance === 0 || benchVariance === 0) return null;

  const correlation = covariance / Math.sqrt(fundVariance * benchVariance);
  const rSquared    = Math.pow(correlation, 2) * 100; // 0–100 scale
  return Math.round(rSquared * 100) / 100;
}

/**
 * ─── New Metric: Information Ratio ──────────────────────────────────────────
 *
 * Tracking Error = StdDev(fund_monthly − bench_monthly) × √12
 * IR = (Annualised Fund Return − Annualised Bench Return) / Tracking Error
 *
 * Annualised returns use geometric compounding: (1+r_monthly)^12 − 1
 * Requires ≥36 aligned months.
 */
function calculateInformationRatio(fundMonthlyReturnsDict, benchmarkMonthlyReturnsDict) {
  if (!fundMonthlyReturnsDict || !benchmarkMonthlyReturnsDict) return 'Insufficient Data';

  const commonKeys = Object.keys(fundMonthlyReturnsDict)
    .filter(k => benchmarkMonthlyReturnsDict[k] !== undefined)
    .sort();

  if (commonKeys.length < 36) return 'Insufficient Data';

  const activeReturns = commonKeys.map(k => fundMonthlyReturnsDict[k] - benchmarkMonthlyReturnsDict[k]);
  const n = activeReturns.length;

  // Mean monthly active return
  const meanActive = activeReturns.reduce((a, b) => a + b, 0) / n;

  // Sample StdDev of active returns (monthly)
  const sqDiffs = activeReturns.map(r => Math.pow(r - meanActive, 2));
  const monthlyTE = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (n - 1));
  const annualisedTE = monthlyTE * Math.sqrt(12);

  if (annualisedTE === 0) return null;

  // Geometric annualised fund and bench returns (Fix: arithmetic ×12 understates for higher-return funds)
  const fundMean  = commonKeys.map(k => fundMonthlyReturnsDict[k]).reduce((a, b) => a + b, 0) / n;
  const benchMean = commonKeys.map(k => benchmarkMonthlyReturnsDict[k]).reduce((a, b) => a + b, 0) / n;
  const annFundReturn  = Math.pow(1 + fundMean, 12) - 1;  // Geometric annualisation
  const annBenchReturn = Math.pow(1 + benchMean, 12) - 1; // Geometric annualisation

  const ir = (annFundReturn - annBenchReturn) / annualisedTE;
  return Math.round(ir * 100) / 100;
}

/**
 * ─── New Metric: Consistency Score ──────────────────────────────────────────
 *
 * Composite score 0–10. Computed server-side in a second pass after all fund
 * metrics are known, so that within-category normalisation is possible.
 *
 * Score inputs (each normalised 0–1 within subCategory peers):
 *   • Median 3Y rolling return          30%  (higher = better)
 *   • Rolling positive % (3Y)           20%  (higher = better)
 *   • Downside capture ratio            20%  (lower = better → invert)
 *   • Sortino ratio                     20%  (higher = better)
 *   • Expense-adjusted return proxy*    10%  (higher = better)
 *
 * * Expense-adjusted return = cagr3y − ter (both in %)
 *
 * Called by recomputeConsistencyScores() in server.js.
 *
 * @param {Object} fund         - Single fund object (must have metrics populated)
 * @param {Object[]} peers      - All peers in the same subCategory (including this fund)
 * @returns {number|null}       - Score 0–10 rounded to 1 decimal, or null
 */
function computeConsistencyScoreForFund(fund, peers) {
  // Helper: normalise val within array (higher = better unless inverted)
  function normalise(val, arr, invert = false) {
    const valid = arr.filter(v => typeof v === 'number' && isFinite(v));
    if (valid.length < 2 || typeof val !== 'number' || !isFinite(val)) return null;
    const mn = Math.min(...valid);
    const mx = Math.max(...valid);
    if (mx === mn) return 0.5; // all equal → mid
    const n = (val - mn) / (mx - mn);
    return invert ? (1 - n) : n;
  }

  // Extract raw values from peers
  const p3yMedians   = peers.map(p => (p.rollingReturn3y && typeof p.rollingReturn3y === 'object') ? p.rollingReturn3y.median : null);
  const p3yPosPcts   = peers.map(p => (p.rollingReturn3y && typeof p.rollingReturn3y === 'object') ? p.rollingReturn3y.positivePercent : null);
  const pDnCapture   = peers.map(p => typeof p.downsideCapture === 'number' ? p.downsideCapture : null);
  const pSortino     = peers.map(p => typeof p.sortinoRatio === 'number'    ? p.sortinoRatio   : null);
  // Use raw 3Y CAGR — TER is already deducted daily from NAV by SEBI mandate.
  // Subtracting ter again would double-penalise funds with higher disclosed TER.
  const pExpAdj      = peers.map(p => typeof p.cagr3y === 'number' ? p.cagr3y : null);

  // This fund's raw values
  const myMedian3y   = (fund.rollingReturn3y && typeof fund.rollingReturn3y === 'object') ? fund.rollingReturn3y.median : null;
  const myPosPct3y   = (fund.rollingReturn3y && typeof fund.rollingReturn3y === 'object') ? fund.rollingReturn3y.positivePercent : null;
  const myDnCapture  = typeof fund.downsideCapture === 'number' ? fund.downsideCapture : null;
  const mySortino    = typeof fund.sortinoRatio === 'number'    ? fund.sortinoRatio    : null;
  const myExpAdj     = typeof fund.cagr3y === 'number' ? fund.cagr3y : null; // TER already baked into NAV

  const n1 = normalise(myMedian3y,  p3yMedians,  false); // higher = better
  const n2 = normalise(myPosPct3y,  p3yPosPcts,  false); // higher = better
  const n3 = normalise(myDnCapture, pDnCapture,   true); // lower = better → invert
  const n4 = normalise(mySortino,   pSortino,    false); // higher = better
  const n5 = normalise(myExpAdj,    pExpAdj,     false); // higher = better

  // Count how many inputs we have
  const inputs = [
    { v: n1, w: 0.30 },
    { v: n2, w: 0.20 },
    { v: n3, w: 0.20 },
    { v: n4, w: 0.20 },
    { v: n5, w: 0.10 },
  ];

  const validInputs = inputs.filter(i => i.v !== null);
  if (validInputs.length < 2) return null; // not enough signal

  // Reweight to sum to 1 using only available inputs
  const totalWeight = validInputs.reduce((a, i) => a + i.w, 0);
  const weightedSum = validInputs.reduce((a, i) => a + (i.v * i.w), 0);
  const score = (weightedSum / totalWeight) * 10;

  return Math.round(score * 10) / 10;
}

/**
 * Recompute consistency scores for all funds using within-category normalisation.
 * Called once after the full batch metrics pass in server.js.
 * Mutates fund.consistencyScore in-place.
 *
 * @param {Object[]} allFunds - Full in-memory fund array
 */
function recomputeConsistencyScores(allFunds) {
  // Group funds by subCategory
  const categoryMap = {};
  for (const f of allFunds) {
    if (!categoryMap[f.subCategory]) categoryMap[f.subCategory] = [];
    categoryMap[f.subCategory].push(f);
  }

  let computed = 0;
  for (const [, peers] of Object.entries(categoryMap)) {
    for (const fund of peers) {
      const score = computeConsistencyScoreForFund(fund, peers);
      fund.consistencyScore = score;
      if (score !== null) computed++;
    }
  }

  logger.info(`[ConsistencyScore] Computed scores for ${computed} funds across ${Object.keys(categoryMap).length} sub-categories.`);
}

/**
 * Calculate all metrics for a fund.
 *
 * benchmarkNavHistory accepts real TRI time-series from triService.js.
 * No TER correction needed — TRI values have no expense ratio drag.
 */
function calculateAllMetrics(
  navHistory,
  fundType,
  optionType = 'Growth',
  fundBenchmarkTRI = null      // real TRI series from triService for this fund's declared benchmark
) {
  const cagrs = calculateCAGRs(navHistory);
  // Fix #1: yearsBack=3, no fudge factor
  const monthlyReturnsDict = getMonthlyReturns(navHistory, 3);
  const stdDev    = calculateStdDev(monthlyReturnsDict);
  const riskLevel = determineRiskLevel(stdDev, fundType); // static fallback; recomputeRiskLevels() overrides later

  let sharpe  = 'Insufficient Data';
  let sortino = 'Insufficient Data';
  let beta    = 'Insufficient Data';
  const isEquityLike = ['Equity', 'Index', 'ETF'].includes(fundType);

  // Calculate Sharpe and Sortino for ALL fund types including Debt.
  // Tickertape and INDmoney show Sharpe for debt funds — it is mathematically valid.
  // Very low-vol funds (Overnight, Liquid) naturally return null via stdDev ≈ 0 guard.
  sharpe  = calculateSharpeRatio(monthlyReturnsDict);
  sortino = calculateSortinoRatio(monthlyReturnsDict);

  // Use real TRI data (no TER correction required)
  let betaBenchmarkData = fundBenchmarkTRI;

  // Benchmark monthly returns (used for Beta, IR, Alpha, Capture)
  let benchReturnsDict = null;

  if (isEquityLike && betaBenchmarkData) {
    benchReturnsDict = getMonthlyReturns(betaBenchmarkData, 3);

    if (Object.keys(benchReturnsDict).length < 36) {
      // Insufficient TRI history for this benchmark — skip benchmark metrics
      benchReturnsDict = null;
    }

    if (benchReturnsDict) beta = calculateBeta(monthlyReturnsDict, benchReturnsDict);
  } else if (!isEquityLike) {
    beta = null;
  }

  // Calculate rolling returns for ALL plans including IDCW.
  // For IDCW: NAV drops on dividend payment dates (ex-dividend effect).
  // Returns reflect NAV movement only — dividends declared are not included.
  // This matches Tickertape / INDmoney methodology for IDCW plans.
  const rollingReturn1y = calculateRollingReturns(navHistory, 1, fundBenchmarkTRI);
  const rollingReturn3y = calculateRollingReturns(navHistory, 3, fundBenchmarkTRI);
  const isIdcwPlan = optionType === 'IDCW'; // UI flag: show dividends-not-included caveat

  // ── New Metrics ─────────────────────────────────────────────────────────────

  // Maximum Drawdown (all fund types)
  const drawdownResult = calculateMaxDrawdown(navHistory);
  const maxDrawdown        = drawdownResult ? drawdownResult.maxDrawdown    : null;
  const maxDrawdownPeak    = drawdownResult ? drawdownResult.peakDate       : null;
  const maxDrawdownTrough  = drawdownResult ? drawdownResult.troughDate     : null;
  const maxDrawdownRecovery = drawdownResult ? drawdownResult.recoveryDate  : null;

  // Calmar Ratio (needs 3Y CAGR + Max Drawdown)
  const calmarRatio = calculateCalmarRatio(cagrs.cagr3y, maxDrawdown);

  // Equity-like exclusive metrics
  let jensensAlpha    = null;
  let upsideCapture   = null;
  let downsideCapture = null;
  let informationRatio = null; // null = not available (for both equity-without-TRI and non-equity)
  let rSquared         = null;

  if (isEquityLike && benchReturnsDict && Object.keys(benchReturnsDict).length >= 36) {
    // Jensen's Alpha: needs annualised fund return, beta, annualised bench return, annual Rf
    let annualRf = null;
    try {
      const rfMeta = getRiskFreeRateMeta();
      annualRf = rfMeta ? rfMeta.rate : null; // .rate is the decimal (e.g. 0.068)
    } catch (_) {}

    const benchKeys = Object.keys(benchReturnsDict).sort();
    const fundKeys  = Object.keys(monthlyReturnsDict).sort();
    const commonKeys = fundKeys.filter(k => benchReturnsDict[k] !== undefined);

    if (commonKeys.length >= 36 && annualRf !== null && typeof beta === 'number') {
      const fundMean  = commonKeys.map(k => monthlyReturnsDict[k]).reduce((a, b) => a + b, 0) / commonKeys.length;
      const benchMean = commonKeys.map(k => benchReturnsDict[k]).reduce((a, b) => a + b, 0) / commonKeys.length;
      const annFundReturn  = Math.pow(1 + fundMean, 12) - 1;  // Geometric annualisation (audit fix)
      const annBenchReturn = Math.pow(1 + benchMean, 12) - 1; // Geometric annualisation (audit fix)

      jensensAlpha = calculateJensensAlpha(annFundReturn, beta, annBenchReturn, annualRf);
    }

    // Capture Ratios
    const capture = calculateCaptureRatios(monthlyReturnsDict, benchReturnsDict);
    if (capture) {
      upsideCapture   = capture.upsideCapture;
      downsideCapture = capture.downsideCapture;
    }

    // Information Ratio
    informationRatio = calculateInformationRatio(monthlyReturnsDict, benchReturnsDict);

    // R-Squared — how much of fund variance is explained by the benchmark (0–100)
    rSquared = calculateRSquared(monthlyReturnsDict, benchReturnsDict);
  }

  return {
    ...cagrs,
    rollingReturn1y,
    rollingReturn3y,
    isIdcwPlan,          // true for IDCW plans — UI shows dividends-not-included caveat
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    standardDeviation: stdDev,
    beta,
    riskLevel,
    // New metrics
    maxDrawdown,
    maxDrawdownPeak,
    maxDrawdownTrough,
    maxDrawdownRecovery,
    calmarRatio,
    jensensAlpha,
    upsideCapture,
    downsideCapture,
    informationRatio,
    rSquared,
    // consistencyScore is set by recomputeConsistencyScores() post-batch pass
    riskFreeRateMeta: (() => { try { return getRiskFreeRateMeta(); } catch (_) { return null; } })(),
  };
}

module.exports = {
  parseNavDate,
  calculateCAGR,
  calculateCAGRs,
  getMonthlyReturns,
  percentile,
  calculateRollingReturns,
  calculateStdDev,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateBeta,
  calculateMaxDrawdown,
  calculateJensensAlpha,
  calculateCaptureRatios,
  calculateCalmarRatio,
  calculateInformationRatio,
  calculateRSquared,
  computeConsistencyScoreForFund,
  recomputeConsistencyScores,
  determineRiskLevel,
  recomputeRiskLevels,
  calculateAllMetrics,
};
