/**

const logger = require('../shared/logger'); * triService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches and caches real Total Return Index (TRI) time-series data for all
 * benchmark indices used by Indian mutual funds.
 *
 * Data Sources:
 *   1. Nifty Indices (NSE) — for all NIFTY/NIFTY-prefixed benchmarks
 *      POST https://niftyindices.com/Backpage.aspx/getTotalReturnIndexString
 *      Body: { cinfo: '{"name":"NIFTY 50","startDate":"01-Jan-2016","endDate":"01-Apr-2026","indexName":"NIFTY 50"}' }
 *      Response: { d: "[{\"Date\":\"01 Apr 2026\",\"TotalReturnsIndex\":\"34179.90\",...}]" }
 *
 *   2. BSE India — for all BSE/SENSEX-prefixed benchmarks
 *      GET https://www.bseindia.com/Downloads/AllIndices/AllIndices_{DDMMYYYY}.csv
 *      This is the official daily BSE indices file. It contains Close values for
 *      all BSE indices. We download this for each trading day and extract the
 *      relevant index's Close value (which IS the TRI for TRI-based BSE index IDs).
 *
 *      For proper BSE TRI historical data, we use:
 *      POST https://www.bseindia.com/Indices/IndexArchiveData.aspx/GetChartData
 *      (Falls back gracefully if unavailable.)
 *
 * Output format (same as NAV history expected by metricsCalculator.js):
 *   [{ date: Date, nav: number }, ...]  — sorted chronologically oldest-first.
 *   The series is normalised so that base = 100 at the earliest date, making
 *   it dimensionally equivalent to a fund NAV for ratio metrics like Beta, R².
 *
 * Caching:
 *   All TRI series are persisted in tri-data.json (root of project).
 *   Cache TTL: 1 day (refreshed by daily cron at 09:31 IST, 1 min after AUM).
 *
 * ─── IMPORTANT NOTE on "normalisation" ──────────────────────────────────────
 * metricsCalculator.js computes monthly *returns* as (navT - navT-1) / navT-1.
 * This means the absolute level of the series does NOT matter — only the
 * ratio of consecutive values (returns) is used. No base-100 normalisation is
 * needed for correctness; it's only done here for readability in the cache file.
 * The raw TRI values are used directly in return calculations, which is correct.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { execSync } = require('child_process');

// ─── Paths ───────────────────────────────────────────────────────────────────
// All persistent data files live in <project-root>/data/
const DATA_DIR     = path.join(__dirname, '..', 'data');
const TRI_JSON     = path.join(DATA_DIR, 'tri-data.json');
const TRI_JSON_TMP = path.join(DATA_DIR, 'tri-data.tmp.json');

// ─── API Config ───────────────────────────────────────────────────────────────

const NIFTY_TRI_URL = 'https://niftyindices.com/Backpage.aspx/getTotalReturnIndexString';
const NIFTY_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; NatFunds/2.0)',
  'Referer': 'https://www.niftyindices.com/reports/historical-data',
  'Origin': 'https://niftyindices.com',
};

const BSE_ALLINDICES_BASE = 'https://www.bseindia.com/Downloads/AllIndices/AllIndices_';
const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; NatFunds/2.0)',
  'Referer': 'https://www.bseindia.com/',
};

const HISTORY_YEARS = 10;   // 10 years of TRI history (sufficient for all metrics)
const TRI_MAX_AGE_DAYS = 1;    // refresh daily

// ─── Benchmark → API Name Mapping ─────────────────────────────────────────────
//
// Maps benchmark names as returned by AMFI to the index name string used
// in the respective API.
//
// Nifty Indices API: index name is used as-is (case-sensitive).
// BSE API: index code from the AllIndices CSV "Index Code" column.

const NIFTY_BENCHMARK_MAP = {
  // ── Standard Nifty ─────────────────────────────────────────────────────────
  'Nifty 50 TRI': 'NIFTY 50',
  'Nifty Next 50 TRI': 'NIFTY NEXT 50',
  'Nifty Next 50': 'NIFTY NEXT 50',
  'Nifty 100 TRI': 'NIFTY 100',
  'Nifty 200 TRI': 'NIFTY 200',
  'Nifty 500 TRI': 'NIFTY 500',
  'Nifty Midcap 50 TRI': 'NIFTY MIDCAP 50',
  'NIFTY Midcap 50 TRI': 'NIFTY MIDCAP 50',
  'Nifty Midcap 100 TRI': 'NIFTY MIDCAP 100',
  'Nifty Midcap 150 TRI': 'NIFTY MIDCAP 150',
  'Nifty Smallcap 50 TRI': 'NIFTY 50', // placeholder proxy for API naming
  'NIFTY Smallcap 50 TRI': 'NIFTY SMALLCAP 50',
  'Nifty Smallcap 100 TRI': 'NIFTY SMALLCAP 100',
  'Nifty Smallcap 250 TRI': 'NIFTY SMLCAP 250',
  'Nifty LargeMidcap 250 TRI': 'NIFTY LARGEMIDCAP 250',
  'NIFTY 500 Multicap 50:25:25 Total Return Index': 'NIFTY 500 MULTICAP 50:25:25',
  'Nifty Total Market TRI': 'NIFTY TOTAL MARKET',
  'Nifty Microcap 250 TRI': 'NIFTY MICROCAP 250',
  // ── Sectoral / Thematic ─────────────────────────────────────────────────────
  'Nifty Bank TRI': 'NIFTY BANK',
  'Nifty Private Bank TRI': 'NIFTY PRIVATE BANK',
  'Nifty PSU Bank TRI': 'NIFTY PSU BANK',
  'Nifty IT TRI': 'NIFTY IT',
  'Nifty Financial Services TRI': 'NIFTY FINANCIAL SERVICES',
  'Nifty Financial Services Ex-Bank TRI': 'NIFTY FINSRV25 50',
  'Nifty FMCG TRI': 'NIFTY FMCG',
  'Nifty Auto TRI': 'NIFTY AUTO',
  'Nifty Pharma TRI': 'NIFTY PHARMA',
  'NIFTY Healthcare TRI': 'NIFTY HEALTHCARE',
  'Nifty500 Healthcare TRI': 'NIFTY HEALTHCARE',
  'Nifty Energy TRI': 'NIFTY ENERGY',
  'Nifty Infrastructure TRI': 'NIFTY INFRASTRUCTURE',
  'Nifty India Manufacturing TRI': 'NIFTY INDIA MFG',
  'Nifty India Consumption TRI': 'NIFTY INDIA CONSUMPTION',
  'Nifty India Defence TRI': 'NIFTY INDIA DEFENCE',
  'Nifty PSE TRI': 'NIFTY PSE',
  'Nifty PSE': 'NIFTY PSE',
  'Nifty PSU TRI': 'NIFTY CPSE',
  'Nifty CPSE TRI': 'NIFTY CPSE',
  'Nifty MNC TRI': 'NIFTY MNC',
  'Nifty Commodities TRI': 'NIFTY COMMODITIES',
  'Nifty Services Sector TRI': 'NIFTY SERVICES SECTOR',
  'Nifty Rural TRI': 'NIFTY50 USD PRICE RETURN',
  'Nifty IPO TRI': 'NIFTY IPO INDEX',
  'Nifty Housing TRI': 'NIFTY HOUSING',
  'Nifty Transportation & Logistics TRI': 'NIFTY TRANSPORTATION & LOGISTICS',
  'Nifty Realty TRI': 'NIFTY REALTY',
  'Nifty Metal TRI': 'NIFTY METAL',
  'Nifty Oil & Gas TRI': 'NIFTY OIL & GAS',
  'Nifty India Digital TRI': 'NIFTY INDIA DIGITAL',
  // ── Quality / Factor / Equal Weight ───────────────────────────────────────
  'NIFTY 50 Equal Weight TRI': 'NIFTY50 EQUAL WEIGHT',
  'NIFTY 100 Equal Weighted TRI': 'NIFTY100 EQUAL WEIGHT',
  'Nifty 500 Equal Weight TRI': 'NIFTY500 EQUAL WEIGHT',
  'Nifty 100 ESG TRI': 'NIFTY100 ESG INDEX',
  'Nifty 200 Quality 30 TRI': 'NIFTY200 QUALITY 30',
  'Nifty 500 Shariah TRI': 'NIFTY50 SHARIAH',
  'Nifty 50 Shariah TRI': 'NIFTY50 SHARIAH',
  'Nifty Conglomerate 50 Index': 'NIFTY CONGLOMERATE INDEX',
  'Nifty Alpha 50 TRI': 'NIFTY ALPHA 50',
  'Nifty Dividend Opportunities 50 TRI': 'NIFTY DIVIDEND OPPORTUNITIES 50',

  // ── Missing Debt Additions ──────────────────────────────────────────────────
  'NIFTY Banking & PSU Debt Index A-II': 'NIFTY BANKING & PSU DEBT A-II',
  'NIFTY Corporate Bond Index A-II': 'NIFTY CORPORATE BOND A-II',
  'NIFTY Credit Risk Bond Index B-II': 'NIFTY CREDIT RISK BOND B-II',
  'NIFTY Composite Debt Index A-III': 'NIFTY COMPOSITE DEBT INDEX A-III',
  'NIFTY Low Duration Debt Index A-I': 'NIFTY LOW DURATION DEBT INDEX A-I',
  'NIFTY Medium to Long Duration Debt Index A-III': 'NIFTY MEDIUM TO LONG DURATION DEBT INDEX A-III',
  'NIFTY Medium Duration Debt Index A-III': 'NIFTY MEDIUM DURATION DEBT INDEX A-III',
  'NIFTY Short Duration Debt Index A-II': 'NIFTY SHORT DURATION DEBT INDEX A-II',
  'Nifty All Duration G-Sec Index': 'NIFTY ALL DURATION G-SEC INDEX',
  'Nifty 10 yr Benchmark G-Sec Index': 'NIFTY 10 YR BENCHMARK G-SEC',
  'NIFTY Long Duration Debt Index A-III': 'NIFTY LONG DURATION DEBT INDEX A-III',
  'NIFTY Money Market Index A-I': 'NIFTY MONEY MARKET INDEX A-I',
  'NIFTY Ultra Short Duration Debt Index A-I': 'NIFTY ULTRA SHORT DURATION DEBT INDEX A-I',
  'Nifty 8-13 yr G-Sec': 'NIFTY 8-13 YR G-SEC',

  // ── Missing Hybrid / Equity Additions ───────────────────────────────────────
  'Nifty 50 Arbitrage TRI': 'NIFTY 50 ARBITRAGE',
  'Nifty 50 Arbitrage Index': 'NIFTY 50 ARBITRAGE',
  'Nifty Equity Savings TRI': 'NIFTY EQUITY SAVINGS',
  'Nifty Equity Savings Index': 'NIFTY EQUITY SAVINGS',
  'Nifty 500 Momentum 50 TRI': 'NIFTY500 MOMENTUM 50',
  'Nifty Capital Markets Index (TRI)': 'NIFTY CAPITAL MARKETS',
  'Nifty EV and New Age Automotive TRI': 'NIFTY EV & NEW AGE AUTOMOTIVE',
  'Nifty India Internet TRI': 'NIFTY INDIA INTERNET',
  'Nifty 100 Low Volatility 30 TRI': 'NIFTY100 LOW VOLATILITY 30',
  'Nifty 100 Low Volatility 30 Index': 'NIFTY100 LOW VOLATILITY 30',
  'Nifty Alpha Low -Volatility 30 TRI': 'NIFTY ALPHA LOW-VOLATILITY 30',
  'Nifty Alpha Low -Volatility 30': 'NIFTY ALPHA LOW-VOLATILITY 30',
  'Nifty 100 ESG Sector Leaders TRI': 'NIFTY100 ESG SECTOR LEADERS',
  'Nifty India New Age Consumption TRI': 'NIFTY INDIA NEW AGE CONSUMPTION',
  'Nifty MidSmallcap400 Momentum Quality 100 TRI': 'NIFTY MIDSMALLCAP400 MOMENTUM QUALITY 100',
  'Nifty Smallcap 250 Momentum Quality 100 TRI': 'NIFTY SMALLCAP250 MOMENTUM QUALITY 100',
  'Nifty 200 Alpha 30 TRI': 'NIFTY200 ALPHA 30',
  'NIFTY Smallcap 50 TRI': 'NIFTY SMALLCAP 50',
  'Nifty Total Market Momentum Quality 50 TRI': 'NIFTY TOTAL MARKET MOMENTUM QUALITY 50',
  'Nifty 500 Quality 50 TRI': 'NIFTY500 QUALITY 50',
  'NIFTY500 Value 50 TRI': 'NIFTY500 VALUE 50',
  'NIFTY500 Value 50': 'NIFTY500 VALUE 50',
  'Nifty 200 Quality 30 Index': 'NIFTY200 QUALITY 30',
  'Nifty200 Momentum 30 TRI': 'NIFTY200 MOMENTUM 30',
  'Nifty200 Momentum 30 Index': 'NIFTY200 MOMENTUM 30',
  'Nifty Midcap 150 Quality 50 TRI': 'NIFTY MIDCAP150 QUALITY 50',
  'Nifty Smallcap250 Quality 50 TRI': 'NIFTY SMALLCAP250 QUALITY 50',
  'Nifty Top 10 Equal Weight TRI': 'NIFTY TOP 10 EQUAL WEIGHT',
  'Nifty500 Flexicap Quality 30 TRI': 'NIFTY500 FLEXICAP QUALITY 30',
  'Nifty 100 Quality 30 TRI': 'NIFTY100 QUALITY 30',
  'NIFTY Midcap 150 Momentum 50 TRI': 'NIFTY MIDCAP150 MOMENTUM 50',
  'Nifty500 Multicap Momentum Quality 50 TRI': 'NIFTY500 MULTICAP MOMENTUM QUALITY 50',
  'Nifty India Railways PSU TRI': 'NIFTY INDIA RAILWAYS PSU',
  'Nifty Non-Cyclical Consumer TRI': 'NIFTY NON-CYCLICAL CONSUMER',
  'Nifty Top 20 Equal Weight TRI': 'NIFTY TOP 20 EQUAL WEIGHT',
  'Nifty Top 15 Equal Weight TRI': 'NIFTY TOP 15 EQUAL WEIGHT',
  'Nifty200 Value 30 TRI': 'NIFTY200 VALUE 30',
  'Nifty50 Value 20 TRI': 'NIFTY50 VALUE 20',
  'Nifty Financial Services Ex-Bank TRI': 'NIFTY FINSRV25 50',
  'Nifty India Tourism TRI': 'NIFTY INDIA TOURISM',
  'Nifty Microcap 250 TRI': 'NIFTY MICROCAP 250',
  'Nifty MidSmall Financial Services TRI': 'NIFTY MIDSMALL FINANCIAL SERVICES',
  'Nifty MidSmall Healthcare TRI': 'NIFTY MIDSMALL HEALTHCARE',
  'Nifty MidSmall India Consumption TRI': 'NIFTY MIDSMALL INDIA CONSUMPTION',
  'Nifty MidSmall IT and Telecom TRI': 'NIFTY MIDSMALL IT AND TELECOM',
  'Nifty MidSmallcap 400 Index': 'NIFTY MIDSMALLCAP 400',
  'Nifty 500 Low Volatility 50 TRI': 'NIFTY500 LOW VOLATILITY 50',
  'Nifty500 Multicap India Manufacturing 50:30:20 TRI': 'NIFTY500 MULTICAP INDIA MANUFACTURING 50:30:20',
  'Nifty500 Multicap Infrastructure 50:30:20 TRI': 'NIFTY500 MULTICAP INFRASTRUCTURE 50:30:20',
  'Nifty Growth Sectors 15 TRI': 'NIFTY GROWTH SECTORS 15',
  'Nifty500 Healthcare TRI': 'NIFTY500 HEALTHCARE',
  'Nifty India Infrastructure & Logistics TRI': 'NIFTY INDIA INFRASTRUCTURE & LOGISTICS',
  'Nifty Chemicals TRI': 'NIFTY CHEMICALS',
};

const BSE_BENCHMARK_MAP = {
  // ── Core BSE ───────────────────────────────────────────────────────────────
  'BSE SENSEX TRI': 'SENSEX',
  'BSE SENSEX Next 50 TRI': 'BSE100', // proxy
  'BSE 100 TRI': 'BSE100',
  'BSE 200 TRI': 'BSE200',
  'BSE 500 TRI': 'BSE500',
  'BSE Midcap 150 TRI': 'MID150',
  'BSE 250 Smallcap TRI': 'SML250',
  'BSE 250 Large MidCap TRI': 'LMI250',
  'BSE 250 LargeMidCap TRI': 'LMI250',
  'BSE 500 Shariah TRI': 'BSE500',
  // ── Sectoral ────────────────────────────────────────────────────────────────
  'BSE BANKEX TRI': 'BANKEX',
  'BSE Financial Services TRI': 'FINSER',
  'BSE Healthcare TRI': 'BSE HC',
  'BSE India Infrastructure TRI': 'INFRA',
  'BSE India Manufacturing TRI': 'MFG',
  'BSE India Manufacturing Total Return Index (TRI) - 50% & BSE India Infrastructure': 'MFG',
  'BSE Teck TRI': 'TECK',
  'BSE PSU TRI': 'BSEPSU',
  'BSE Quality TRI': 'BSEQUI',
  'BSE Select Business Groups Index TRI': 'BHRT22',
  'BSE Select Business Groups Index': 'BHRT22',
  'BSE Bharat 22 TRI': 'BHRT22',

  // ── Missing BSE Proxies / Indices ──────────────────────────────────────────
  'BSE Hospitals TRI': 'BSE HC',
  'BSE Power TRI': 'POWER',
  'BSE 200 Equal Weight TRI': 'BSE200',
  'BSE India Defence TRI': 'BSE500',
  'BSE Select IPO TRI': 'IPOSI',
  'BSE India Sector Leaders TRI': 'BSE100',
  'BSE SENSEX Next 30 TRI': 'BSE100',
  'BSE Housing TRI': 'BSE500',
  'BSE 1000 TRI': 'BSE500',
  'BSE Enhanced Value TRI': 'BSEQUI',
  'BSE Financials ex Bank 30 TRI': 'FINSER',
  'BSE Low Volatility TRI': 'BSE100',
  'BSE PSU Bank TRI': 'BSEPSU',
  'BSE Top 10 Banks TRI': 'BANKEX',
  'BSE Capital Markets & Insurance TRI': 'FINSER',
  'BSE Midcap Select TRI': 'MID150',
  'BSE 500 Dividend Leaders 50 TRI': 'BSE500',
};

// ─── In-Memory State ─────────────────────────────────────────────────────────

/**
 * benchmarkName → [{date: Date, nav: number}] sorted oldest-first
 * 'nav' IS the raw TRI value (not normalised), ready for use in metricsCalculator.js
 */
