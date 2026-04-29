/**

const logger = require('../shared/logger'); * AMFI NAV Parser
 * Fetches and parses the AMFI NAV text file to extract fund data with categories.
 * Differentiates index funds by their tracked index.
 */

const AMFI_NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';

// Category mapping from AMFI section headers
const CATEGORY_MAP = {
  // Equity
  'equity scheme - large cap fund': { type: 'Equity', subCategory: 'Large Cap' },
  'equity scheme - large & mid cap fund': { type: 'Equity', subCategory: 'Large & Mid Cap' },
  'equity scheme - mid cap fund': { type: 'Equity', subCategory: 'Mid Cap' },
  'equity scheme - small cap fund': { type: 'Equity', subCategory: 'Small Cap' },
  'equity scheme - multi cap fund': { type: 'Equity', subCategory: 'Multi Cap' },
  'equity scheme - flexi cap fund': { type: 'Equity', subCategory: 'Flexi Cap' },
  'equity scheme - elss': { type: 'Equity', subCategory: 'ELSS' },
  'equity scheme - dividend yield fund': { type: 'Equity', subCategory: 'Dividend Yield' },
  'equity scheme - value fund': { type: 'Equity', subCategory: 'Value Fund' },
  'equity scheme - contra fund': { type: 'Equity', subCategory: 'Contra Fund' },
  'equity scheme - focused fund': { type: 'Equity', subCategory: 'Focused Fund' },
  'equity scheme - sectoral/ thematic': { type: 'Equity', subCategory: 'Sectoral/Thematic' },
  'equity scheme - thematic fund': { type: 'Equity', subCategory: 'Sectoral/Thematic' },

  // Debt
  'debt scheme - banking and psu fund': { type: 'Debt', subCategory: 'Banking & PSU' },
  'debt scheme - corporate bond fund': { type: 'Debt', subCategory: 'Corporate Bond' },
  'debt scheme - credit risk fund': { type: 'Debt', subCategory: 'Credit Risk' },
  'debt scheme - dynamic bond': { type: 'Debt', subCategory: 'Dynamic Bond' },
  'debt scheme - floater fund': { type: 'Debt', subCategory: 'Floater' },
  'debt scheme - gilt fund': { type: 'Debt', subCategory: 'Gilt' },
  'debt scheme - gilt fund with 10 year constant duration': { type: 'Debt', subCategory: 'Gilt 10Y' },
  'debt scheme - liquid fund': { type: 'Debt', subCategory: 'Liquid' },
  'debt scheme - long duration fund': { type: 'Debt', subCategory: 'Long Duration' },
  'debt scheme - low duration fund': { type: 'Debt', subCategory: 'Low Duration' },
  'debt scheme - medium duration fund': { type: 'Debt', subCategory: 'Medium Duration' },
  'debt scheme - medium to long duration fund': { type: 'Debt', subCategory: 'Medium to Long Duration' },
  'debt scheme - money market fund': { type: 'Debt', subCategory: 'Money Market' },
  'debt scheme - overnight fund': { type: 'Debt', subCategory: 'Overnight' },
  'debt scheme - short duration fund': { type: 'Debt', subCategory: 'Short Duration' },
  'debt scheme - ultra short duration fund': { type: 'Debt', subCategory: 'Ultra Short Duration' },

  // Hybrid
  'hybrid scheme - aggressive hybrid fund': { type: 'Hybrid', subCategory: 'Aggressive Hybrid' },
  'hybrid scheme - arbitrage fund': { type: 'Hybrid', subCategory: 'Arbitrage' },
  'hybrid scheme - balanced advantage fund': { type: 'Hybrid', subCategory: 'Balanced Advantage' },
  'hybrid scheme - conservative hybrid fund': { type: 'Hybrid', subCategory: 'Conservative Hybrid' },
  'hybrid scheme - dynamic asset allocation': { type: 'Hybrid', subCategory: 'Dynamic Asset Allocation' },
  'hybrid scheme - equity savings': { type: 'Hybrid', subCategory: 'Equity Savings' },
  'hybrid scheme - multi asset allocation': { type: 'Hybrid', subCategory: 'Multi Asset Allocation' },

  // Solution Oriented
  'solution oriented scheme - children\'s fund': { type: 'Solution', subCategory: "Children's Fund" },
  'solution oriented scheme - retirement fund': { type: 'Solution', subCategory: 'Retirement Fund' },

  // Other / Index / ETF
  'other scheme - etf': { type: 'ETF', subCategory: 'ETF' },
  'other scheme - index funds': { type: 'Index', subCategory: 'Index Fund' },
  'other scheme - fof domestic': { type: 'Other', subCategory: 'Fund of Funds - Domestic' },
  'other scheme - fof overseas': { type: 'Other', subCategory: 'Fund of Funds - Overseas' },
};

