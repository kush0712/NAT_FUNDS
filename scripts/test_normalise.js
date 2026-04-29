'use strict';
// Exact copy of normaliseName from fundPerformanceService.js
function normaliseName(name) {
  let s = (name || '').toLowerCase().replace(/\s*&\s*/g, ' and ');
  s = s.replace(/\s*\(.*?\)/g, '');
  const splitRx = /\s*-\s*(direct|regular|retail|growth|idcw|dividend|bonus|payout|reinvest(?:ment)?|daily|weekly|fortnightly|monthly|quarterly|half.?yearly|annual|flexi|income\s+distribution)\b/i;
  const splitIdx = s.search(splitRx);
  if (splitIdx > 0) s = s.slice(0, splitIdx);
  const splitRx2 = /\s+(direct|regular|retail)\s+plan\b/i;
  const splitIdx2 = s.search(splitRx2);
  if (splitIdx2 > 0) s = s.slice(0, splitIdx2);
  s = s.replace(/\b(growth|idcw|dividend|bonus|payout|reinvest(?:ment)?|daily|weekly|fortnightly|monthly|quarterly|annual|flexi)\s*$/gi, '');
  s = s.replace(/\b(direct|regular|retail)\s*(plan)?\s*$/gi, '');
  s = s.replace(/\bfund\s*$/gi, '');
  return s.replace(/\s+/g, ' ').trim();
}

// ── Unit tests ──────────────────────────────────────────────────────────────
const tests = [
  // Standard Direct/Regular plans
  ['HDFC Flexi Cap Fund - Direct Plan - Growth',       'hdfc flexi cap'],
  ['HDFC Flexi Cap Fund - Regular Plan - Growth',      'hdfc flexi cap'],
  ['Axis Flexi Cap Fund - Direct Plan - Growth Option','axis flexi cap'],

  // IDCW frequency variants (the old bug)
  ['ICICI Prudential Banking and PSU Debt Fund -  Daily IDCW',         'icici prudential banking and psu debt'],
  ['ICICI Prudential Banking and PSU Debt Fund -  Weekly IDCW',        'icici prudential banking and psu debt'],
  ['ICICI Prudential Banking and PSU Debt Fund - Direct Plan -  Quarterly IDCW','icici prudential banking and psu debt'],
  ['DSP Banking & PSU Debt Fund - Direct Plan - IDCW - Daily Reinvest','dsp banking and psu debt'],
  ['SBI Banking & PSU Fund - Direct Plan - Weekly IDCW',               'sbi banking and psu'],

  // & → and
  ['Aditya Birla Sun Life Large & Mid Cap Fund - Direct Plan - Growth', 'aditya birla sun life large and mid cap'],
  ['ICICI Prudential Banking & PSU Debt Fund - Direct Plan - Growth',   'icici prudential banking and psu debt'],

  // Formerly Known As (parentheses)
  ['Sundaram Banking & PSU Fund (Formerly Known as Sundaram Banking & PSU Debt Fund) - Direct Growth','sundaram banking and psu'],

  // Without-dash plan types
  ['Motilal Oswal Large Cap Direct Plan Growth',       'motilal oswal large cap'],

  // Dividend Yield — "dividend" should NOT be stripped (it's in the fund name)
  ['HDFC Dividend Yield Fund - Direct Plan - Growth',  'hdfc dividend yield'],
  ['HDFC Dividend Yield Fund - IDCW Option',           'hdfc dividend yield'],

  // Fund-of-Funds — trailing "fund" stripped but "of" remains (not a problem for matching)
  ['Mirae Asset NYSE FANG+ ETF Fund of Fund - Direct Plan - Growth',   'mirae asset nyse fang+ etf fund of'],

  // Flexi Cap — "flexi" NOT stripped (it's not at the end)
  ['DSP Flexi Cap Fund - Regular Plan - IDCW',         'dsp flexi cap'],
  ['Kotak Flexicap Fund - Direct Plan - Growth',       'kotak flexicap'],

  // Half-Yearly IDCW
  ['ICICI Prudential Banking and PSU Debt Fund Direct Plan Half Yearly IDCW Option','icici prudential banking and psu debt'],

  // Retail Plan (legacy)
  ['Kotak Coporate Bond Fund- Retail Plan-Growth Option','kotak coporate bond'],

  // Segregated — normalises cleanly (no AUM exists, but key should be clean)
  ['UTI Bond Fund ( Segregated - 17022020) - Direct Plan - Growth Option','uti bond'],

  // Simple equity funds
  ['Mirae Asset Large Cap Fund - Direct Plan - Growth',  'mirae asset large cap'],
  ['SBI Blue Chip Fund - Regular Plan - Growth',         'sbi blue chip'],
  ['Parag Parikh Flexi Cap Fund - Direct Plan - Growth', 'parag parikh flexi cap'],

  // Income Distribution cum Capital Withdrawal long form
  ['SBI Banking & PSU Fund - Direct Plan - Daily Income Distribution cum Capital Withdrawal Option (IDCW)','sbi banking and psu'],

  // No plan suffix at all (bare fund name from AUM index side)
  ['HDFC Large Cap Fund',                              'hdfc large cap'],
  ['Axis Bluechip Fund',                               'axis bluechip'],
];

