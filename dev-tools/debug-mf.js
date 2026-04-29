const fs   = require('fs');
const path = require('path');

const terData   = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ter-data.json'), 'utf8'));
const fundsPath = path.join(__dirname, '..', 'cache', 'processed_funds.json');
const funds = fs.existsSync(fundsPath) ? JSON.parse(fs.readFileSync(fundsPath, 'utf8')).funds : [];

const _terIndex = {};
for (const t of terData) {
    _terIndex[t.normalized_name] = t;
}

function normalizeSchemeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\b(direct|regular|growth|dividend|idcw|bonus|payout|reinvestment|retail|institutional|plan|option|monthly|quarterly|half yearly|annual)\b/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

let exactMatch = 0;
let fuzzyMatch = 0;
let missing = 0;
let missingNames = [];

for (const f of funds) {
  if (!f.schemeName) continue;
  const normalized = normalizeSchemeName(f.schemeName);
  
  if (_terIndex[normalized]) {
    exactMatch++;
  } else {
    let found = false;
    for (const k in _terIndex) {
      if (k.includes(normalized) || normalized.includes(k)) {
        found = true;
        fuzzyMatch++;
        break;
      }
    }
    if (!found) {
       missing++;
       missingNames.push(f.schemeName);
    }
  }
}

console.log('Total:', funds.length);
console.log('Exact:', exactMatch, 'Fuzzy:', fuzzyMatch, 'Missing:', missing);
if (missingNames.length > 0) {
    console.log('Sample Missing:', missingNames.slice(0, 10));
}
