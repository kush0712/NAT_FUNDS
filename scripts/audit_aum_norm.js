'use strict';
const fs   = require('fs');
const path = require('path');

const PROCESSED = path.join(__dirname, '..', 'cache', 'processed_funds.json');
const AUM_FILE  = path.join(__dirname, '..', 'data', 'aum-data.json');

if (!fs.existsSync(PROCESSED)) { console.error('cache/processed_funds.json not found'); process.exit(1); }
if (!fs.existsSync(AUM_FILE))  { console.error('aum-data.json not found');              process.exit(1); }

const { funds } = JSON.parse(fs.readFileSync(PROCESSED, 'utf-8'));
const aumRaw    = JSON.parse(fs.readFileSync(AUM_FILE,  'utf-8'));
const aumRawIndex = aumRaw.data || {};

// ── MUST match fundPerformanceService.js normaliseName exactly ───────────────
function normaliseName(name) {
  let s = (name || '').toLowerCase().replace(/\s*&\s*/g, ' and ');
  s = s.replace(/\s*\(.*?\)/g, '');
  const splitRx = /\s*-\s*(direct|regular|retail|growth|idcw|dividend|bonus|payout|reinvest(?:ment)?|daily|weekly|fortnightly|monthly|quarterly|half.?yearly|annual|flexi|income\s+distribution)\b/i;
  const splitIdx = s.search(splitRx);
  if (splitIdx > 0) s = s.slice(0, splitIdx);
  s = s.replace(/\b(growth|idcw|dividend|bonus|payout|reinvest(?:ment)?|daily|weekly|fortnightly|monthly|quarterly|annual|flexi)\s*$/gi, '');
  s = s.replace(/\b(direct|regular|retail)\s*(plan)?\s*$/gi, '');
  s = s.replace(/\bfund\s*$/gi, '');
  return s.replace(/\s+/g, ' ').trim();
}

// Re-normalise AUM index with the SAME function (simulates server rebuild)
const aumIndex = {};
for (const [rawKey, val] of Object.entries(aumRawIndex)) {
  // AUM keys in JSON are already normalised; re-normalise so & → and is applied
  const reKey = normaliseName(rawKey.replace(/\bfund\s*$/gi,'').trim()) // raw key might already lack "Fund"
             || normaliseName(rawKey);
  aumIndex[reKey] = val;
}
// Also index raw keys as-is (in case server didn't rebuild yet)
for (const [k, v] of Object.entries(aumRawIndex)) {
  if (!aumIndex[k]) aumIndex[k] = v;
}

function fuzzyMatch(schemeName) {
  if (!schemeName) return { found: false };
  const key = normaliseName(schemeName);
  if (!key) return { found: false, key };

  if (aumIndex[key] !== undefined)                        return { found: true, method: 'exact', key };
  for (const k of Object.keys(aumIndex))
    if (k.includes(key) || key.includes(k))             return { found: true, method: 'substring', key, matched: k };
  const keyNoSp = key.replace(/\s+/g, '');
  for (const k of Object.keys(aumIndex))
    if (k.replace(/\s+/g,'') === keyNoSp)               return { found: true, method: 'spacecollapse', key, matched: k };

  const tokens = s => s.split(/\s+/).filter(t => t.length > 2);
  const ta = new Set(tokens(key));
  let best = 0, bestKey;
  for (const k of Object.keys(aumIndex)) {
    const tb = tokens(k);
    if (!ta.size || !tb.length) continue;
    const shared = tb.filter(t => ta.has(t)).length;
    const score  = shared / Math.max(ta.size, tb.length);
    if (score > best) { best = score; bestKey = k; }
  }
  if (best >= 0.75) return { found: true, method: 'token', key, matched: bestKey, score: best.toFixed(2) };

  return { found: false, key };
}

// ── Audit ────────────────────────────────────────────────────────────────────
const total = funds.length;
const noAUM = [], byMethod = { exact:0, substring:0, spacecollapse:0, token:0, notfound:0 }, byType = {};

for (const f of funds) {
  const r = fuzzyMatch(f.schemeName);
  if (r.found) { byMethod[r.method]++; }
  else {
    noAUM.push({ type: f.type, name: f.schemeName, key: r.key });
    byMethod.notfound++;
    byType[f.type] = (byType[f.type] || 0) + 1;
  }
}

const withAUM = total - noAUM.length;
console.log('═══════════════════════════════════════════════════════════');
console.log(' AUM Normalisation Audit — Full Universe');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Total funds : ${total}`);
console.log(`With AUM    : ${withAUM} (${(withAUM/total*100).toFixed(1)}%)`);
console.log(`Without AUM : ${noAUM.length} (${(noAUM.length/total*100).toFixed(1)}%)`);
console.log();
console.log('Match breakdown:');
Object.entries(byMethod).forEach(([m,c]) => console.log(`  ${m.padEnd(16)}: ${c}`));
console.log();
console.log('No-AUM by fund type:');
Object.entries(byType).sort((a,b)=>b[1]-a[1])
  .forEach(([t,c]) => console.log(`  ${t.padEnd(20)}: ${c}`));
console.log();
console.log('Sample no-AUM funds (first 25):');
noAUM.slice(0,25).forEach(f => {
  console.log(`  [${(f.type||'?').padEnd(8)}] ${f.name}`);
  console.log(`           key: "${f.key}"`);
});
