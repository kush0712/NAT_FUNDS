/**

const logger = require('../shared/logger'); * Data Fetcher
 * Fetches historical NAV from mfapi.in, manages disk cache,
 * provides TER lookup, and fetches AUM from AMFI reports.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const MFAPI_BASE = 'https://api.mfapi.in/mf';

// ─── TER Data (fetched from AMFI) ────────────────────────────
const AMFI_TER_API = 'https://www.amfiindia.com/api/populate-te-rdata-revised';
const TER_CACHE_FILE = 'ter-data.xlsx';
const TER_JSON_CACHE = 'ter-parsed.json';

let _terCache = null; // In-memory: schemeName → { regular, direct }

// ─── Cache Helpers ───────────────────────────────────────────

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCachePath(schemeCode) {
  return path.join(CACHE_DIR, `nav_${schemeCode}.json`);
}

/**
 * Check if cached data is fresh (within maxAgeMs, default 24 hours)
 */
function isCacheFresh(cachePath, maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const stats = fs.statSync(cachePath);
    const ageMs = Date.now() - stats.mtimeMs;
    return ageMs < maxAgeMs;
  } catch {
    return false;
  }
}

function readCache(schemeCode) {
  const cachePath = getCachePath(schemeCode);
  if (isCacheFresh(cachePath)) {
    try {
      const data = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

function writeCache(schemeCode, data) {
  ensureCacheDir();
  const cachePath = getCachePath(schemeCode);
  try {
    fs.writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
  } catch (err) {
    logger.error(`[Cache] Failed to write cache for ${schemeCode}:`, err.message);
  }
}

// ─── Sleep & Retry ───────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with exponential backoff retry (handles 429, timeouts, transient errors)
 */
async function fetchWithRetry(url, maxRetries = 3, baseDelayMs = 300) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (resp.status === 429) {
        // Rate limited — back off
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(`[mfapi] 429 Rate limited on ${url}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(delay);
        continue;
      }
      if (!resp.ok) {
        logger.error(`[mfapi] HTTP ${resp.status} for ${url}`);
        return null;
      }
      return await resp.json();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(`[mfapi] Error on ${url}: ${err.message}, retrying in ${delay}ms (attempt ${attempt + 1})`);
        await sleep(delay);
      }
    }
  }
  logger.error(`[mfapi] All retries exhausted for ${url}:`, lastError?.message);
  return null;
}

// ─── Scheme NAV Fetching ─────────────────────────────────────

/**
 * Fetch historical NAV for a single scheme from mfapi.in
 */
async function fetchSchemeNav(schemeCode) {
  const cached = readCache(schemeCode);
  if (cached) return cached;

  const data = await fetchWithRetry(`${MFAPI_BASE}/${schemeCode}`);

  if (data && data.data && data.data.length > 0) {
    const result = {
      meta: data.meta || {},
      data: data.data,
    };
    writeCache(schemeCode, result);
    return result;
  }
  return null;
}

/**
 * Batch fetch historical NAV for multiple schemes with rate limiting
 */
async function batchFetchNavs(schemeCodes, progressCb = null, delayMs = 100) {
  const results = {};
  const total = schemeCodes.length;
  let completed = 0;
  let cached = 0;
  const CONCURRENCY = 10; // fetch 10 NAVs in parallel

  logger.info(`[Fetcher] Starting batch fetch for ${total} schemes (concurrency=${CONCURRENCY})...`);

  // Separate cached from uncached
  const toFetch = [];
  for (const code of schemeCodes) {
    const cachedData = readCache(code);
    if (cachedData) {
      results[code] = cachedData;
      completed++;
      cached++;
      if (progressCb) progressCb(completed, total, cached);
    } else {
      toFetch.push(code);
    }
  }

  // Fetch uncached in parallel batches
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(code => fetchSchemeNav(code)));
    for (let j = 0; j < batch.length; j++) {
      const code = batch[j];
      const data = batchResults[j];
      if (data) results[code] = data;
      completed++;
      if (progressCb) progressCb(completed, total, cached);
    }
    if (i + CONCURRENCY < toFetch.length) {
      await sleep(delayMs);
    }
  }

  logger.info(`[Fetcher] Completed: ${completed}/${total} (${cached} from cache)`);
  return results;
}

// ─── TER Fetching from AMFI ──────────────────────────────────

/**
 * Normalize a scheme name for fuzzy matching.
 * Strips plan type, option type, whitespace variations, and common suffixes.
 */
function normalizeSchemeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s*-\s*(direct|regular)\s*(plan)?/gi, '')
    .replace(/\s*-\s*(growth|dividend|idcw|bonus|payout|reinvestment)\s*(option)?/gi, '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Download & parse TER data from AMFI for a given month.
 * @param {string} monthStr - Format: 'MM-YYYY' (e.g. '03-2026')
 * @returns {Object|null} - Map of normalizedName → { regular, direct } or null on failure
 */
async function downloadTERForMonth(monthStr) {
  const url = `${AMFI_TER_API}?MF_ID=All&Month=${monthStr}&strCat=-1&strType=-1&excel=true`;
  logger.info(`[TER] Downloading TER data for ${monthStr}...`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout — large file
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      logger.error(`[TER] HTTP ${resp.status} for ${monthStr}`);
      return null;
    }

    const arrayBuf = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    if (buffer.length < 1000) {
      logger.warn(`[TER] Response too small (${buffer.length} bytes) for ${monthStr} — likely no data yet`);
      return null;
    }

    // Save to cache
    ensureCacheDir();
    const cachePath = path.join(CACHE_DIR, TER_CACHE_FILE);
    fs.writeFileSync(cachePath, buffer);
    logger.info(`[TER] Saved ${(buffer.length / 1024 / 1024).toFixed(1)}MB TER Excel to cache`);

    return parseTERExcel(cachePath, monthStr);
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.error(`[TER] Download timed out for ${monthStr}`);
    } else {
      logger.error(`[TER] Download error for ${monthStr}:`, err.message);
    }
    return null;
  }
}

/**
 * Parse the downloaded AMFI TER Excel file.
 * Extracts the latest date's Regular and Direct TER for each scheme.
 * Excel columns:
 *   0: NSDL Code, 1: Scheme Name, 2: Scheme Type, 3: Scheme Category,
 *   4: TER Date (serial), 5-9: Regular Plan breakdown → 9: Regular Total TER,
 *   10-14: Direct Plan breakdown → 14: Direct Total TER
 */
function parseTERExcel(excelPath, monthLabel) {
  try {
    const workbook = XLSX.readFile(excelPath, { dense: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    if (rows.length < 2) {
      logger.warn('[TER] Excel has no data rows');
      return null;
    }

    // First pass: find the maximum (latest) date serial across all rows
    let maxDate = 0;
    for (let i = 1; i < rows.length; i++) {
      const dateVal = rows[i][4];
      if (typeof dateVal === 'number' && dateVal > maxDate) {
        maxDate = dateVal;
      }
    }

    if (maxDate === 0) {
      logger.warn('[TER] No valid dates found in Excel');
      return null;
    }

    // Convert Excel serial to readable date
    const epoch = new Date(1899, 11, 30);
    const latestDate = new Date(epoch.getTime() + maxDate * 86400000);
    const dateStr = latestDate.toISOString().split('T')[0];
    logger.info(`[TER] Using TER data for latest date: ${dateStr}`);

    // Second pass: extract TER for rows matching the latest date
    const terMap = {};
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[4] !== maxDate) continue;

      const schemeName = String(row[1] || '').trim();
      if (!schemeName) continue;

      const regularTER = parseFloat(row[9]);
      const directTER = parseFloat(row[14]);

      if (isNaN(regularTER) && isNaN(directTER)) continue;

      const normalized = normalizeSchemeName(schemeName);
      terMap[normalized] = {
        regular: isNaN(regularTER) ? null : regularTER,
        direct: isNaN(directTER) ? null : directTER,
        schemeName, // Keep original name for debugging
        date: dateStr,
      };
      count++;
    }

    logger.info(`[TER] Parsed ${count} scheme TER entries for ${dateStr}`);
    return terMap;
  } catch (err) {
    logger.error('[TER] Error parsing TER Excel:', err.message);
    return null;
  }
}

/**
 * Fetch TER data from AMFI — tries current month, falls back to previous month.
 * Caches the parsed result to disk (24h TTL) and in memory.
 * Returns a map: normalizedSchemeName → { regular, direct, schemeName, date }
 */
async function fetchTERData() {
  // Return memory cache if available
  if (_terCache) {
    logger.info(`[TER] Loaded ${Object.keys(_terCache).length} TER entries from memory cache`);
    return _terCache;
  }

  // Check disk cache
  ensureCacheDir();
  const jsonCachePath = path.join(CACHE_DIR, TER_JSON_CACHE);
  if (isCacheFresh(jsonCachePath)) {
    try {
      const raw = fs.readFileSync(jsonCachePath, 'utf-8');
      _terCache = JSON.parse(raw);
      logger.info(`[TER] Loaded ${Object.keys(_terCache).length} TER entries from disk cache`);
      return _terCache;
    } catch {
      // Cache corrupted, re-fetch
    }
  }

  // Determine current and previous month strings
  const now = new Date();
  const curMonth = String(now.getMonth() + 1).padStart(2, '0');
  const curYear = now.getFullYear();
  const currentMonthStr = `${curMonth}-${curYear}`;

  const prevDate = new Date(curYear, now.getMonth() - 1, 1);
  const prevMonth = String(prevDate.getMonth() + 1).padStart(2, '0');
  const prevYear = prevDate.getFullYear();
  const prevMonthStr = `${prevMonth}-${prevYear}`;

  // Try current month first
  let terMap = await downloadTERForMonth(currentMonthStr);

  // If current month has no data (start of month), fall back to previous month
  if (!terMap || Object.keys(terMap).length === 0) {
    logger.info(`[TER] No data for current month (${currentMonthStr}), trying previous month (${prevMonthStr})...`);
    terMap = await downloadTERForMonth(prevMonthStr);
  }

  if (!terMap || Object.keys(terMap).length === 0) {
    logger.error('[TER] Failed to fetch TER data from AMFI for both current and previous months.');
    _terCache = {};
    return {};
  }

  // Save parsed data to disk cache
  try {
    fs.writeFileSync(jsonCachePath, JSON.stringify(terMap), 'utf-8');
    logger.info(`[TER] Saved ${Object.keys(terMap).length} TER entries to disk cache`);
  } catch (err) {
    logger.error('[TER] Failed to save TER cache:', err.message);
  }

  _terCache = terMap;
  return terMap;
}

/**
 * Get TER for a fund from the AMFI TER data.
 * Matches by normalized scheme name and returns the appropriate plan TER.
 * @param {Object} fund - Fund object with schemeName and planType
 * @returns {number|null} - TER percentage or null if not found
 */
function getTER(fund) {
  if (!fund || typeof fund !== 'object' || !fund.schemeName) return null;
  if (!_terCache || Object.keys(_terCache).length === 0) return null;

  const normalized = normalizeSchemeName(fund.schemeName);
  const entry = _terCache[normalized];

  if (!entry) return null;

  // Return the TER for the matching plan type
  const isDirect = (fund.planType || '').toLowerCase() === 'direct' ||
                   (fund.schemeName || '').toLowerCase().includes('direct');

  const ter = isDirect ? entry.direct : entry.regular;
  return ter !== null && ter !== undefined ? parseFloat(ter.toFixed(2)) : null;
}

// ─── AUM ─────────────────────────────────────────────────────
// AUM data is managed by services/fundPerformanceService.js

// This file no longer contains any AUM fetching logic.

// ─── Processed Data Persistence ──────────────────────────────

function saveProcessedData(funds, categories) {
  ensureCacheDir();
  const dataPath = path.join(CACHE_DIR, 'processed_funds.json');
  try {
    fs.writeFileSync(dataPath, JSON.stringify({ funds, categories, timestamp: Date.now() }), 'utf-8');
    logger.info(`[Cache] Saved ${funds.length} processed funds to disk`);
  } catch (err) {
    logger.error('[Cache] Failed to save processed data:', err.message);
  }
}

/**
 * Load processed fund data from disk (if within maxAgeHours)
 */
function loadProcessedData(maxAgeHours = 24) {
  const dataPath = path.join(CACHE_DIR, 'processed_funds.json');
  try {
    if (!fs.existsSync(dataPath)) return null;
    const raw = fs.readFileSync(dataPath, 'utf-8');
    const data = JSON.parse(raw);
    const ageMs = Date.now() - (data.timestamp || 0);
    if (ageMs < maxAgeHours * 60 * 60 * 1000) {
      logger.info(`[Cache] Loaded ${data.funds.length} processed funds from disk`);
      return data;
    }
    logger.info('[Cache] Processed data too old, will refresh');
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  fetchSchemeNav,
  batchFetchNavs,
  saveProcessedData,
  loadProcessedData,
  ensureCacheDir,
  fetchTERData,
  getTER,
};
