/**
 * Phase 0 — Step 0.1 & 0.2
 * collect_bse_tri.js
 *
 * Collects:
 *   (A) BSE TRI time-series for all BSE benchmark indices used in NAT_FUNDS
 *   (B) BSE Price Index (non-dividend) for the same indices
 *
 * Sources:
 *   - BSE IndexArchiveData API (POST) — primary, returns daily TRI history
 *   - BSE AllIndices daily CSV — fallback for recent points
 *
 * Output:
 *   research/phase0/data/bse_tri_raw.csv
 *   research/phase0/data/bse_price_raw.csv
 *
 * Usage:
 *   node research/phase0/collect_bse_tri.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Index Config ─────────────────────────────────────────────────────────────
// Maps the AMFI benchmark name → BSE index code used in the AllIndices CSV.
// These are the exact BSE codes from triService.js BSE_BENCHMARK_MAP.
// We add the paired Nifty proxy here so the overlap analysis script knows the pairing.

const BSE_INDEX_CONFIG = [
  // code               displayName                           niftyProxy
  { code: 'SENSEX',    name: 'BSE SENSEX TRI',               niftyProxy: 'NIFTY 50'           },
  { code: 'BSE100',    name: 'BSE 100 TRI',                  niftyProxy: 'NIFTY 100'          },
  { code: 'BSE200',    name: 'BSE 200 TRI',                  niftyProxy: 'NIFTY 200'          },
  { code: 'BSE500',    name: 'BSE 500 TRI',                  niftyProxy: 'NIFTY 500'          },
  { code: 'MID150',    name: 'BSE Midcap 150 TRI',           niftyProxy: 'NIFTY MIDCAP 150'   },
  { code: 'SML250',    name: 'BSE 250 Smallcap TRI',         niftyProxy: 'NIFTY SMALLCAP 250' },
  { code: 'LMI250',    name: 'BSE 250 Large MidCap TRI',     niftyProxy: 'NIFTY LARGEMIDCAP 250'},
  { code: 'BANKEX',    name: 'BSE BANKEX TRI',               niftyProxy: 'NIFTY BANK'         },
  { code: 'FINSER',    name: 'BSE Financial Services TRI',   niftyProxy: 'NIFTY FINANCIAL SERVICES'},
  { code: 'BSE HC',    name: 'BSE Healthcare TRI',           niftyProxy: 'NIFTY HEALTHCARE'   },
  { code: 'INFRA',     name: 'BSE India Infrastructure TRI', niftyProxy: 'NIFTY INFRASTRUCTURE'},
  { code: 'MFG',       name: 'BSE India Manufacturing TRI',  niftyProxy: 'NIFTY INDIA MFG'    },
  { code: 'TECK',      name: 'BSE Teck TRI',                 niftyProxy: 'NIFTY IT'           },
  { code: 'BSEPSU',   name: 'BSE PSU TRI',                  niftyProxy: 'NIFTY PSE'          },
  { code: 'BSEQUI',   name: 'BSE Quality TRI',              niftyProxy: 'NIFTY200 QUALITY 30' },
  { code: 'BHRT22',   name: 'BSE Bharat 22 TRI',            niftyProxy: 'NIFTY CPSE'         },
  { code: 'POWER',    name: 'BSE Power TRI',                niftyProxy: 'NIFTY ENERGY'       },
  { code: 'IPOSI',    name: 'BSE Select IPO TRI',           niftyProxy: 'NIFTY IPO INDEX'    },
];

// Start date for history collection (10 years back matches triService HISTORY_YEARS)
const HISTORY_YEARS = 10;
const endDate   = new Date();
const startDate = new Date();
startDate.setFullYear(startDate.getFullYear() - HISTORY_YEARS);

function fmtDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── BSE TRI API ──────────────────────────────────────────────────────────────
// POST to BSE IndexArchiveData to get historical TRI (and Price) for an index code.
// Returns array of { date: 'YYYY-MM-DD', tri: number, price: number }

async function fetchBSEIndexHistory(indexCode) {
  const url     = 'https://www.bseindia.com/Indices/IndexArchiveData.aspx/GetChartData';
  const payload = {
    flag:      '10Y',
    indexCode: indexCode,
    fromDate:  fmtDDMMYYYY(startDate),
    toDate:    fmtDDMMYYYY(endDate),
  };

  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent':   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Referer':      'https://www.bseindia.com/indices/IndexArchiveData.aspx',
    'Origin':       'https://www.bseindia.com',
    'Accept':       'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
  };

  try {
    const resp = await fetch(url, {
      method:  'POST',
      headers: headers,
      body:    JSON.stringify(payload),
    });

    if (!resp.ok) {
      console.warn(`  [BSE API] HTTP ${resp.status} for ${indexCode}`);
      return [];
    }

    const json = await resp.json();
    // BSE returns { d: "[{...}]" } where d is a JSON string
    let raw;
    if (typeof json.d === 'string') {
      raw = JSON.parse(json.d);
    } else if (Array.isArray(json.d)) {
      raw = json.d;
    } else {
      console.warn(`  [BSE API] Unexpected response shape for ${indexCode}`);
      return [];
    }

    // Each record: { Date: "2026/07/01", Open: "...", High: "...", Low: "...", Close: "...", TRI: "..." }
    const records = [];
    for (const r of raw) {
      // Date formats seen: "2026/07/01" or "01-Jul-2026" or timestamp "1751308800000"
      let d;
      if (typeof r.Date === 'number' || /^\d{10,}$/.test(String(r.Date))) {
        d = new Date(Number(r.Date));
      } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(r.Date)) {
        d = new Date(r.Date.replace(/\//g, '-'));
      } else {
        // Try generic parse
        d = new Date(r.Date);
      }
      if (!d || isNaN(d.getTime())) continue;

      const tri   = parseFloat(r.TRI   || r.tri   || r.tRI   || 0);
      const price = parseFloat(r.Close || r.close || r.CLOSE || 0);
      if (tri <= 0 && price <= 0) continue;

      const isoDate = d.toISOString().split('T')[0];
      records.push({ date: isoDate, tri: tri || null, price: price || null });
    }

    // Sort oldest-first
    records.sort((a, b) => a.date.localeCompare(b.date));
    return records;

  } catch (err) {
    console.warn(`  [BSE API] Error for ${indexCode}: ${err.message}`);
    return [];
  }
}

// ─── Alternative: BSE AllIndices daily CSV (recent points fallback) ───────────
// https://www.bseindia.com/Downloads/AllIndices/AllIndices_DDMMYYYY.csv

async function fetchBSEAllIndicesCSV(dateObj) {
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const yyyy = dateObj.getFullYear();
  const url = `https://www.bseindia.com/Downloads/AllIndices/AllIndices_${dd}${mm}${yyyy}.csv`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; NatFundsResearch/1.0)',
    'Referer':    'https://www.bseindia.com/',
  };

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const text = await resp.text();
    return text;
  } catch {
    return null;
  }
}

// ─── Main Collection ──────────────────────────────────────────────────────────

async function main() {
  const dataDir = path.join(__dirname, 'data');

  // Will hold: { indexCode: [ {date, tri, price}, ... ] }
  const allData = {};

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║   Phase 0.1 / 0.2 — BSE TRI & Price Collection       ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`  Period : ${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}`);
  console.log(`  Indices: ${BSE_INDEX_CONFIG.length}`);
  console.log('');

  for (const idx of BSE_INDEX_CONFIG) {
    console.log(`  ▸ Fetching: ${idx.name} (${idx.code})`);
    const records = await fetchBSEIndexHistory(idx.code);
    allData[idx.code] = records;
    console.log(`    ✓ ${records.length} trading days collected`);
    await sleep(1200); // polite rate limiting — BSE rate-limits aggressively
  }

  // ── Write bse_tri_raw.csv ────────────────────────────────────────────────
  const triLines = ['date,index_code,index_name,nifty_proxy,tri'];
  for (const idx of BSE_INDEX_CONFIG) {
    for (const r of (allData[idx.code] || [])) {
      if (r.tri !== null && r.tri > 0) {
        triLines.push(`${r.date},${idx.code},"${idx.name}","${idx.niftyProxy}",${r.tri}`);
      }
    }
  }
  const triPath = path.join(dataDir, 'bse_tri_raw.csv');
  fs.writeFileSync(triPath, triLines.join('\n'), 'utf8');
  console.log(`\n  ✅ Written: ${triPath} (${triLines.length - 1} rows)`);

  // ── Write bse_price_raw.csv ──────────────────────────────────────────────
  const priceLines = ['date,index_code,index_name,nifty_proxy,price'];
  for (const idx of BSE_INDEX_CONFIG) {
    for (const r of (allData[idx.code] || [])) {
      if (r.price !== null && r.price > 0) {
        priceLines.push(`${r.date},${idx.code},"${idx.name}","${idx.niftyProxy}",${r.price}`);
      }
    }
  }
  const pricePath = path.join(dataDir, 'bse_price_raw.csv');
  fs.writeFileSync(pricePath, priceLines.join('\n'), 'utf8');
  console.log(`  ✅ Written: ${pricePath} (${priceLines.length - 1} rows)`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n  ── Collection Summary ──────────────────────────────────');
  for (const idx of BSE_INDEX_CONFIG) {
    const records = allData[idx.code] || [];
    const triCount   = records.filter(r => r.tri   > 0).length;
    const priceCount = records.filter(r => r.price > 0).length;
    const earliest   = records.length ? records[0].date          : 'N/A';
    const latest     = records.length ? records[records.length-1].date : 'N/A';
    console.log(`  ${idx.code.padEnd(10)} TRI:${String(triCount).padStart(5)} Price:${String(priceCount).padStart(5)}  [${earliest} → ${latest}]`);
  }
  console.log('\n  Phase 0.1 / 0.2 complete.\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