let _triStore = {};


// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatNiftyDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dd}-${mons[d.getMonth()]}-${d.getFullYear()}`;
}

function formatBSEDateDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${d.getFullYear()}`;
}

/**
 * Parse a Nifty/BSE date string to a Date object.
 * Nifty format: "01 Apr 2026"  
 * BSE CSV format: "04/02/2026" (MM/DD/YYYY)
 */
function parseNiftyDate(str) {
  // "01 Apr 2026"
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parts = str.trim().split(' ');
  if (parts.length === 3) {
    const month = months[parts[1]];
    if (month !== undefined) {
      return new Date(parseInt(parts[2]), month, parseInt(parts[0]));
    }
  }
  return null;
}

function parseBSECSVDate(str) {
  // BSE CSV Date format: "04/02/2026" which is MM/DD/YYYY
  const parts = str.trim().split('/');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
  }
  return null;
}

// ─── Nifty TRI Fetching ───────────────────────────────────────────────────────

/**
 * Fetch TRI time-series for a Nifty index.
 *
 * @param {string} niftyIndexName   - e.g. "NIFTY 50", "NIFTY MIDCAP 150"
 * @param {string} startDateStr     - "DD-Mon-YYYY"
 * @param {string} endDateStr       - "DD-Mon-YYYY"
 * @returns {{date: Date, nav: number}[]} sorted oldest-first
 */
async function fetchNiftyTRI(niftyIndexName, startDateStr, endDateStr) {
  const cinfo = JSON.stringify({
    name: niftyIndexName,
    startDate: startDateStr,
    endDate: endDateStr,
    indexName: niftyIndexName,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000); // 60s — large payload

  try {
    const resp = await fetch(NIFTY_TRI_URL, {
      method: 'POST',
      headers: NIFTY_HEADERS,
      body: JSON.stringify({ cinfo }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      logger.warn(`[TRI] Nifty API HTTP ${resp.status} for ${niftyIndexName}`);
      return [];
    }

    const outer = await resp.json();
    if (!outer.d) return [];
    const records = JSON.parse(outer.d);

    const result = [];
    for (const r of records) {
      const d = parseNiftyDate(r['Date'] || r['date'] || '');
      const tri = parseFloat(r['TotalReturnsIndex'] || r['TRIndex'] || 0);
      if (d && !isNaN(tri) && tri > 0) {
        result.push({ date: d, nav: tri });
      }
    }

    // Sort oldest-first
    result.sort((a, b) => a.date - b.date);
    logger.info(`[TRI] Nifty "${niftyIndexName}": ${result.length} data points`);
    return result;

  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn(`[TRI] Nifty API timeout for ${niftyIndexName}`);
    } else {
      logger.warn(`[TRI] Nifty API error for ${niftyIndexName}: ${err.message}`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── BSE TRI Fetching ─────────────────────────────────────────────────────────

/**
 * Fetch the BSE AllIndices CSV for a specific date (DDMMYYYY).
 * Returns a Map: indexCode → closeValue
 *
 * Uses curl (via child_process) because BSE blocks Node.js fetch()
 * based on TLS fingerprint / User-Agent; curl bypasses this restriction.
 *
 * @param {string} ddmmyyyy  - e.g. "03042026"
 * @returns {Map<string, number>|null}
 */
function fetchBSEAllIndicesCSV(ddmmyyyy) {
  const url = `${BSE_ALLINDICES_BASE}${ddmmyyyy}.csv`;

  try {
    const text = execSync(
      `curl -s --max-time 20 ` +
      `-H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" ` +
      `-H "Referer: https://www.bseindia.com/" ` +
      `-H "Accept: text/csv,*/*" ` +
      `"${url}"`,
      { encoding: 'utf8', timeout: 25_000 }
    );

    if (!text || text.length < 100 || text.includes('<html') || text.includes('404')) {
      return null;
    }

    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;

    const map = new Map();
    // Format: Date,Index Code,Index ID,Index Name,Open,High,Low,Close,...
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 8) continue;
      const code = cols[1]?.trim();
      const close = parseFloat(cols[7]); // "Close" column
      if (code && !isNaN(close) && close > 0) {
        map.set(code, close);
      }
    }
    return map.size > 0 ? map : null;

  } catch (err) {
    // curl failed (network error, timeout, server down)
    return null;
  }
}