// ─── Index Fund Sub-Category Mapping ─────────────────────────
// Patterns to differentiate index funds by what they track
const INDEX_PATTERNS = [
  { pattern: /nifty\s*50(?!\s*next)/i, subCategory: 'Nifty 50 Index' },
  { pattern: /nifty\s*next\s*50/i, subCategory: 'Nifty Next 50 Index' },
  { pattern: /nifty\s*midcap\s*150/i, subCategory: 'Nifty Midcap 150 Index' },
  { pattern: /nifty\s*midcap\s*100/i, subCategory: 'Nifty Midcap 100 Index' },
  { pattern: /nifty\s*smallcap\s*250/i, subCategory: 'Nifty Smallcap 250 Index' },
  { pattern: /nifty\s*smallcap\s*50/i, subCategory: 'Nifty Smallcap 50 Index' },
  { pattern: /nifty\s*small\s*cap/i, subCategory: 'Nifty Smallcap Index' },
  { pattern: /nifty\s*mid\s*cap/i, subCategory: 'Nifty Midcap Index' },
  { pattern: /nifty\s*500/i, subCategory: 'Nifty 500 Index' },
  { pattern: /nifty\s*200/i, subCategory: 'Nifty 200 Index' },
  { pattern: /nifty\s*100/i, subCategory: 'Nifty 100 Index' },
  { pattern: /sensex/i, subCategory: 'Sensex Index' },
  { pattern: /bse\s*500/i, subCategory: 'BSE 500 Index' },
  { pattern: /nifty\s*bank/i, subCategory: 'Nifty Bank Index' },
  { pattern: /nifty\s*it/i, subCategory: 'Nifty IT Index' },
  { pattern: /nifty\s*pharma/i, subCategory: 'Nifty Pharma Index' },
  { pattern: /nifty\s*auto/i, subCategory: 'Nifty Auto Index' },
  { pattern: /nifty\s*financial/i, subCategory: 'Nifty Financial Index' },
  { pattern: /nifty\s*infra/i, subCategory: 'Nifty Infra Index' },
  { pattern: /nifty\s*consumption/i, subCategory: 'Nifty Consumption Index' },
  { pattern: /nifty\s*energy/i, subCategory: 'Nifty Energy Index' },
  { pattern: /nifty\s*metal/i, subCategory: 'Nifty Metal Index' },
  { pattern: /nifty\s*realty/i, subCategory: 'Nifty Realty Index' },
  { pattern: /nifty\s*alpha/i, subCategory: 'Nifty Alpha Index' },
  { pattern: /nifty\s*ev/i, subCategory: 'Nifty EV Index' },
  { pattern: /nifty\s*total\s*market/i, subCategory: 'Nifty Total Market Index' },
  { pattern: /nasdaq/i, subCategory: 'NASDAQ Index' },
  { pattern: /s\s*&\s*p\s*500|s&p500/i, subCategory: 'S&P 500 Index' },
  { pattern: /gilt|g.sec|gsec/i, subCategory: 'Gilt/G-Sec Index' },
  { pattern: /liquid|crisil|overnight|money\s*market|short\s*duration/i, subCategory: 'Debt Index' },
  { pattern: /target\s*maturity/i, subCategory: 'Target Maturity Index' },
  { pattern: /equal\s*weight/i, subCategory: 'Equal Weight Index' },
  { pattern: /momentum/i, subCategory: 'Momentum Index' },
  { pattern: /value/i, subCategory: 'Value Index' },
  { pattern: /quality/i, subCategory: 'Quality Index' },
  { pattern: /dividend/i, subCategory: 'Dividend Index' },
  { pattern: /multi\s*asset|multi\s*factor/i, subCategory: 'Multi-Factor Index' },
];

/**
 * Determine the specific index a fund tracks from its name
 */
function getIndexSubCategory(schemeName) {
  for (const { pattern, subCategory } of INDEX_PATTERNS) {
    if (pattern.test(schemeName)) {
      return subCategory;
    }
  }
  return 'Other Index';
}

/**
 * Determine plan type from scheme name
 */
function getPlanType(schemeName) {
  const name = schemeName.toLowerCase();
  let planType = 'Regular';
  let optionType = 'Growth';

  if (name.includes('direct')) planType = 'Direct';

  if (name.includes('idcw') || name.includes('dividend') || name.includes('income distribution')) {
    optionType = 'IDCW';
  } else if (name.includes('bonus')) {
    optionType = 'Bonus';
  }

  return { planType, optionType };
}

