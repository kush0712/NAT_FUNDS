/**

const logger = require('../shared/logger'); * terService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Downloads the official AMFI TER Excel file, extracts only the latest-date
 * rows in a single pass, saves the result atomically to ter-data.json, and
 * maintains an O(1) in-memory index keyed by scheme_code.
 *
 * AMFI endpoint:
 *   https://www.amfiindia.com/api/populate-te-rdata-revised
 *     ?MF_ID=All&Month=MM-YYYY&strCat=-1&strType=-1&excel=true
 */

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ExcelJS = require('exceljs');
const cron = require('node-cron');

// ─── Paths ────────────────────────────────────────────────────────────────────
// All persistent data files live in <project-root>/data/
const DATA_DIR     = path.join(__dirname, '..', 'data');
const TER_JSON     = path.join(DATA_DIR, 'ter-data.json');
const TER_JSON_TMP = path.join(DATA_DIR, 'ter-data.tmp.json');

// ─── AMFI endpoint ────────────────────────────────────────────────────────────

const AMFI_TER_BASE =
  'https://www.amfiindia.com/api/populate-te-rdata-revised';

// Required column header names (case-insensitive match against actual headers)
const REQUIRED_HEADERS = [
  'NSDL Scheme Code',
  'Scheme Name',
  'TER Date',
  'Direct Plan - Total TER (%)',
  'Regular Plan - Total TER (%)',
];

// ─── In-Memory Index ──────────────────────────────────────────────────────────

/** @type {Object.<string, {nsdl_code:string, scheme_name:string, date:string, direct_ter:number|null, regular_ter:number|null}>} */
let _terIndex = {};   // normalized scheme name (string) → TER record
let _terDate = null; // ISO date string of the TER data currently loaded
let _terMissCount = 0; // funds where no TER match was found (for boot report)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a scheme name for fuzzy matching.
 * Strips plan type, option type, whitespace variations, and common suffixes.
 *
 * Key normalisations (in order applied):
 *   1. & → and           (catches "Banking & PSU" vs "Banking and PSU")
 *   2. collapse spaces   (multiple spaces → single)
 *   3. strip plan/option keywords
 *   4. strip non-alphanumerics
 */
function normalizeSchemeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, 'and')                // & → and  (most common mismatch)
    .replace(/\s+/g, ' ')               // collapse multiple spaces
    .replace(/\b(direct|regular|growth|dividend|idcw|bonus|payout|reinvestment|retail|institutional|plan|option|monthly|quarterly|half yearly|annual)\b/gi, '')
    .replace(/\b(and|of|the|by|in|for|with)\b/gi, '') // strip stopwords so 'Banking and PSU' === 'Banking PSU'
    .replace(/[^a-z0-9]/g, '');          // strip everything else
}

