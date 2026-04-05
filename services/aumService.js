/**
 * aumService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin compatibility wrapper around fundPerformanceService.js.
 *
 * Previously this service fetched AMFI's Schemewise Average AUM (AAUM) Excel
 * which gave a QUARTERLY average — highly inaccurate for current AUM display.
 *
 * Now delegates to fundPerformanceService which fetches the DAILY AUM per fund
 * from the AMFI Fund Performance API (updated every trading day).
 *
 * Lookup is by scheme NAME (normalised), not scheme code, because the AMFI
 * Fund Performance API does not expose scheme codes. The normalised name key
 * is the same format used by terService.js so lookups are consistent.
 *
 * Maintains the same public API surface as before so server.js requires no
 * structural changes for AUM lookups.
 */

'use strict';

const {
  initFundPerformance,
  syncAUM: _syncAUM,
  getAUMByName,
  getAUMDate,
  getAUMCount,
  scheduleFundPerformanceCron,
  normaliseName,
} = require('./fundPerformanceService');

// ─── Re-export under legacy names ─────────────────────────────────────────────

async function initAUM() {
  // initFundPerformance handles both AUM and benchmarks.
  // Called from server.js boot — fundPerformanceService.initFundPerformance()
  // should already have been called. This is a no-op safety wrapper.
  console.log('[AUM] aumService: delegating to fundPerformanceService (already initialised)');
}

async function syncAUM() {
  return _syncAUM();
}

/**
 * Get AUM in Crores for a fund.
 *
 * @param {string} schemeCode  - NOT USED (kept for API compat)
 * @param {string} schemeName  - Scheme name used for lookup
 * @returns {number|null}
 */
function getAUMByCode(schemeCode, schemeName) {
  // New implementation: look up by name (the daily API provides no scheme codes)
  return getAUMByName(schemeName);
}

function getAUMPeriod() {
  const d = getAUMDate();
  return d ? `Daily (${d})` : 'unknown';
}

function scheduleAUMCron(onSynced) {
  scheduleFundPerformanceCron(onSynced);
}

module.exports = {
  initAUM,
  syncAUM,
  getAUMByCode,
  getAUMByName,        // expose directly for convenience
  getAUMPeriod,
  getAUMCount,
  scheduleAUMCron,
  normaliseName,       // re-export for server.js to use in fund AUM assignment
};
