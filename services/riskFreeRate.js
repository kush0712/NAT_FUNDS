/**

const logger = require('../shared/logger'); * riskFreeRate.js
 * Fetches the current 91-day Treasury Bill yield from RBI's public data API.
 * Used as the risk-free rate for Sharpe Ratio calculations.
 *
 * Update strategy: fetch weekly, cache with timestamp.
 * Fallback: use last successfully fetched rate. Never falls back to a hardcoded constant.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Cache configuration ──────────────────────────────────────
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'risk_free_rate.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

// ── CCIL Indicative Yields ───────────────────────────────
// We scrape the website for 91D Tenor Bucket YTM
const YIELD_URLS = [
  'https://www.ccilindia.com/tenorwise-indicative-yields'
];

// ── Module state ────────────────────────────────────────────
let _cachedRate = null;       // decimal, e.g. 0.068 for 6.8%
let _cacheTimestamp = null;   // Date of last successful fetch
let _initialized = false;

// ── Utilities ────────────────────────────────────────────────

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw && typeof raw.rate === 'number' && raw.timestamp) {
      return { rate: raw.rate, timestamp: new Date(raw.timestamp) };
    }
  } catch (_) {}
  return null;
}

function saveToDisk(rate, timestamp) {
  try {
    ensureCacheDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ rate, timestamp: timestamp.toISOString() }), 'utf8');
  } catch (err) {
    logger.warn('[RiskFreeRate] Could not save cache to disk:', err.message);
  }
}

/**
 * Simple HTTPS GET that resolves with the body string, rejects on error.
 */
function httpsGet(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

/**
 * Attempt to parse the 91-day T-bill YTM rate from CCIL India HTML.
 * Returns rate as decimal (e.g. 0.0532 for 5.32%) or null if parse fails.
 */
function parseRateFromHTML(text) {
  try {
    const match = text.match(/<td[^>]*>91D<\/td>\s*<td[^>]*>.*?<\/td>\s*<td[^>]*>\s*([\d\.]+)\s*<\/td>/i);
    if (match) {
      const num = parseFloat(match[1]);
      if (!isNaN(num) && num > 0 && num < 30) {
        // Value is already in percentage (e.g. 5.32 meaning 5.32%)
        return num / 100;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Fetch the current 91-day T-bill yield from CCIL Indicative Yields.
 * Tries each URL in sequence; returns the rate as a decimal on success.
 * Throws if all sources fail.
 */
async function fetchLiveRate() {
  const errors = [];

  for (const url of YIELD_URLS) {
    try {
      logger.info(`[RiskFreeRate] Fetching from: ${url}`);
      const body = await httpsGet(url);
      const rate = parseRateFromHTML(body);
      if (rate !== null) {
        logger.info(`[RiskFreeRate] Fetched 91-day T-bill rate: ${(rate * 100).toFixed(4)}% from ${url}`);
        return rate;
      }
      errors.push(`${url}: unparseable response`);
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  throw new Error(`All CCIL sources failed:\n${errors.join('\n')}`);
}

/**
 * Initialise the risk-free rate module.
 * - Loads disk cache.
 * - If cache is older than TTL (or absent), attempts a fresh fetch.
 * - If fetch fails, keeps using last valid cached rate.
 * - Schedules weekly background refresh.
 */
async function initRiskFreeRate() {
  if (_initialized) return;
  _initialized = true;

  const disk = loadFromDisk();
  if (disk) {
    _cachedRate = disk.rate;
    _cacheTimestamp = disk.timestamp;
    logger.info(`[RiskFreeRate] Loaded from disk: ${(_cachedRate * 100).toFixed(4)}% (cached ${disk.timestamp.toISOString()})`);
  }

  await refreshRateIfStale();

  // Schedule weekly background refresh
  setInterval(() => {
    refreshRateIfStale().catch(err =>
      logger.warn('[RiskFreeRate] Background refresh failed:', err.message)
    );
  }, CACHE_TTL_MS);
}

/**
 * Refresh the rate if the cache is stale or missing.
 */
async function refreshRateIfStale() {
  const now = new Date();
  const isStale = !_cacheTimestamp || (now - _cacheTimestamp) > CACHE_TTL_MS;

  if (!isStale) {
    logger.info('[RiskFreeRate] Cache is fresh, skipping fetch.');
    return;
  }

  try {
    const rate = await fetchLiveRate();
    _cachedRate = rate;
    _cacheTimestamp = now;
    saveToDisk(rate, now);
    logger.info(`[RiskFreeRate] Updated rate to ${(rate * 100).toFixed(4)}%`);
  } catch (err) {
    if (_cachedRate !== null) {
      logger.warn(`[RiskFreeRate] Fetch failed — using last valid rate ${(_cachedRate * 100).toFixed(4)}%: ${err.message}`);
    } else {
      // No cached rate at all — this is a fatal situation, but we log it and
      // let the caller decide. getRiskFreeRate() will throw in this case.
      logger.error('[RiskFreeRate] Fetch failed and no cached rate available:', err.message);
    }
  }
}

/**
 * Returns the current annual risk-free rate as a decimal.
 *
 * Throws if no rate is available (initial boot + all API sources down + no disk cache).
 * Callers should wrap in try/catch and decide whether to skip Sharpe or use a sentinel.
 */
function getRiskFreeRate() {
  if (_cachedRate === null) {
    throw new Error('[RiskFreeRate] No risk-free rate available. API fetch failed and no disk cache found.');
  }
  return _cachedRate;
}

/**
 * Returns the monthly risk-free rate using correct geometric compounding.
 * monthly_rf = (1 + annual_rf)^(1/12) − 1
 */
function getMonthlyRiskFreeRate() {
  const annual = getRiskFreeRate();
  return Math.pow(1 + annual, 1 / 12) - 1;
}

/**
 * Returns metadata about the current cached rate (for diagnostics/UI).
 */
function getRiskFreeRateMeta() {
  return {
    rate: _cachedRate,
    ratePercent: _cachedRate !== null ? Math.round(_cachedRate * 10000) / 100 : null,
    cachedAt: _cacheTimestamp ? _cacheTimestamp.toISOString() : null,
    source: '91-day T-bill (CCIL India)',
  };
}

module.exports = {
  initRiskFreeRate,
  refreshRateIfStale,
  getRiskFreeRate,
  getMonthlyRiskFreeRate,
  getRiskFreeRateMeta,
};
