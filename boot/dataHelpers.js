'use strict';
/**
 * boot/dataHelpers.js
 *
 * Pure helper functions that apply enrichment data (TER, AUM, IR, Riskometer)
 * to individual fund objects, and the boot-time reconciliation report printer.
 *
 * These functions are used both in the cached-boot path and the full-parse path,
 * so they are extracted here to avoid duplication and keep startup.js focused on
 * the boot sequence logic.
 */

const logger = require('../shared/logger');
const {
  getTERByName, getTERMissCount,
} = require('../services/terService');

const {
  getAUMByName, getBenchmarkByName,
} = require('../services/fundPerformanceService');

const {
  getIRByName,
} = require('../services/fundPerformanceService');

const {
  getRiskometerByName,
} = require('../services/fundPerformanceService');

const {
  getTRIHistory, classifyBenchmark, getTRICount,
} = require('../services/triService');

const {
  getAUMCount, getBenchmarkCount, getIRCount, getRiskometerCount,
} = require('../services/fundPerformanceService');

// ─── Per-fund enrichment helpers ────────────────────────────────────────────

/**
 * Apply AMFI-published TER to a fund.
 * Uses the plan type (Direct vs Regular) to pick the correct rate.
 */
function applyTER(fund) {
  const rec = getTERByName(fund.schemeName);
  if (!rec) return;
  const isDirect =
    (fund.planType || '').toLowerCase() === 'direct' ||
    (fund.schemeName || '').toLowerCase().includes('direct');
  const ter = isDirect ? rec.direct_ter : rec.regular_ter;
  if (ter !== null && ter !== undefined) fund.ter = ter;
}

/**
 * Apply daily AUM and declared benchmark name from AMFI Fund Performance API.
 */
function applyAUMandBenchmark(fund) {
  const aum = getAUMByName(fund.schemeName);
  if (aum !== null && aum !== undefined) fund.aum = aum;
  const bench = getBenchmarkByName(fund.schemeName);
  if (bench) fund.benchmarkName = bench;
}

/**
 * Apply AMFI-published Information Ratio data (1Y/3Y/5Y/10Y) to a fund.
 * Picks Direct or Regular IR based on the fund's plan type.
 */
function applyIR(fund) {
  const ir = getIRByName(fund.schemeName);
  if (!ir) return;
  const isDirect = (fund.planType || '').toLowerCase() === 'direct' ||
                   (fund.schemeName || '').toLowerCase().includes('direct');
  fund.amfiIR = {
    ir1y:  isDirect ? ir.ir1yDirect  : ir.ir1yRegular,
    ir3y:  isDirect ? ir.ir3yDirect  : ir.ir3yRegular,
    ir5y:  isDirect ? ir.ir5yDirect  : ir.ir5yRegular,
    ir10y: isDirect ? ir.ir10yDirect : ir.ir10yRegular,
  };
}

/**
 * Apply SEBI-mandated riskometer label from AMFI (authoritative, daily-updated).
 * Overrides any calculated riskLevel. If no AMFI data, flags the fund so that
 * the calculated fallback (recomputeRiskLevels) is allowed to run.
 */
function applyRiskometer(fund) {
  const riskometer = getRiskometerByName(fund.schemeName);
  if (riskometer) {
    fund.riskLevel = riskometer;    // SEBI-mandated, authoritative
    fund._amfiRiskometer = true;    // Flag: preserved in recomputeRiskLevels
  } else {
    fund._amfiRiskometer = false;   // No AMFI data — calculated fallback allowed
  }
}

// ─── Boot-time reconciliation report ─────────────────────────────────────────

/**
 * Prints a single at-a-glance data coverage summary instead of hundreds of
 * per-fund warn lines, covering TER, AUM, Benchmark, and TRI hit rates.
 *
 * @param {Array} funds - The full in-memory fund list
 */
function printBootReconciliationReport(funds) {
  const total = funds.length;
  const pct  = (n) => `${((n / total) * 100).toFixed(1)}%`;

  const terHit  = funds.filter(f => f.ter != null).length;
  const terMiss = getTERMissCount();

  const aumHit  = funds.filter(f => f.aum != null).length;
  const benchHit = funds.filter(f => f.benchmarkName).length;

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

  logger.info('[Boot] ── Data Coverage Report ────────────────────────────────────────────');
  logger.info(`[Boot] TER    : ${terHit}/${total} funds (${pct(terHit)}) — ${terMiss} unmatched (discontinued/legacy)`);
  logger.info(`[Boot] AUM    : ${aumHit}/${total} funds (${pct(aumHit)}) — ${total - aumHit} no match (plan-level not in AMFI API)`);
  logger.info(`[Boot] Bench  : ${benchHit}/${total} funds (${pct(benchHit)}) have a declared benchmark`);
  logger.info(`[Boot] TRI    : ${triMapped}/${uniqueBenches.length} unique benchmarks mappable — ${triForeign} foreign, ${triComposite} composite (skipped)${triUnknown ? `, ${triUnknown} unknown` : ''}`);
  logger.info(`[Boot] Funds with TRI data : ${triWithData}/${benchHit} benchmarked funds`);
  logger.info('[Boot] ──────────────────────────────────────────────────────────────────');
}

module.exports = {
  applyTER,
  applyAUMandBenchmark,
  applyIR,
  applyRiskometer,
  printBootReconciliationReport,
};