function monthString(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}-${yyyy}`;
}

function buildUrl(monthStr) {
  return `${AMFI_TER_BASE}?MF_ID=All&Month=${monthStr}&strCat=-1&strType=-1&excel=true`;
}

/**
 * Download AMFI TER Excel for a given month string (MM-YYYY).
 * Returns a Buffer, or null if the response is too small / failed.
 */
async function downloadExcel(monthStr) {
  const url = buildUrl(monthStr);
  logger.info(`[TER] Downloading TER Excel for ${monthStr} → ${url}`);

  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120_000, // 2 min — large file
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LedgerMutual/1.0)',
    },
  });

  const buf = Buffer.from(resp.data);
  const MIN_SIZE = 500 * 1024; // 500 KB

  if (buf.length < MIN_SIZE) {
    logger.warn(
      `[TER] Response too small (${buf.length} bytes) for ${monthStr} — likely no data yet`
    );
    return null;
  }

  logger.info(`[TER] Downloaded ${(buf.length / 1024 / 1024).toFixed(2)} MB for ${monthStr}`);
  return buf;
}

/**
 * Parse the AMFI TER Excel buffer.
 *
 * Strategy — SINGLE PASS:
 *   Iterate every data row once.
 *   Track latestDate as we go.
 *   If a row's date is NEWER  → reset results to [this row], update latestDate
 *   If a row's date is EQUAL  → push this row to results
 *   If a row's date is OLDER  → skip
 *
 * Returns an array of clean record objects, or null on error.
 */
async function parseExcelBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('[TER] Excel: no worksheets found');

  // ── Build dynamic header map from first row ──────────────────────────────
  const headerRow = sheet.getRow(1);
  const headerMap = {}; // normalised header string → zero-based column index

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const raw = String(cell.value ?? '').trim();
    if (raw) {
      headerMap[raw.toLowerCase()] = colNumber - 1; // 0-based
    }
  });

  // Verify all required columns exist
  const missing = [];
  for (const req of REQUIRED_HEADERS) {
    if (headerMap[req.toLowerCase()] === undefined) {
      missing.push(req);
    }
  }
  if (missing.length > 0) {
    const actualHeaders = Object.keys(headerMap).join(' | ');
    const err = new Error(
      `[TER] Missing required columns: [${missing.join(', ')}]. ` +
      `Actual headers found: [${actualHeaders}]`
    );
    logger.error(err.message);
    throw err;
  }

  const COL_CODE = headerMap['nsdl scheme code'];
  const COL_NAME = headerMap['scheme name'];
  const COL_DATE = headerMap['ter date'];
  const COL_DIRECT = headerMap['direct plan - total ter (%)'];
  const COL_REGULAR = headerMap['regular plan - total ter (%)'];

  // ── Single-pass iteration ─────────────────────────────────────────────────
  let schemeLatest = {}; // normalized_name -> record

  // sheet.eachRow starts from row 1; skip header (row 1 = index 1)
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const rowValues = row.values; // 1-indexed array (index 0 is undefined)

    // Helper: get cell value by 0-based column index
    const cell = (idx) => {
      const v = rowValues[idx + 1]; // +1 because exceljs row.values is 1-indexed
      if (v === null || v === undefined) return null;
      // ExcelJS may return rich-text objects or Date objects
      if (typeof v === 'object' && v.text !== undefined) return v.text;
      if (v instanceof Date) return v;
      return v;
    };

    const rawCode = cell(COL_CODE);
    const nsdl_code = rawCode !== null ? String(rawCode).trim() : '';

    // ── Date ─────────────────────────────────────────────────────────────────
    const rawDate = cell(COL_DATE);
    let dateStr = null;
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().split('T')[0];
    } else if (typeof rawDate === 'string' && rawDate.trim()) {
      // Try to normalise DD-Mon-YYYY or DD/MM/YYYY → YYYY-MM-DD
      const s = rawDate.trim();
      // DD-MMM-YYYY (e.g. 31-Mar-2026)
      const dmy = s.match(/^(\d{1,2})[/-]([A-Za-z]{3}|\d{1,2})[/-](\d{4})$/);
      if (dmy) {
        const monthNames = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
        };
        const d = dmy[1].padStart(2, '0');
        const mRaw = dmy[2].toLowerCase();
        const m = monthNames[mRaw] || mRaw.padStart(2, '0');
        const yr = dmy[3];
        dateStr = `${yr}-${m}-${d}`;
      } else {
        // YYYY-MM-DD passthrough
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) dateStr = s;
      }
    } else if (typeof rawDate === 'number') {
      // Excel serial date
      const epoch = new Date(1899, 11, 30);
      const d = new Date(epoch.getTime() + rawDate * 86_400_000);
      dateStr = d.toISOString().split('T')[0];
    }

    if (!dateStr) return; // unparseable date — skip

    // ── Scheme Name ──────────────────────────────────────────────────────────
    const scheme_name = String(cell(COL_NAME) ?? '').trim();
    if (!scheme_name) return; // skip if no name
    const normalized_name = normalizeSchemeName(scheme_name);

    // ── TER values ───────────────────────────────────────────────────────────
    const parseF = (v) => {
      if (v === null || v === '' || v === undefined) return null;
      const f = parseFloat(v);
      return isNaN(f) ? null : f;
    };

    const direct_ter = parseF(cell(COL_DIRECT));
    const regular_ter = parseF(cell(COL_REGULAR));

    // Only update if we have at least one TER value and the date is newer
    if (direct_ter !== null || regular_ter !== null) {
      const isNewer = !schemeLatest[normalized_name] || new Date(dateStr) > new Date(schemeLatest[normalized_name].date);
      if (isNewer) {
        schemeLatest[normalized_name] = {
          normalized_name,
          nsdl_code,
          scheme_name,
          date: dateStr,
          direct_ter,
          regular_ter,
        };
      }
    }
  });

  const results = Object.values(schemeLatest);
  logger.info(
    `[TER] Single-pass complete: ${results.length} unique schemes processed`
  );
  return results;
}

// ─── Core Sync ────────────────────────────────────────────────────────────────

/**
 * Full TER sync:
 *   1. Download current month; fallback to previous month
 *   2. Parse Excel (single pass)
 *   3. Atomic write to ter-data.json
 *   4. Reload in-memory index
 *
 * @returns {number} Number of schemes saved
 */
async function syncTER() {
  const now = new Date();
  const curStr = monthString(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevStr = monthString(prevDate);

  let buffer = null;

  // Try current month
  try {
    buffer = await downloadExcel(curStr);
  } catch (err) {
    logger.warn(`[TER] Failed to download ${curStr}: ${err.message}`);
  }

  // Fallback to previous month
  if (!buffer) {
    logger.info(`[TER] Falling back to previous month (${prevStr})...`);
    try {
      buffer = await downloadExcel(prevStr);
    } catch (err) {
      logger.error(`[TER] Failed to download ${prevStr}: ${err.message}`);
    }
  }

  if (!buffer) {
    throw new Error('[TER] Could not download TER data for current or previous month.');
  }

  // Parse
  const records = await parseExcelBuffer(buffer);
  if (!records || records.length === 0) {
    throw new Error('[TER] Parsed zero records — aborting write.');
  }

  // Atomic write
  const payload = JSON.stringify(records, null, 2);
  fs.writeFileSync(TER_JSON_TMP, payload, 'utf-8');
  fs.renameSync(TER_JSON_TMP, TER_JSON);
  logger.info(`[TER] Atomically wrote ${records.length} records to ter-data.json`);

  // Reload in-memory index
  loadTERIndex(records);

  return records.length;
}

// ─── In-Memory Index ─────────────────────────────────────────────────────────

/**
 * Build O(1) hashmap: normalized_name (string) → record object.
 * Always re-normalises from scheme_name so the index reflects the current
 * normalizer (important after normalizer logic changes like & → and fixes).
 */
function loadTERIndex(records) {
  const newIndex = {};
  for (const rec of records) {
    // Re-normalise from the canonical scheme_name, not the cached normalized_name.
    // This ensures correctness even if ter-data.json was built with an old normalizer.
    const key = normalizeSchemeName(rec.scheme_name || rec.normalized_name || '');
    if (key) {
      newIndex[key] = rec;
    }
  }
  _terIndex = newIndex;
  _terDate = records[0]?.date ?? null;
  logger.info(
    `[TER] In-memory index rebuilt: ${Object.keys(_terIndex).length} schemes (date: ${_terDate})`
  );
}

/**
 * Load ter-data.json from disk into the in-memory index.
 * Called at server startup. If file is missing, triggers syncTER().
 */
async function initTER() {
  if (fs.existsSync(TER_JSON)) {
    try {
      const raw = fs.readFileSync(TER_JSON, 'utf-8');
      const records = JSON.parse(raw);
      if (Array.isArray(records) && records.length > 0) {
        loadTERIndex(records);
        logger.info('[TER] Loaded TER index from ter-data.json at startup');
        return;
      }
    } catch (err) {
      logger.warn(`[TER] Could not read ter-data.json: ${err.message} — will sync now`);
    }
  } else {
    logger.warn('[TER] ter-data.json not found — triggering initial sync...');
  }

  // File missing or corrupt — sync now (non-crashing)
  try {
    await syncTER();
  } catch (err) {
    logger.error('[TER] Initial sync failed:', err.message);
    logger.error('[TER] Server will continue without TER data. Retry via /admin/sync-ter');
  }
}

// ─── Public Lookup ────────────────────────────────────────────────────────────

function findBestMatch(normalizedInput) {
  if (_terIndex[normalizedInput]) return _terIndex[normalizedInput];

  // Substring match with length guard: the candidate key must be within 15
  // normalised characters of the input to avoid false-positive matches
  // A threshold of 15 allows for plan suffixes that might not have been fully stripped.
  const MAX_LEN_DELTA = 15;
  for (const key in _terIndex) {
    if (Math.abs(key.length - normalizedInput.length) > MAX_LEN_DELTA) continue;
    if (
      key.includes(normalizedInput) ||
      normalizedInput.includes(key)
    ) {
      return _terIndex[key];
    }
  }

  return null;
}

/**
 * Lookup by scheme name.
 * @param {string} schemeName
 * @returns {Object|null}
 */
function getTERByName(schemeName) {
  if (!schemeName) return null;
  const normalized = normalizeSchemeName(schemeName);

  // 1. Try exact match
  if (_terIndex[normalized]) {
    return _terIndex[normalized];
  }

  // 2. Try fuzzy match (length-filtered substring)
  const match = findBestMatch(normalized);
  if (match) {
    return match;
  }

  // Not found — fund is likely discontinued, wound-up, or a legacy plan variant
  // not present in AMFI's current TER Excel.
  // These are typically wound-up schemes (e.g. Franklin India, UTI segregated portfolios,
  // Reliance legacy names) where TER data is no longer published by AMFI.
  // Count silently; boot report summarises.
  _terMissCount++;
  return null;
}

/**
 * Return the full in-memory index (for diagnostics / bulk use).
 */
function getTERIndex() {
  return _terIndex;
}

function getTERDate() {
  return _terDate;
}

function getTERCount() {
  return Object.keys(_terIndex).length;
}

/**
 * Returns the number of getTERByName() calls that found no match.
 * Used by the boot reconciliation report. Resets to 0 on each call.
 */
function getTERMissCount() {
  const n = _terMissCount;
  _terMissCount = 0;
  return n;
}

// ─── Cron Job ─────────────────────────────────────────────────────────────────

/**
 * Schedule daily sync at 09:00 IST (UTC+5:30 = 03:30 UTC).
 */
function scheduleTERCron() {
  // '30 3 * * *' = 03:30 UTC = 09:00 IST
  cron.schedule('30 3 * * *', async () => {
    logger.info('[TER] Cron: starting scheduled daily TER sync...');
    try {
      const count = await syncTER();
      logger.info(`[TER] Cron: sync complete — ${count} schemes updated`);
    } catch (err) {
      const msg = `[TER] Cron: daily sync FAILED — ${err.message}`;
      logger.error(msg);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  logger.info('[TER] Daily cron scheduled at 09:00 IST');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  initTER,
  syncTER,
  getTERByName,
  getTERIndex,
  getTERDate,
  getTERCount,
  getTERMissCount,
  scheduleTERCron,
};
