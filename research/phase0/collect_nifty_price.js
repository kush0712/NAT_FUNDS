/**
 * Phase 0 — Step 0.3
 * collect_nifty_price.js
 *
 * Collects Nifty Price Index (non-TRI) for each Nifty index that serves as a
 * proxy for a BSE benchmark in NAT_FUNDS.
 *
 * Separating Price Index from TRI lets us isolate two sources of divergence:
 *   (A) Index composition divergence  (BSE 500 vs Nifty 500 — different constituents)
 *   (B) Dividend reinvestment convention difference (BSE vs NSE timing)
 *
 * Source: NSE Nifty Indices API (same endpoint as triService.js but for Price Index)
 *
 * Output:
 *   research/phase0/data/nifty_price_raw.csv
 *
 * Usage:
 *   node research/phase0/collect_nifty_price.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Nifty Price Index API ─────────────────────────────────────────────────────
// Same endpoint as TRI, different series name suffix.
// NSE serves Price Return Index (PRI) via the same API with a different index name.
// For TRI:   "NIFTY 50"          → gives TRI
// For Price: "NIFTY 50"          → also gives PRI when we request 'indexName' as PRI name
// NSE naming: "NIFTY 50" PRI is fetched as a separate named series.
// We use the same POST endpoint and request the plain (non-TRI) index name.

const NIFTY_TRI_URL = 'https://niftyindices.com/Backpage.aspx/getTotalReturnIndexString';
const NIFTY_PRI_URL = 'https://niftyindices.com/Backpage.aspx/getHistoricaldatatabletoString';

const NIFTY_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; NatFundsResearch/1.0)',
  'Referer':      'https://www.niftyindices.com/reports/historical-data',
  'Origin':       'https://niftyindices.com',
  'Accept':       'application/json, text/plain, */*',
};

// The unique Nifty proxies used across all BSE benchmark substitutions in triService.js
const NIFTY_PROXY_INDICES = [
  'NIFTY 50',
  'NIFTY 100',
  'NIFTY 200',
  'NIFTY 500',
  'NIFTY MIDCAP 150',
  'NIFTY SMALLCAP 250',
  'NIFTY LARGEMIDCAP 250',
  'NIFTY BANK',
  'NIFTY FINANCIAL SERVICES',
  'NIFTY HEALTHCARE',
  'NIFTY INFRASTRUCTURE',
  'NIFTY INDIA MFG',
  'NIFTY IT',
  'NIFTY PSE',
  'NIFTY200 QUALITY 30',
  'NIFTY CPSE',
  'NIFTY ENERGY',
  'NIFTY IPO INDEX',
];

const HISTORY_YEARS = 10;
const endDate   = new Date();
const startDate = new Date();
startDate.setFullYear(startDate.getFullYear() - HISTORY_YEARS);

function formatNiftyDate(d) {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dd}-${mons[d.getMonth()]}-${d.getFullYear()}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Fetch Nifty Price Return Index ─────────────────────────────────────────
// NSE's getHistoricaldatatabletoString gives daily Open/High/Low/Close for the
// Price Return Index (not dividend-adjusted TRI).

async function fetchNiftyPriceIndex(indexName) {
  const startStr = formatNiftyDate(startDate);
  const endStr   = formatNiftyDate(endDate);

  const cinfo = JSON.stringify({
    name:      indexName,
    startDate: startStr,
    endDate:   endStr,
    indexName: indexName,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const resp = await fetch(NIFTY_PRI_URL, {
      method:  'POST',
      headers: NIFTY_HEADERS,
      body:    JSON.stringify({ cinfo }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`  [Nifty PRI API] HTTP ${resp.status} for ${indexName}`);
      return [];
    }

    const json = await resp.json();
    let raw;
    if (typeof json.d === 'string') {
      raw = JSON.parse(json.d);
    } else if (Array.isArray(json.d)) {
      raw = json.d;
    } else {
      console.warn(`  [Nifty PRI API] Unexpected shape for ${indexName}`);
      return [];
    }

    // NSE record shape: { Date: "01 Jan 2020", Open: "...", High: "...", Low: "...", Close: "..." }
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const records = [];
    for (const r of raw) {
      const parts = (r.Date || r.date || '').trim().split(' ');
      if (parts.length !== 3) continue;
      const month = months[parts[1]];
      if (month === undefined) continue;
      const d = new Date(parseInt(parts[2]), month, parseInt(parts[0]));
      if (isNaN(d.getTime())) continue;

      const price = parseFloat(r.Close || r.close || 0);
      if (price <= 0) continue;

      records.push({ date: d.toISOString().split('T')[0], price });
    }

    records.sort((a, b) => a.date.localeCompare(b.date));
    return records;

  } catch (err) {
    clearTimeout(timer);
    console.warn(`  [Nifty PRI API] Error for ${indexName}: ${err.message}`);
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dataDir = path.join(__dirname, 'data');

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║   Phase 0.3 — Nifty Price Index Collection            ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`  Period : ${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}`);
  console.log(`  Indices: ${NIFTY_PROXY_INDICES.length}`);
  console.log('');

  const lines = ['date,index_name,price'];

  for (const idx of NIFTY_PROXY_INDICES) {
    console.log(`  ▸ Fetching PRI: ${idx}`);
    const records = await fetchNiftyPriceIndex(idx);
    console.log(`    ✓ ${records.length} trading days`);
    for (const r of records) {
      lines.push(`${r.date},"${idx}",${r.price}`);
    }
    await sleep(1500);
  }

  const outPath = path.join(dataDir, 'nifty_price_raw.csv');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`\n  ✅ Written: ${outPath} (${lines.length - 1} rows)`);
  console.log('\n  Phase 0.3 complete.\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