let pass = 0, fail = 0;
for (const [input, expected] of tests) {
  const got = normaliseName(input);
  const ok  = got === expected;
  if (ok) { pass++; }
  else {
    fail++;
    console.log(`FAIL  input   : "${input}"`);
    console.log(`      expected: "${expected}"`);
    console.log(`      got     : "${got}"`);
    console.log();
  }
}
console.log(`Unit tests: ${pass}/${tests.length} passed, ${fail} failed`);
console.log();

// ── False-positive check: ensure matched funds aren't stealing wrong AUM ──
const fs   = require('fs');
const path = require('path');
const AUM  = path.join(__dirname,'..','data','aum-data.json');
const PROC = path.join(__dirname,'..','cache','processed_funds.json');

if (!fs.existsSync(AUM) || !fs.existsSync(PROC)) {
  console.log('Skipping false-positive check (data files not found)');
  process.exit(fail > 0 ? 1 : 0);
}

const aumRaw   = JSON.parse(fs.readFileSync(AUM,'utf-8'));
const { funds} = JSON.parse(fs.readFileSync(PROC,'utf-8'));

// Rebuild index with current normaliseName (mirrors server)
const idx = {};
for (const [k, v] of Object.entries(aumRaw.data || {})) {
  idx[normaliseName(k)] = { aum: v, origKey: k };
}

// For each fund that has an AUM in cache, verify the matched key makes sense
let fpFails = 0;
const checked = [];
for (const f of funds) {
  if (f.aum === null || f.aum === undefined) continue;
  const key = normaliseName(f.schemeName);
  if (!key) continue;
  const match = idx[key];
  if (!match) continue; // matched via substring/token — skip for this check

  // Flag if the matched AUM key shares < 2 tokens with the fund key
  const tokens = s => new Set(s.split(/\s+/).filter(t => t.length > 2));
  const ta = tokens(key), tb = tokens(match.origKey.toLowerCase());
  const shared = [...ta].filter(t => tb.has(t)).length;
  // Flag suspicious matches: fewer shared tokens than expected
  // Scale threshold: if key has only 1 token, 1 shared is fine; require 2+ only for longer keys
  if (shared < Math.min(2, ta.size)) {
    fpFails++;
    checked.push({ fund: f.schemeName, key, matched: match.origKey });
  }
}
if (fpFails === 0) {
  console.log('False-positive check: 0 suspicious exact matches ✅');
} else {
  console.log(`False-positive check: ${fpFails} suspicious matches (possible wrong AUM):`);
  checked.slice(0,10).forEach(c => {
    console.log(`  Fund   : "${c.fund}"`);
    console.log(`  Key    : "${c.key}"`);
    console.log(`  Matched: "${c.matched}"`);
    console.log();
  });
}

process.exit((fail > 0 || fpFails > 0) ? 1 : 0);