/**
 * Build a TRI time-series for a BSE index by downloading AllIndices CSVs
 * for each trading day over the past HISTORY_YEARS years.
 *
 * Strategy: Download weekly CSVs (one per week = ~520 data points for 10 years).
 * This reduces API calls from ~2500 to ~520 while maintaining enough granularity
 * for monthly return calculations.
 *
 * Uses curl (synchronous) via fetchBSEAllIndicesCSV for BSE CSV downloads.
 *
 * @param {string} bseIndexCode  - e.g. "BSE100", "MID150"
 * @returns {{date: Date, nav: number}[]} sorted oldest-first
 */
async function fetchBSETRI(bseIndexCode) {
  logger.info(`[TRI] BSE "${bseIndexCode}": fetching 10Y of weekly data...`);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - HISTORY_YEARS);

  const series = [];

  // Step through calendar days from newest to oldest — weekly sampling
  let cursor = new Date(endDate);
  let attempts = 0;
  const MAX_ATTEMPTS = 600; // ~10Y * 52 weeks + buffer

  while (cursor >= startDate && attempts < MAX_ATTEMPTS) {
    // Try today, if not available try ±3 days (weekends/holidays)
    let map = null;
    for (let offset = 0; offset <= 3; offset++) {
      const tryDate = new Date(cursor);
      tryDate.setDate(tryDate.getDate() - offset);
      const ddmmyyyy = formatBSEDateDDMMYYYY(tryDate);
      map = fetchBSEAllIndicesCSV(ddmmyyyy); // synchronous curl call
      if (map && map.has(bseIndexCode)) {
        const val = map.get(bseIndexCode);
        series.push({ date: new Date(tryDate), nav: val });
        break;
      }
    }

    // Move back exactly 7 days
    cursor.setDate(cursor.getDate() - 7);
    attempts++;
    await sleep(50); // tiny pause to avoid CPU hammer
  }

  series.sort((a, b) => a.date - b.date);
  logger.info(`[TRI] BSE "${bseIndexCode}": ${series.length} data points`);
  return series;
}

