/**

const logger = require('../shared/logger'); * fundPerformanceService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches fund performance data from AMFI's Fund Performance API:
 *   POST https://www.amfiindia.com/gateway/pollingsebi/api/amfi/fundperformance
 *
 * Provides THREE datasets:
 *   1. Daily AUM (in Cr.) — updated every trading day. We fall back up to 7
 *      calendar days if today's data is not yet published.
 *   2. Per-fund benchmark names — fetched once (benchmarks are static per SEBI
 *      scheme category mandate). Stored in benchmark-data.json.
 *   3. SEBI Riskometer — `riskometerScheme` field published daily by AMFI.
 *      Values: Low | Low to Moderate | Moderate | Moderately High | High | Very High
 *      Stored in riskometer-data.json (1-day cache TTL, same as AUM).
 *
 * API structure:
 *   - maturityType: 1=Equity, 2=Debt, 3=Hybrid, 4=Solution, 5=Other(Index/ETF)
 *   - subCategory:  integer ID from /getsubcategory endpoint
 *   - Fetches subcategory list first, then loops through each to get all funds.
 *
 * Response fields of interest:
 *   { schemeName, benchmark, dailyAUM, riskometerScheme, riskometerBenchmark,
 *     navDate, navRegular, navDirect, ir1YrDirect, ... }
 *
 * NOTE: AMFI does not return schemeCode in this API. Matching is done by
 *       normalising schemeName to handle plan/option suffixes.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');

// ─── Paths ──────────────────────────────────────────────────────────────────
// All persistent data files live in <project-root>/data/
const DATA_DIR           = path.join(__dirname, '..', 'data');
const AUM_JSON           = path.join(DATA_DIR, 'aum-data.json');
const AUM_JSON_TMP       = path.join(DATA_DIR, 'aum-data.tmp.json');
const BENCHMARK_JSON     = path.join(DATA_DIR, 'benchmark-data.json');
const BENCHMARK_JSON_TMP = path.join(DATA_DIR, 'benchmark-data.tmp.json');
const IR_JSON            = path.join(DATA_DIR, 'ir-data.json');
const IR_JSON_TMP        = path.join(DATA_DIR, 'ir-data.tmp.json');
const RISKOMETER_JSON    = path.join(DATA_DIR, 'riskometer-data.json');
const RISKOMETER_JSON_TMP = path.join(DATA_DIR, 'riskometer-data.tmp.json');

// ─── API Constants ───────────────────────────────────────────────────────────

const AMFI_BASE          = 'https://www.amfiindia.com/gateway/pollingsebi/api/amfi';
const AMFI_SUBCATEGORY   = `${AMFI_BASE}/getsubcategory`;
const AMFI_FUND_PERF     = `${AMFI_BASE}/fundperformance`;
const COMMON_HEADERS     = {
  'Content-Type': 'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; NatFunds/2.0)',
  'Referer':      'https://www.amfiindia.com/polling/amfi/fund-performance',
  'Origin':       'https://www.amfiindia.com',
};
const REQUEST_TIMEOUT_MS = 30_000;
const AUM_MAX_AGE_DAYS        = 1;   // refresh AUM daily
const BENCHMARK_MAX_AGE_DAYS  = 90;  // benchmarks are semi-permanent; refresh quarterly
const IR_MAX_AGE_DAYS         = 1;   // refresh IR daily (same as AUM)
const RISKOMETER_MAX_AGE_DAYS = 1;   // refresh riskometer daily (SEBI-mandated, updated daily)

// AMFI API field meanings:
//   maturityType: 1 = Open Ended, 2 = Close Ended (we only care about Open Ended)
//   category:     1=Equity, 2=Debt, 3=Hybrid, 4=Solution Oriented, 5=Other (Index/ETF/FOF)
const OPEN_ENDED = 1; // maturityType value for Open Ended funds
const FUND_CATEGORIES = [1, 2, 3, 4, 5]; // category IDs to loop through

// ─── In-Memory State ─────────────────────────────────────────────────────────

/** normalizedName → AUM in Crores */
let _aumIndex    = {};
/** normalizedName → benchmark string */
let _benchmarkIndex = {};
/**
 * normalizedName → { ir1yDirect, ir3yDirect, ir5yDirect, ir10yDirect,
 *                    ir1yRegular, ir3yRegular, ir5yRegular, ir10yRegular }
 */