function getInitials(amcName) {
  if (!amcName) return '??';
  const words = amcName.replace(/Mutual Fund/gi, '').trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Parse the AMFI NAV text file
 * Returns: { funds: [...], categories: {...} }
 */
async function parseAMFINav() {
  logger.info('[AMFI] Fetching NAV data...');
  const response = await fetch(AMFI_NAV_URL);
  const text = await response.text();
  const lines = text.split('\n');

  const funds = [];
  let currentCategory = null;
  let currentAMC = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().replace(/\r/g, '');

    if (!line) continue;
    if (line.startsWith('Scheme Code;')) continue;

    // Check for category header
    const categoryMatch = line.match(/^Open Ended Schemes\((.+)\)\s*$/i);
    if (categoryMatch) {
      const categoryText = categoryMatch[1].toLowerCase().trim();
      currentCategory = CATEGORY_MAP[categoryText] || null;
      if (!currentCategory) {
        for (const [key, val] of Object.entries(CATEGORY_MAP)) {
          if (categoryText.includes(key) || key.includes(categoryText)) {
            currentCategory = val;
            break;
          }
        }
      }
      if (!currentCategory) {
        if (categoryText.includes('equity')) currentCategory = { type: 'Equity', subCategory: 'Other' };
        else if (categoryText.includes('debt')) currentCategory = { type: 'Debt', subCategory: 'Other' };
        else if (categoryText.includes('hybrid')) currentCategory = { type: 'Hybrid', subCategory: 'Other' };
        else if (categoryText.includes('index')) currentCategory = { type: 'Index', subCategory: 'Index Fund' };
        else if (categoryText.includes('etf')) currentCategory = { type: 'ETF', subCategory: 'ETF' };
        else currentCategory = { type: 'Other', subCategory: 'Other' };
      }
      continue;
    }

    // Skip close-ended / interval schemes
    if (line.match(/^Close Ended Schemes/i) || line.match(/^Interval Fund Schemes/i)) {
      currentCategory = null;
      continue;
    }

    // AMC name line
    if (!line.includes(';') && currentCategory) {
      currentAMC = line;
      continue;
    }

    // Scheme data line
    if (line.includes(';') && currentCategory) {
      const parts = line.split(';');
      if (parts.length >= 6) {
        const schemeCode = parts[0].trim();
        const isinGrowth = parts[1].trim() || null;
        const isinDivReinvest = parts[2].trim() || null;
        const schemeName = parts[3].trim();
        const navStr = parts[4].trim();
        const dateStr = parts[5].trim();

        const nav = parseFloat(navStr);
        if (isNaN(nav) || nav <= 0) continue;

        const { planType, optionType } = getPlanType(schemeName);

        // Determine sub-category — differentiate index funds
        let subCategory = currentCategory.subCategory;
        if (currentCategory.type === 'Index') {
          subCategory = getIndexSubCategory(schemeName);
        }

        funds.push({
          schemeCode,
          isinGrowth: isinGrowth === '-' ? null : isinGrowth,
          isinDivReinvest: isinDivReinvest === '-' ? null : isinDivReinvest,
          schemeName,
          nav,
          date: dateStr,
          type: currentCategory.type,
          subCategory,
          planType,
          optionType,
          amc: currentAMC || 'Unknown',
          amcInitials: getInitials(currentAMC),
          // Placeholders — enriched during boot
          aum: null,
          ter: null,
          cagr1y: null,
          cagr3y: null,
          cagr5y: null,
          rollingReturn1y: null,  // { avg, min, max } or null
          rollingReturn3y: null,  // { avg, min, max } or null
          sharpeRatio: null,
          standardDeviation: null,
          beta: null,
          riskLevel: null,
        });
      }
    }
  }

  logger.info(`[AMFI] Parsed ${funds.length} total schemes`);

  // Build category summary
  const categories = {};
  for (const fund of funds) {
    const key = fund.type;
    if (!categories[key]) {
      categories[key] = { count: 0, subCategories: {} };
    }
    categories[key].count++;
    if (!categories[key].subCategories[fund.subCategory]) {
      categories[key].subCategories[fund.subCategory] = 0;
    }
    categories[key].subCategories[fund.subCategory]++;
  }

  return { funds, categories };
}

/**
 * Filter funds to get representative set across all categories
 * Prioritizes Direct-Growth plans, ensures coverage across types
 */
function selectTopFunds(funds, targetCount = 1500) {
  // Group by type + subCategory
  const groups = {};
  for (const f of funds) {
    const key = `${f.type}|${f.subCategory}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  const selected = [];
  const groupKeys = Object.keys(groups);
  const perGroup = Math.max(5, Math.ceil(targetCount / groupKeys.length));

  for (const key of groupKeys) {
    const groupFunds = groups[key];
    const directGrowth = groupFunds.filter(f => f.planType === 'Direct' && f.optionType === 'Growth');
    const regularGrowth = groupFunds.filter(f => f.planType === 'Regular' && f.optionType === 'Growth');
    const directIDCW = groupFunds.filter(f => f.planType === 'Direct' && f.optionType === 'IDCW');
    const regularIDCW = groupFunds.filter(f => f.planType === 'Regular' && f.optionType === 'IDCW');

    const picks = [];
    for (const pool of [directGrowth, regularGrowth, directIDCW, regularIDCW]) {
      for (const f of pool) {
        if (picks.length >= perGroup) break;
        picks.push(f);
      }
    }
    selected.push(...picks);
  }

  if (selected.length > targetCount * 1.5) {
    return selected.slice(0, targetCount);
  }

  return selected;
}

module.exports = { parseAMFINav, selectTopFunds, getPlanType };