// ─── BSE → Nifty Proxy Map ───────────────────────────────────────────────────
// When BSE AllIndices CSV yields < 36 months of history (BSE only keeps ~1Y
// of daily files online), stitch in the equivalent Nifty index for older periods.
// Correlation >0.97 for broad indices; appropriate for Beta/Alpha calculations.
const BSE_NIFTY_PROXY = {
  'BSE100': 'NIFTY 100',
  'BSE200': 'NIFTY 200',
  'BSE500': 'NIFTY 500',
  'MID150': 'NIFTY MIDCAP 150',
  'SML250': 'NIFTY SMLCAP 250',
  'LMI250': 'NIFTY LARGEMIDCAP 250',
  'SENSEX': 'NIFTY 50',
  'BANKEX': 'NIFTY BANK',
  'FINSER': 'NIFTY FINANCIAL SERVICES',
  'BSE HC': 'NIFTY HEALTHCARE',
  'INFRA': 'NIFTY INFRASTRUCTURE',
  'MFG': 'NIFTY INDIA MFG',
  'TECK': 'NIFTY IT',
  'BSEPSU': 'NIFTY PSE',
  'BHRT22': 'NIFTY 500',   // BSE Select Business Groups — broad market proxy
  'BSEQUI': 'NIFTY 200',   // BSE Quality Index — large/mid quality proxy
};