let _irIndex        = {};
/**
 * normalizedName → SEBI riskometer label string.
 * e.g. "Very High", "High", "Moderately High", "Moderate", "Low to Moderate", "Low"
 * Published directly by AMFI via the Fund Performance API — authoritative source.
 */
let _riskometerIndex = {};
let _aumDate          = null;
let _aumCount         = 0;
let _benchmarkCount   = 0;
let _irCount          = 0;
let _riskometerCount  = 0;

// ─── Name Normalisation ──────────────────────────────────────────────────────

/**
 * Normalise a scheme name for fuzzy matching.
 * Strips plan type, option type, whitespace, trailing punctuation.
 *
 * e.g. "Mirae Asset Large Cap Fund - Direct Plan - Growth" → "mirae asset large cap fund"
 */
function normaliseName(name) {
  // Normalise & → and so AMFI AUM API names align with MFAPI NAV names
  let s = (name || '').toLowerCase().replace(/\s*&\s*/g, ' and ');
  s = s.replace(/\s*\(.*?\)/g, '');

  // Primary split: on "- [option/plan keyword]" WITH a preceding dash
  const splitRx = /\s*-\s*(direct|regular|retail|growth|idcw|dividend|bonus|payout|reinvest(?:ment)?|daily|weekly|fortnightly|monthly|quarterly|half.?yearly|annual|flexi|income\s+distribution)\b/i;
  const splitIdx = s.search(splitRx);
  if (splitIdx > 0) s = s.slice(0, splitIdx);

  // Secondary split: "Direct Plan" / "Regular Plan" WITHOUT a dash
  // e.g. "Fund Direct Plan Half Yearly IDCW Option"
  const splitRx2 = /\s+(direct|regular|retail)\s+plan\b/i;
  const splitIdx2 = s.search(splitRx2);
  if (splitIdx2 > 0) s = s.slice(0, splitIdx2);

  // Strip orphaned trailing option words
  s = s.replace(/\b(growth|idcw|dividend|bonus|payout|reinvest(?:ment)?|daily|weekly|fortnightly|monthly|quarterly|annual|flexi)\s*$/gi, '');
  // Strip orphaned trailing plan words
  s = s.replace(/\b(direct|regular|retail)\s*(plan)?\s*$/gi, '');
  // Strip trailing "Fund"
  s = s.replace(/\bfund\s*$/gi, '');

  return s.replace(/\s+/g, ' ').trim();
}



/**
 * Collapse all whitespace for compound-word comparison.
 * e.g. "multi cap" → "multicap", "large & mid cap" → "large&midcap"
 * Used as a secondary fuzzy key — not stored; only compared.
 */
function collapseSpaces(s) {
  return s.replace(/\s+/g, '');
}

/**
 * Token-overlap similarity between two normalised names.
 * Counts how many significant words (>2 chars) are shared.
 * Returns fraction shared relative to longer name's token count.
 */
function tokenOverlap(a, b) {
  const tokens = (s) => s.split(/\s+/).filter(t => t.length > 2);
  const ta = new Set(tokens(a));
  const tb = tokens(b);
  if (ta.size === 0 || tb.length === 0) return 0;
  const shared = tb.filter(t => ta.has(t)).length;
  return shared / Math.max(ta.size, tb.length);
}

/**
 * Generic fuzzy lookup against an index (normalised-name → value).
 *
 * Lookup cascade:
 *  1. Exact normalised-name match
 *  2. Substring containment (existing behaviour)
 *  3. Space-collapsed comparison ("multi cap" ↔ "multicap")
 *  4. High token overlap (≥ 0.75 — at least 3/4 of significant words match)
 *
 * @param {string} schemeName  Raw name from NAV file
 * @param {Object} index       normalised-name → value map
 * @returns {*|undefined}      Value or undefined if not found
 */
