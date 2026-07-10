// dev-tools/verify-bse-nifty-correlation.js
// ------------------------------------------------------------
// This script measures the empirical correlation between real BSE TRI data
// (downloaded weekly via the public BSE AllIndices CSVs) and the cached
// Nifty TRI series (already stored in data/tri-data.json). It is a concrete
// follow‑up to the discussion in triService.js about using Nifty as a
// wholesale proxy for BSE benchmarks.
//
// Usage: from the project root run
//     node dev-tools/verify-bse-nifty-correlation.js
// It will output per‑pair correlation on monthly returns and a short summary.
// ------------------------------------------------------------

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------
// Load cached Nifty data (tri-data.json) – this contains 10+ years of
// Nifty TRI series for every benchmark.
// ------------------------------------------------------------
const TRI_JSON = path.join(__dirname, '..', 'data', 'tri-data.json');
if (!fs.existsSync(TRI_JSON)) {
  console.error('[!] tri-data.json not found – run the app once to populate it.');
  process.exit(1);
}
const raw = fs.readFileSync(TRI_JSON, 'utf-8');
const json = JSON.parse(raw);

// Convert to map of name → [{date, nav}]
const niftyCache = {};
for (const [name, series] of Object.entries(json.data)) {
  // series stored as objects {date: '2024-01-01', nav: 1234}
  niftyCache[name] = series.map(p => ({ date: new Date(p.date), nav: p.nav }));
}

// ------------------------------------------------------------
// Helper: fetch a BSE AllIndices CSV for a given ddmmyyyy string via curl.
// Returns a Map(code → close value) or null on failure.
// ------------------------------------------------------------
function fetchBSECSV(ddmmyyyy) {
  const url = `https://www.bseindia.com/Downloads/AllIndices/AllIndices_${ddmmyyyy}.csv`;
  try {
    const text = execSync(
      `curl -s --max-time 20 ` +
      `-H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" ` +
      `-H "Referer: https://www.bseindia.com/" ` +
      `-H "Accept: text/csv,*/*" ` +
      `"${url}"`,
      { encoding: 'utf8', timeout: 25_000 }
    );
    if (!text || text.length < 100 || text.includes('<html') || text.includes('404')) return null;
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const map = new Map();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 8) continue;
      const code = cols[1]?.trim();
      const close = parseFloat(cols[7]);
      if (code && !isNaN(close) && close > 0) map.set(code, close);
    }
    return map.size > 0 ? map : null;
  } catch (_) { return null; }
}

// ------------------------------------------------------------
// Convert a price series to month → last nav of that month (exclude current incomplete month).
// ------------------------------------------------------------
function toMonthlyNavMap(series) {
  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const map = {};
  for (const { date, nav } of series) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (key < curKey) map[key] = nav; // keep latest entry per month
  }
  return map;
}

// ------------------------------------------------------------
// Compute monthly returns (decimal) from month → nav map.
// ------------------------------------------------------------
function monthlyReturns(navMap) {
  const months = Object.keys(navMap).sort();
  const ret = {};
  for (let i = 1; i < months.length; i++) {
    const prev = navMap[months[i - 1]];
    const cur = navMap[months[i]];
    if (prev > 0) ret[months[i]] = (cur - prev) / prev;
  }
  return ret;
}

// ------------------------------------------------------------
// Pearson correlation helper.
// ------------------------------------------------------------
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

// ------------------------------------------------------------
// Pairs to test – BSE code → Nifty benchmark name as stored in cache.
// ------------------------------------------------------------
const PAIRS = [
  { bseCode: 'BSE100',   niftyName: 'Nifty 100 TRI',              label: 'BSE 100 ↔ Nifty 100' },
  { bseCode: 'BSE200',   niftyName: 'Nifty 200 TRI',              label: 'BSE 200 ↔ Nifty 200' },
  { bseCode: 'BSE500',   niftyName: 'Nifty 500 TRI',              label: 'BSE 500 ↔ Nifty 500' },
  { bseCode: 'MID150',   niftyName: 'Nifty Midcap 150 TRI',       label: 'BSE Midcap 150 ↔ Nifty Midcap 150' },
  { bseCode: 'LMI250',   niftyName: 'Nifty LargeMidcap 250 TRI',  label: 'BSE LargeMidcap ↔ Nifty LargeMidcap 250' },
  { bseCode: 'BANKEX',   niftyName: 'Nifty Bank TRI',             label: 'BSE BANKEX ↔ Nifty Bank' },
  { bseCode: 'TECK',     niftyName: 'Nifty IT TRI',               label: 'BSE Teck ↔ Nifty IT' },
  { bseCode: 'BSEPSU',   niftyName: 'Nifty PSE TRI',              label: 'BSE PSU ↔ Nifty PSE' },
];