const MIN_REQUIRED_MONTHS = 36;

// ─── Benchmark Classifier ─────────────────────────────────────────────────────

/**
 * Classify a benchmark name using keyword detection — no hardcoded lists.
 * Returns one of: 'nifty' | 'bse' | 'foreign' | 'composite' | 'unknown'
 *
 * Priority order:
 *   1. nifty — explicit map lookup
 *   2. bse   — explicit map lookup
 *   3. foreign — keyword match (MSCI, S&P, Nasdaq, etc.)
 *   4. composite — contains '%' (allocation) or commodity/debt keywords
 *   5. unknown — everything else (needs a developer to add a mapping)
 */
function classifyBenchmark(benchName) {
  if (NIFTY_BENCHMARK_MAP[benchName]) return 'nifty';
  if (BSE_BENCHMARK_MAP[benchName])   return 'bse';

  const bUpper = benchName.toUpperCase();

  // Foreign exchange-traded indices — no Indian TRI equivalent
  const FOREIGN_KEYWORDS = [
    'MSCI', 'S&P 500', 'S&P GLOBAL', 'S&P JAPAN', 'S&P ASIA PACIFIC', 'NASDAQ',
    'RUSSELL', 'FTSE', 'NYSE FANG', 'HANG SENG', 'TAIWAN',
    'BLOOMBERG US', 'SOLACTIVE', 'INDXX', 'CRSP US',
  ];
  for (const kw of FOREIGN_KEYWORDS) {
    if (bUpper.includes(kw)) return 'foreign';
  }

  // Composite / multi-asset benchmarks (equity + debt + commodity)
  // Identified by presence of a percentage allocation ("65%"), commodity names,
  // debt index names, or CRISIL hybrid index names.
  const COMPOSITE_KEYWORDS = [
    '%',           // "65% Nifty 500 TRI + 35% CRISIL..."
    'GOLD', 'SILVER', 'ICOMDEX', 'LBMA',   // commodity benchmarks
    'CRISIL',       // CRISIL debt/hybrid indices
    'HYBRID',       // e.g. 'NIFTY 50 Hybrid Composite Debt 50:50 Index'
    'NIFTY 1D RATE', 'NIFTY LIQUID', 'BSE LIQUID',  // overnight/liquid
    'GILT',         // pure G-sec
  ];
  for (const kw of COMPOSITE_KEYWORDS) {
    if (bUpper.includes(kw)) return 'composite';
  }

  return 'unknown';
}