function fuzzyLookup(schemeName, index) {
  if (!schemeName) return undefined;
  const key = normaliseName(schemeName);

  // 1. Exact
  if (index[key] !== undefined) return index[key];

  // 2. Substring containment
  for (const [k, v] of Object.entries(index)) {
    if (k.includes(key) || key.includes(k)) return v;
  }

  // 3. Space-collapsed ("multi cap" ↔ "multicap")
  const keyNoSpace = collapseSpaces(key);
  for (const [k, v] of Object.entries(index)) {
    if (collapseSpaces(k) === keyNoSpace) return v;
  }

  // 4. Token overlap ≥ 0.75
  let bestScore = 0;
  let bestVal;
  for (const [k, v] of Object.entries(index)) {
    const score = tokenOverlap(key, k);
    if (score > bestScore) { bestScore = score; bestVal = v; }
  }
  if (bestScore >= 0.75) return bestVal;

  return undefined;
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

async function postJSON(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method:  'POST',
      headers: COMMON_HEADERS,
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    if (!resp.ok) {
      logger.warn(`[FundPerf] HTTP ${resp.status} for ${url}`);
      return null;
    }
    return await resp.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn(`[FundPerf] Timeout on ${url}`);
    } else {
      logger.warn(`[FundPerf] Error on ${url}: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Subcategory Discovery ────────────────────────────────────────────────────

/**
 * Fetch all subcategory IDs for a given fund category (1=Equity, 2=Debt, etc.).
 * @returns {Array<{id, name}>}
 */
async function getSubcategoriesForCategory(categoryId) {
  const result = await postJSON(AMFI_SUBCATEGORY, { category: categoryId });
  if (result && result.data && Array.isArray(result.data)) {
    return result.data;
  }
  return [];
}

// ─── Fund Performance Fetch ───────────────────────────────────────────────────

/**
 * Format a Date to "DD-Mon-YYYY" as expected by AMFI API.
 */
function formatAMFIDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd  = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const yy  = d.getFullYear();
  return `${dd}-${mon}-${yy}`;
}

/**
 * Fetch fund performance records, adapting to different publishing schedules per category.
 * Equity funds might publish daily or on the 1st of the month, while Debt funds might only 
 * publish on month-end dates. This finds the most recent valid date for EACH category 
 * and fetches its subcategories, ensuring complete coverage across the entire spectrum.
 *
 * @returns {Promise<{ records: Array<Object>, usedDates: Array<string> }>}
 */
async function fetchAdaptiveFundData(maxFallbackDays = 14) {
  const allRecords = [];
  const usedDates = new Set();
  let totalCalls = 0;

  for (const catId of FUND_CATEGORIES) {
    const subCats = await getSubcategoriesForCategory(catId);
    if (!subCats || subCats.length === 0) {
      logger.info(`[FundPerf] category=${catId}: no subcategories found, skipping`);
      continue;
    }

    // 1. Find the latest valid date for this category by testing its FIRST subcategory
    const testSubCat = subCats[0];
    let validDateStr = null;
    let firstSubCatRecords = [];

    for (let daysBack = 0; daysBack <= maxFallbackDays; daysBack++) {
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      const dateStr = formatAMFIDate(d);

      await sleep(120); // polite rate-limiting
      const payload = {
        maturityType: OPEN_ENDED,  // always 1 = Open Ended
        category:     catId,
        subCategory:  testSubCat.id,
        mfid:         0,
        reportDate:   dateStr,
      };

      const result = await postJSON(AMFI_FUND_PERF, payload);
      totalCalls++;

      // Valid if data exists AND contains records
      if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
        validDateStr = dateStr;
        firstSubCatRecords = result.data;
        logger.info(`[FundPerf] cat=${catId} latest date found: ${validDateStr} (tested subCat ${testSubCat.name})`);
        break;
      }
    }

    if (!validDateStr) {
      logger.warn(`[FundPerf] cat=${catId} yielded NO data for the last ${maxFallbackDays} days.`);
      continue;
    }

    // 2. Add the first subcategory we already fetched
    allRecords.push(...firstSubCatRecords);
    usedDates.add(validDateStr);

    // 3. Fetch the rest of the subcategories using this SAME valid date
    for (let i = 1; i < subCats.length; i++) {
      const subCat = subCats[i];
      await sleep(120);
      const payload = {
        maturityType: OPEN_ENDED,
        category:     catId,
        subCategory:  subCat.id,
        mfid:         0,
        reportDate:   validDateStr,
      };

      const result = await postJSON(AMFI_FUND_PERF, payload);
      totalCalls++;

      if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
        logger.info(`[FundPerf] cat=${catId} subCat=${subCat.id}(${subCat.name}): ${result.data.length} funds on ${validDateStr}`);
        allRecords.push(...result.data);
      }
    }
  }

  logger.info(`[FundPerf] Adaptive fetch complete. API calls: ${totalCalls}, Total records: ${allRecords.length}, Dates used: ${Array.from(usedDates).join(', ')}`);
  return { records: allRecords, usedDates: Array.from(usedDates) };
}

// ─── AUM Sync ─────────────────────────────────────────────────────────────────

/**
 * Sync AUM from AMFI Fund Performance API.
 * Uses adaptive fetching to accommodate different publishing schedules per category.
 *
 * @returns {number} count of schemes with AUM data
 */
async function syncAUM() {
  logger.info('[FundPerf] Starting adaptive AUM sync from AMFI Fund Performance API...');

  const { records, usedDates } = await fetchAdaptiveFundData(14); // 14 days back to ensure we hit month-end for debt

  if (records.length === 0) {
    throw new Error('[FundPerf] Could not find AUM data for any of the last 14 days');
  }

  const usedDateStr = usedDates.join(', ');

  // Build AUM index: normalised scheme name → AUM in Cr.
  const aumMap       = {};
  // Build IR index: normalised scheme name → { ir1yDirect, ... }
  const irMap        = {};
  // Build Riskometer index: normalised scheme name → SEBI riskometer label
  const riskometerMap = {};

  // Valid SEBI riskometer labels (canonical values from AMFI)
  const VALID_RISKOMETERS = new Set([
    'Low', 'Low to Moderate', 'Moderate', 'Moderately High', 'High', 'Very High',
  ]);

  let count         = 0;
  let irCount       = 0;
  let riskometerCount = 0;

  for (const r of records) {
    if (!r.schemeName) continue;
    const key = normaliseName(r.schemeName);

    // AUM
    const aum = r.dailyAUM;
    if (aum !== null && aum !== undefined && aum > 0) {
      aumMap[key] = Math.round(aum * 100) / 100;
      count++;
    }

    // Information Ratios — AMFI provides these precomputed
    const ir = {};
    const parseIR = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? null : Math.round(n * 1000) / 1000;
    };
    ir.ir1yDirect   = parseIR(r.ir1YrDirect);
    ir.ir3yDirect   = parseIR(r.ir3YrDirect);
    ir.ir5yDirect   = parseIR(r.ir5YrDirect);
    ir.ir10yDirect  = parseIR(r.ir10YrDirect);
    ir.ir1yRegular  = parseIR(r.ir1YrRegular);
    ir.ir3yRegular  = parseIR(r.ir3YrRegular);
    ir.ir5yRegular  = parseIR(r.ir5YrRegular);
    ir.ir10yRegular = parseIR(r.ir10YrRegular);
    if (Object.values(ir).some(v => v !== null)) {
      irMap[key] = ir;
      irCount++;
    }

    // SEBI Riskometer — authoritative, directly from AMFI
    if (r.riskometerScheme && VALID_RISKOMETERS.has(r.riskometerScheme.trim())) {
      riskometerMap[key] = r.riskometerScheme.trim();
      riskometerCount++;
    }
  }

  // Atomic write — AUM
  const aumPayload = JSON.stringify({
    date:      usedDateStr,
    fetchedAt: new Date().toISOString(),
    source:    'AMFI Fund Performance API',
    count,
    data:      aumMap,
  });
  fs.writeFileSync(AUM_JSON_TMP, aumPayload, 'utf-8');
  fs.renameSync(AUM_JSON_TMP, AUM_JSON);
  logger.info(`[FundPerf] AUM: wrote ${count} entries to aum-data.json (dates: ${usedDateStr})`);

  // Atomic write — IR
  const irPayload = JSON.stringify({
    date:      usedDateStr,
    fetchedAt: new Date().toISOString(),
    source:    'AMFI Fund Performance API',
    count:     irCount,
    data:      irMap,
  });
  fs.writeFileSync(IR_JSON_TMP, irPayload, 'utf-8');
  fs.renameSync(IR_JSON_TMP, IR_JSON);
  logger.info(`[FundPerf] IR: wrote ${irCount} entries to ir-data.json (dates: ${usedDateStr})`);

  // Atomic write — Riskometer
  const riskometerPayload = JSON.stringify({
    date:      usedDateStr,
    fetchedAt: new Date().toISOString(),
    source:    'AMFI Fund Performance API (riskometerScheme field)',
    count:     riskometerCount,
    data:      riskometerMap,
  });
  fs.writeFileSync(RISKOMETER_JSON_TMP, riskometerPayload, 'utf-8');
  fs.renameSync(RISKOMETER_JSON_TMP, RISKOMETER_JSON);
  logger.info(`[FundPerf] Riskometer: wrote ${riskometerCount} entries to riskometer-data.json (dates: ${usedDateStr})`);

  // Load into memory
  _aumIndex        = aumMap;
  _aumDate         = usedDateStr;
  _aumCount        = count;
  _irIndex         = irMap;
  _irCount         = irCount;
  _riskometerIndex = riskometerMap;
  _riskometerCount = riskometerCount;

  return count;
}

// ─── Benchmark Sync ───────────────────────────────────────────────────────────

/**
 * Sync per-fund benchmark assignments from AMFI Fund Performance API.
 * Benchmarks are static (set by SEBI/AMFI mandate), so this only re-fetches
 * when benchmark-data.json is missing or older than BENCHMARK_MAX_AGE_DAYS.
 *
 * @returns {number} count of unique scheme-benchmark mappings stored
 */
async function syncBenchmarks() {
  logger.info('[FundPerf] Syncing per-fund benchmarks from AMFI...');

  const { records } = await fetchAdaptiveFundData(14);

  if (records.length === 0) {
    throw new Error('[FundPerf] Could not fetch benchmark data from AMFI');
  }

  // Build benchmark map: normalised name → benchmark name
  const benchMap = {};
  let count = 0;
  for (const r of records) {
    if (!r.schemeName || !r.benchmark) continue;
    const key = normaliseName(r.schemeName);
    benchMap[key] = r.benchmark.trim();
    count++;
  }

  // Atomic write
  const payload = JSON.stringify({
    fetchedAt: new Date().toISOString(),
    source:    'AMFI Fund Performance API',
    count,
    data:      benchMap,
  });
  fs.writeFileSync(BENCHMARK_JSON_TMP, payload, 'utf-8');
  fs.renameSync(BENCHMARK_JSON_TMP, BENCHMARK_JSON);
  logger.info(`[FundPerf] Benchmarks: wrote ${count} entries to benchmark-data.json`);

  _benchmarkIndex = benchMap;
  _benchmarkCount = count;

  return count;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Load AUM data from disk if fresh (<= AUM_MAX_AGE_DAYS), else sync.
 * Also loads IR data from ir-data.json if available.
 */
async function initAUM() {
  let aumCacheValid = false;
  if (fs.existsSync(AUM_JSON)) {
    try {
      const raw  = fs.readFileSync(AUM_JSON, 'utf-8');
      const json = JSON.parse(raw);
      if (json.data && typeof json.data === 'object') {
        const ageMs   = Date.now() - new Date(json.fetchedAt || 0).getTime();
        const ageDays = ageMs / (86400 * 1000);
        if (ageDays < AUM_MAX_AGE_DAYS) {
          // Re-normalise cached keys through the CURRENT normaliseName so any
          // improvement (e.g. & → and) takes effect immediately on restart.
          const renormed = {};
          for (const [oldKey, val] of Object.entries(json.data)) {
            const newKey = normaliseName(oldKey);
            renormed[newKey || oldKey] = val;
          }
          _aumIndex = renormed;
          _aumDate  = json.date || 'unknown';
          _aumCount = json.count || Object.keys(json.data).length;
          logger.info(`[FundPerf] AUM loaded from cache: ${_aumCount} entries (${ageDays.toFixed(1)}d old, date: ${_aumDate})`);
          aumCacheValid = true;
        } else {
          logger.info(`[FundPerf] AUM cache is ${ageDays.toFixed(1)}d old — refreshing...`);
        }
      }
    } catch (err) {
      logger.warn(`[FundPerf] Could not read aum-data.json: ${err.message}`);
    }
  } else {
    logger.info('[FundPerf] aum-data.json not found — syncing...');
  }

  // Also try to load IR from disk cache
  let irCacheValid = false;
  if (aumCacheValid && fs.existsSync(IR_JSON)) {
    try {
      const raw  = fs.readFileSync(IR_JSON, 'utf-8');
      const json = JSON.parse(raw);
      if (json.data && typeof json.data === 'object') {
        const ageMs   = Date.now() - new Date(json.fetchedAt || 0).getTime();
        const ageDays = ageMs / (86400 * 1000);
        if (ageDays < IR_MAX_AGE_DAYS) {
          _irIndex = json.data;
          _irCount = json.count || Object.keys(json.data).length;
          logger.info(`[FundPerf] IR loaded from cache: ${_irCount} entries (${ageDays.toFixed(1)}d old)`);
          irCacheValid = true;
        } else {
          logger.info(`[FundPerf] IR cache is ${ageDays.toFixed(1)}d old — will refresh via syncAUM`);
        }
      }
    } catch (err) {
      logger.warn(`[FundPerf] Could not read ir-data.json: ${err.message}`);
    }
  }

  // Also try to load Riskometer from disk cache
  let riskometerCacheValid = false;
  if (aumCacheValid && fs.existsSync(RISKOMETER_JSON)) {
    try {
      const raw  = fs.readFileSync(RISKOMETER_JSON, 'utf-8');
      const json = JSON.parse(raw);
      if (json.data && typeof json.data === 'object') {
        const ageMs   = Date.now() - new Date(json.fetchedAt || 0).getTime();
        const ageDays = ageMs / (86400 * 1000);
        if (ageDays < RISKOMETER_MAX_AGE_DAYS) {
          _riskometerIndex = json.data;
          _riskometerCount = json.count || Object.keys(json.data).length;
          logger.info(`[FundPerf] Riskometer loaded from cache: ${_riskometerCount} entries (${ageDays.toFixed(1)}d old)`);
          riskometerCacheValid = true;
        } else {
          logger.info(`[FundPerf] Riskometer cache is ${ageDays.toFixed(1)}d old — will refresh via syncAUM`);
        }
      }
    } catch (err) {
      logger.warn(`[FundPerf] Could not read riskometer-data.json: ${err.message}`);
    }
  }

  // If AUM, IR, and Riskometer are all fresh — no network sync needed
  if (aumCacheValid && irCacheValid && riskometerCacheValid) {
    return;
  }

  if (aumCacheValid) {
    // AUM is fresh but IR or Riskometer is missing/stale — refresh via syncAUM
    logger.info('[FundPerf] IR/Riskometer data missing or stale — running syncAUM to refresh...');
  }
  await syncAUM();
}

/**
 * Load benchmark data from disk if fresh, else sync.
 */
async function initBenchmarks() {
  if (fs.existsSync(BENCHMARK_JSON)) {
    try {
      const raw  = fs.readFileSync(BENCHMARK_JSON, 'utf-8');
      const json = JSON.parse(raw);
      if (json.data && typeof json.data === 'object') {
        const ageMs   = Date.now() - new Date(json.fetchedAt || 0).getTime();
        const ageDays = ageMs / (86400 * 1000);
        if (ageDays < BENCHMARK_MAX_AGE_DAYS) {
          _benchmarkIndex = json.data;
          _benchmarkCount = json.count || Object.keys(json.data).length;
          logger.info(`[FundPerf] Benchmarks loaded from cache: ${_benchmarkCount} entries (${ageDays.toFixed(1)}d old)`);
          return;
        }
        logger.info(`[FundPerf] Benchmark cache is ${ageDays.toFixed(1)}d old — refreshing...`);
      }
    } catch (err) {
      logger.warn(`[FundPerf] Could not read benchmark-data.json: ${err.message}`);
    }
  } else {
    logger.info('[FundPerf] benchmark-data.json not found — syncing...');
  }
  await syncBenchmarks();
}

/**
 * Master init: loads both AUM and benchmarks.
 * Called at server startup.
 */
async function initFundPerformance() {
  try {
    await initBenchmarks();
  } catch (err) {
    logger.error('[FundPerf] Benchmark init failed:', err.message);
  }
  try {
    await initAUM();
  } catch (err) {
    logger.error('[FundPerf] AUM init failed:', err.message);
  }
}

// ─── Public Lookups ───────────────────────────────────────────────────────────

/**
 * Get daily AUM (in Crores) for a fund by its scheme name.
 * Tries exact normalised name first, then falls back to partial match.
 *
 * @param {string} schemeName
 * @returns {number|null}
 */
function getAUMByName(schemeName) {
  const v = fuzzyLookup(schemeName, _aumIndex);
  return v !== undefined ? v : null;
}

/**
 * Get benchmark name for a fund by its scheme name.
 * Returns e.g. "Nifty 100 TRI", "BSE 100 TRI", etc.
 *
 * @param {string} schemeName
 * @returns {string|null}
 */
function getBenchmarkByName(schemeName) {
  const v = fuzzyLookup(schemeName, _benchmarkIndex);
  return v !== undefined ? v : null;
}

function getAUMDate()          { return _aumDate; }
function getAUMCount()         { return _aumCount; }
function getBenchmarkCount()   { return _benchmarkCount; }
function getIRCount()          { return _irCount; }
function getRiskometerCount()  { return _riskometerCount; }

/**
 * Get the SEBI-mandated riskometer label for a fund by its scheme name.
 * Returns one of: 'Low' | 'Low to Moderate' | 'Moderate' | 'Moderately High' | 'High' | 'Very High'
 * Returns null if not found.
 *
 * @param {string} schemeName
 * @returns {string|null}
 */
function getRiskometerByName(schemeName) {
  if (!schemeName) return null;
  const key = normaliseName(schemeName);

  // 1. Exact match
  if (_riskometerIndex[key] !== undefined) return _riskometerIndex[key];

  // 2. Substring containment only (strict — no fuzzy token overlap for riskometer
  //    because the index only has equity names; fuzzy would match liquid/debt funds
  //    to equity entries sharing AMC name tokens, giving wrong "Very High" labels)
  for (const [k, v] of Object.entries(_riskometerIndex)) {
    if (k.includes(key) || key.includes(k)) return v;
  }

  return null;
}

/**
 * Returns the full normalised-name → AUM map (for batch assignment at boot).
 */
function getAUMIndex() { return _aumIndex; }

/**
 * Returns the full normalised-name → benchmark map (for batch assignment at boot).
 */
function getBenchmarkIndex() { return _benchmarkIndex; }

/**
 * Get Information Ratios (1Y/3Y/5Y/10Y, Direct + Regular) for a fund by scheme name.
 * Returns object with ir1yDirect, ir3yDirect, ir5yDirect, ir10yDirect (and Regular variants).
 * Returns null if not found.
 *
 * @param {string} schemeName
 * @returns {Object|null}
 */
function getIRByName(schemeName) {
  const v = fuzzyLookup(schemeName, _irIndex);
  return v !== undefined ? v : null;
}

/**
 * Schedule daily AUM + Riskometer refresh at 09:30 IST.
 * AMFI typically publishes the new day's data by 9:30 IST.
 * Benchmark data is refreshed quarterly (90-day cache TTL above).
 *
 * @param {Function} [onSynced] - Optional callback(count) fired after successful sync.
 *                                server.js uses this to re-apply riskometer to allFunds.
 */
function scheduleFundPerformanceCron(onSynced) {
  cron.schedule('30 9 * * *', async () => {
    logger.info('[FundPerf] Cron: daily AUM + Riskometer refresh triggered');
    try {
      const count = await syncAUM();
      logger.info(`[FundPerf] Cron: AUM + Riskometer sync complete — ${count} schemes`);
      if (typeof onSynced === 'function') {
        try { onSynced(count); } catch (cbErr) {
          logger.error('[FundPerf] Cron: onSynced callback error:', cbErr.message);
        }
      }
    } catch (err) {
      logger.error('[FundPerf] Cron: AUM + Riskometer sync FAILED —', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  logger.info('[FundPerf] Daily AUM + Riskometer cron scheduled (09:30 IST)');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  initFundPerformance,
  syncAUM,
  syncBenchmarks,
  normaliseName,
  getAUMByName,
  getBenchmarkByName,
  getIRByName,
  getRiskometerByName,
  getAUMIndex,
  getBenchmarkIndex,
  getAUMDate,
  getAUMCount,
  getBenchmarkCount,
  getIRCount,
  getRiskometerCount,
  scheduleFundPerformanceCron,
};