// ------------------------------------------------------------
// Main routine – fetch BSE series for past 12‑14 months, compare.
// ------------------------------------------------------------
(async () => {
  console.log('='.repeat(80));
  console.log('BSE ↔ Nifty Proxy Correlation (live BSE CSV vs cached Nifty)');
  console.log('Fetching up to ~14 months of weekly BSE data (≈64 pts per index).');
  console.log('Correlation computed on MONTHLY RETURNS (not price levels).');
  console.log('='.repeat(80));

  const results = [];

  // Helper: fetch BSE series for a given BSE code.
  async function fetchBSESeries(bseCode) {
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1.2); // ~14 months back
    const series = [];
    let cursor = new Date(end);
    const maxWeeks = 80; // enough weeks for ~14 months
    let attempts = 0;
    while (cursor >= start && attempts < maxWeeks) {
      // try current day and up to +3 offset to handle weekends/holidays
      let fetched = false;
      for (let off = 0; off <= 3; off++) {
        const tryDate = new Date(cursor);
        tryDate.setDate(tryDate.getDate() - off);
        const dd = String(tryDate.getDate()).padStart(2, '0');
        const mm = String(tryDate.getMonth() + 1).padStart(2, '0');
        const yyyy = tryDate.getFullYear();
        const map = fetchBSECSV(`${dd}${mm}${yyyy}`);
        if (map && map.has(bseCode)) {
          series.push({ date: new Date(tryDate), nav: map.get(bseCode) });
          fetched = true;
          break;
        }
      }
      // step back one week
      cursor.setDate(cursor.getDate() - 7);
      attempts++;
    }
    series.sort((a, b) => a.date - b.date);
    return series;
  }

  for (const pair of PAIRS) {
    console.log(`\n-- ${pair.label} --`);
    // Load Nifty series from cache
    const niftySeries = niftyCache[pair.niftyName];
    if (!niftySeries) {
      console.log('  [!] Nifty series not found in cache');
      results.push({ label: pair.label, r: null, n: 0, flag: 'MISSING_NIFTY' });
      continue;
    }

    // Fetch BSE series live
    const bseSeries = await fetchBSESeries(pair.bseCode);
    if (bseSeries.length === 0) {
      console.log('  [!] No BSE data fetched (CSV unavailable for period).');
      results.push({ label: pair.label, r: null, n: 0, flag: 'NO_BSE_DATA' });
      continue;
    }

    // Convert to monthly returns
    const bseMonthly = monthlyReturns(toMonthlyNavMap(bseSeries));
    const niftyMonthly = monthlyReturns(toMonthlyNavMap(niftySeries));
    const commonMonths = Object.keys(bseMonthly).filter(m => niftyMonthly[m] !== undefined).sort();

    if (commonMonths.length < 6) {
      console.log(`  [!] Only ${commonMonths.length} overlapping months – insufficient for reliable r.`);
      results.push({ label: pair.label, r: null, n: commonMonths.length, flag: 'INSUFFICIENT' });
      continue;
    }

    const bVals = commonMonths.map(m => bseMonthly[m]);
    const nVals = commonMonths.map(m => niftyMonthly[m]);
    const r = pearson(bVals, nVals);
    const rStr = r === null ? 'N/A' : r.toFixed(4);
    console.log(`  Overlap months: ${commonMonths.length}`);
    console.log(`  Pearson r = ${rStr}`);
    const flag = r >= 0.97 ? 'PASS' : r >= 0.90 ? 'WARN' : 'FAIL';
    results.push({ label: pair.label, r, n: commonMonths.length, flag });
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`${'Pair'.padEnd(40)}  ${'r'.padStart(7)}  ${'N'.padStart(4)}  Status`);
  console.log('-'.repeat(80));
  for (const res of results) {
    const rDisp = res.r === null ? '   N/A' : res.r.toFixed(4).padStart(7);
    const nDisp = String(res.n).padStart(4);
    console.log(`${res.label.padEnd(40)}  ${rDisp}  ${nDisp}  ${res.flag}`);
  }
  console.log('='.repeat(80));
})();