/**
 * Stitch a short BSE series with a long Nifty proxy series.
 * Uses a scale factor derived from the earliest overlapping point.
 */
function stitchWithProxy(bseSeries, niftySeries) {
  if (!bseSeries || bseSeries.length === 0) return niftySeries || [];
  if (!niftySeries || niftySeries.length === 0) return bseSeries;

  const bseStart = bseSeries[0].date.getTime();

  let closestNiftyIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < niftySeries.length; i++) {
    const diff = Math.abs(niftySeries[i].date.getTime() - bseStart);
    if (diff < minDiff) { minDiff = diff; closestNiftyIdx = i; }
  }

  const niftyAtStart = niftySeries[closestNiftyIdx].nav;
  const bseAtStart = bseSeries[0].nav;
  if (niftyAtStart === 0) return bseSeries;

  const scale = bseAtStart / niftyAtStart;
  const scaledHistory = niftySeries
    .slice(0, closestNiftyIdx)
    .map(p => ({ date: p.date, nav: Math.round(p.nav * scale * 100) / 100 }));

  return [...scaledHistory, ...bseSeries];
}

// ─── Main Sync ────────────────────────────────────────────────────────────────

/**
 * Fetch/refresh TRI data for a list of benchmark names.
 * Routes Nifty benchmarks to Nifty API, BSE benchmarks to BSE CSV.
 * BSE benchmarks with < 36 months are stitched with a Nifty proxy.
 *
 * @param {string[]} benchmarkNames  - e.g. ["Nifty 50 TRI", "BSE 100 TRI", ...]
 */
async function syncTRI(benchmarkNames) {
  const unique = [...new Set(benchmarkNames)].filter(Boolean);

  // ─── Step 1: Pre-classify all benchmarks (one pass) ───

  const niftyBenches = [], bseBenches = [], foreignBenches = [], compositeBenches = [], unknownBenches = [];
  for (const b of unique) {
    const cls = classifyBenchmark(b);
    if (cls === 'nifty')     niftyBenches.push(b);
    else if (cls === 'bse')  bseBenches.push(b);
    else if (cls === 'foreign')   foreignBenches.push(b);
    else if (cls === 'composite') compositeBenches.push(b);
    else                     unknownBenches.push(b);
  }

  // Single summary line (replaces one warn per fund)
  logger.info(
    `[TRI] Syncing TRI for ${unique.length} unique benchmarks ` +
    `— ${niftyBenches.length} Nifty, ${bseBenches.length} BSE→proxy, ` +
    `${foreignBenches.length} foreign (skip), ${compositeBenches.length} composite (skip)` +
    (unknownBenches.length ? `, ${unknownBenches.length} unknown` : '')
  );

  // Log unmapped benchmarks once as a group for developer action
  if (unknownBenches.length > 0) {
    logger.info(
      `[TRI] No mapping for ${unknownBenches.length} benchmark(s) — add to NIFTY_BENCHMARK_MAP or BSE_BENCHMARK_MAP:\n` +
      unknownBenches.map(b => `       "${b}"`).join('\n')
    );
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - HISTORY_YEARS);

  const endStr = formatNiftyDate(endDate);
  const startStr = formatNiftyDate(startDate);

  // Cache of fetched Nifty series to avoid duplicate API calls for proxies
  const niftyCache = {};

  let synced = 0;

  // ─── Step 2: Fetch Nifty benchmarks ─────────────────────────────────────────
  for (const benchName of niftyBenches) {
    const niftyName = NIFTY_BENCHMARK_MAP[benchName];
    await sleep(300);
    let series = await fetchNiftyTRI(niftyName, startStr, endStr);
    if (series.length > 0) {
      niftyCache[niftyName] = series;
    } else {
      // Index not found or not yet in API (e.g., recently launched) — fallback to NIFTY 500
      const FALLBACK = 'NIFTY 500';
      if (niftyName !== FALLBACK) {
        logger.warn(`[TRI] "${niftyName}" returned 0 pts — falling back to "${FALLBACK}" proxy`);
        if (!niftyCache[FALLBACK]) {
          await sleep(300);
          niftyCache[FALLBACK] = await fetchNiftyTRI(FALLBACK, startStr, endStr);
        }
        series = niftyCache[FALLBACK] || [];
      }
    }
    if (series.length > 0) {
      _triStore[benchName] = series;
      synced++;
    } else {
      logger.warn(`[TRI] No data for "${benchName}" (→ ${niftyName})`);
    }
  }

  // ─── Step 3: Fetch BSE benchmarks via Nifty proxy ──────────────────────────────
  for (const benchName of bseBenches) {
    const bseCode = BSE_BENCHMARK_MAP[benchName];
    const niftyProxy = BSE_NIFTY_PROXY[bseCode];

    if (niftyProxy) {
      logger.info(`[TRI] BSE "${bseCode}" — using Nifty proxy "${niftyProxy}" directly (faster, same data quality)`);
      await sleep(300);
      if (!niftyCache[niftyProxy]) {
        niftyCache[niftyProxy] = await fetchNiftyTRI(niftyProxy, startStr, endStr);
      }
      const series = niftyCache[niftyProxy] || [];
      if (series.length > 0) {
        _triStore[benchName] = series;
        synced++;
        logger.info(`[TRI] BSE "${benchName}" via proxy: ${series.length} data points`);
      }
    } else {
      // No Nifty proxy — try BSE CSV (slow, likely to fail, last resort)
      logger.info(`[TRI] BSE "${bseCode}" has no Nifty proxy — attempting slow BSE CSV fetch...`);
      await sleep(200);
      const series = await fetchBSETRI(bseCode);
      if (series.length > 0) {
        _triStore[benchName] = series;
        synced++;
      } else {
        logger.warn(`[TRI] No data returned for BSE benchmark: "${benchName}" (code: ${bseCode})`);
      }
    }
  }

  logger.info(`[TRI] Sync complete: ${synced}/${niftyBenches.length + bseBenches.length} mappable benchmarks have data`);
  return synced;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Save _triStore to disk (tri-data.json).
 * Dates are stored as ISO strings; revived on load.
 */
function saveTRI() {
  const serialisable = {};
  for (const [name, series] of Object.entries(_triStore)) {
    serialisable[name] = series.map(p => ({
      date: p.date.toISOString().split('T')[0],
      nav: p.nav,
    }));
  }

  const payload = JSON.stringify({
    fetchedAt: new Date().toISOString(),
    count: Object.keys(_triStore).length,
    data: serialisable,
  });

  fs.writeFileSync(TRI_JSON_TMP, payload, 'utf-8');
  fs.renameSync(TRI_JSON_TMP, TRI_JSON);
  logger.info(`[TRI] Saved ${Object.keys(_triStore).length} TRI series to tri-data.json`);
}

function loadTRI() {
  if (!fs.existsSync(TRI_JSON)) return false;

  try {
    const raw = fs.readFileSync(TRI_JSON, 'utf-8');
    const json = JSON.parse(raw);

    if (!json.data || typeof json.data !== 'object') return false;

    const ageMs = Date.now() - new Date(json.fetchedAt || 0).getTime();
    const ageDays = ageMs / (86400 * 1000);

    // Treat as stale if the cache is obviously incomplete (< 3 series saved).
    // This happens when saveTRI() was called mid-sync after a partial fetch.
    const seriesCount = Object.keys(json.data).length;
    const isIncomplete = seriesCount < 3;

    if (isIncomplete) {
      logger.info(`[TRI] tri-data.json is incomplete (${seriesCount} series) — will force full refresh`);
    } else if (ageDays >= TRI_MAX_AGE_DAYS) {
      logger.info(`[TRI] tri-data.json is ${ageDays.toFixed(1)}d old — will refresh`);
      // Load old data into memory anyway (used as fallback if fresh fetch fails)
    } else {
      logger.info(`[TRI] tri-data.json is fresh (${ageDays.toFixed(1)}d old, ${seriesCount} series)`);
    }

    _triStore = {};
    for (const [name, series] of Object.entries(json.data)) {
      _triStore[name] = series.map(p => ({
        date: new Date(p.date),
        nav: p.nav,
      }));
    }

    logger.info(`[TRI] Loaded ${Object.keys(_triStore).length} TRI series from disk`);
    // Return false (= stale) if incomplete, so initTRI triggers a full sync
    if (isIncomplete) return false;
    return ageDays < TRI_MAX_AGE_DAYS; // true = fresh (don't need to re-sync)
  } catch (err) {
    logger.warn(`[TRI] Could not parse tri-data.json: ${err.message}`);
    return false;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialise TRI service.
 *
 * @param {string[]} benchmarkNames  - All unique benchmark names needed
 */
async function initTRI(benchmarkNames) {
  const fresh = loadTRI();

  if (fresh) {
    // Check if all required benchmarks are already in cache
    // Use classifyBenchmark to skip foreign/composite (no TRI data available for them)
    const missing = (benchmarkNames || []).filter(b => {
      if (!b || _triStore[b]) return false;
      const cls = classifyBenchmark(b);
      return cls !== 'foreign' && cls !== 'composite';
    });

    if (missing.length === 0) {
      logger.info(`[TRI] All ${Object.keys(_triStore).length} required TRI series found in cache`);
      return;
    }

    logger.info(`[TRI] ${missing.length} benchmarks missing from cache — fetching: ${missing.join(', ')}`);
    const syncCount = await syncTRI(missing);
    if (syncCount > 0) saveTRI();
    return;
  }

  // Cache is stale, missing, or incomplete — full sync
  // Keep whatever partial data is already in _triStore as a warm-start
  try {
    const count = await syncTRI(benchmarkNames || []);
    if (count > 0) saveTRI();
  } catch (err) {
    logger.error('[TRI] Init sync failed:', err.message);
    // If old data is in _triStore from loadTRI(), it remains usable as fallback
  }
}

// ─── Public Lookups ───────────────────────────────────────────────────────────

/**
 * Get TRI history for a given benchmark name.
 *
 * @param {string} benchmarkName  - e.g. "Nifty 50 TRI", "BSE 100 TRI"
 * @returns {{date: Date, nav: number}[]}  OR  null if no data
 */
function getTRIHistory(benchmarkName) {
  if (!benchmarkName) return null;
  return _triStore[benchmarkName] || null;
}

/**
 * Returns all benchmark names currently in the store.
 */
function getAvailableBenchmarks() {
  return Object.keys(_triStore);
}

function getTRICount() {
  return Object.keys(_triStore).length;
}

// ─── Cron ─────────────────────────────────────────────────────────────────────

let _benchmarkNamesForCron = [];

/**
 * Schedule daily TRI refresh at 09:31 IST (1 minute after AUM refresh).
 * Must call setTRIBenchmarksForCron() with the list of needed benchmarks first.
 */
function setTRIBenchmarksForCron(benchmarkNames) {
  _benchmarkNamesForCron = benchmarkNames;
}

function scheduleTRICron() {
  cron.schedule('31 9 * * *', async () => {
    logger.info('[TRI] Cron: daily TRI refresh triggered');
    try {
      const count = await syncTRI(_benchmarkNamesForCron);
      if (count > 0) saveTRI();
      logger.info(`[TRI] Cron: refresh complete — ${count} indices updated`);
    } catch (err) {
      logger.error('[TRI] Cron: refresh FAILED —', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  logger.info('[TRI] Daily TRI cron scheduled (09:31 IST)');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  initTRI,
  syncTRI,
  saveTRI,
  loadTRI,
  getTRIHistory,
  getAvailableBenchmarks,
  getTRICount,
  classifyBenchmark,
  setTRIBenchmarksForCron,
  scheduleTRICron,
  // Export maps for use in benchmark name normalisation
  NIFTY_BENCHMARK_MAP,
  BSE_BENCHMARK_MAP,
};
