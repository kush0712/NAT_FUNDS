/**
 * js/formatters.js
 * Display formatting helpers used across all views.
 * Depends on: state (for state.compareList in fmtAUM), METRIC_TOOLTIPS (constants.js)
 */

// ─── Number / value formatters ────────────────────────────────────────────────

/**
 * Format a numeric value with colour coding.
 * @param {*} val
 * @param {string} suffix  '%' colours green/red; '' colours green/red; anything else is neutral
 * @param {number} decimals
 */
function fmt(val, suffix = '%', decimals = 2) {
  if (val === null || val === undefined) return '<span class="text-outline text-xs">N/A</span>';
  if (val === 'Insufficient Data')       return '<span class="text-outline text-xs tracking-normal whitespace-nowrap">Insufficient Data</span>';
  if (typeof val === 'object' && val.avg !== undefined) val = val.avg;
  const num = parseFloat(val);
  if (isNaN(num)) return '<span class="text-outline text-xs">N/A</span>';
  const formatted  = num.toFixed(decimals);
  const isPositive = num > 0;
  const color  = suffix === '%' ? (isPositive ? 'text-secondary font-bold' : 'text-error font-bold') : 'text-on-surface';
  const prefix = isPositive && suffix === '%' ? '+' : '';
  return `<span class="${color} tabular-nums">${prefix}${formatted}${suffix}</span>`;
}

/** Format a NAV value as ₹ with Indian locale and 2 decimal places. */
function fmtNav(val) {
  if (val === null || val === undefined) return 'N/A';
  return `₹ ${parseFloat(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Returns a human-readable reason why a fund's AUM is missing.
 * Used as tooltip text inside fmtAUM().
 */
function getAumMissingReason(f) {
  if (!f || !f.schemeName) return 'Data unavailable';
  const name = f.schemeName.toLowerCase();
  if (name.includes('idcw') || name.includes('dividend') || name.includes('bonus')) return 'Niche dividend plan';
  if (name.includes('half yearly') || name.includes('quarterly') || name.includes('monthly') || name.includes('weekly') || name.includes('daily')) return 'Custom payout option';
  if (name.includes('etf')) return 'Excluded from AMFI';
  if (window.location.hash.includes(f.schemeCode)) return 'Unpublished NFO';
  return 'Unpublished data';
}

/** Format AUM as ₹ Cr, or N/A with a tooltip explaining why data is missing. */
function fmtAUM(f) {
  if (!f || f.aum === null || f.aum === undefined) {
    const reason = getAumMissingReason(f);
    return `<span class="text-outline text-xs tooltip-trigger relative cursor-help">N/A
      <span class="glass-tooltip whitespace-nowrap !font-normal">${reason}</span>
    </span>`;
  }
  return `<span class="tabular-nums">₹ ${parseFloat(f.aum).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr</span>`;
}

/** Format the Consistency Score /10 with colour coding. */
function fmtScore(val) {
  if (val === null || val === undefined) return '<span class="text-outline text-xs">N/A</span>';
  if (typeof val !== 'number')           return '<span class="text-outline text-xs">N/A</span>';
  const score = parseFloat(val);
  let colorClass;
  if (score >= 7.5)      colorClass = 'text-emerald-600 font-extrabold';
  else if (score >= 5.0) colorClass = 'text-amber-600 font-bold';
  else                   colorClass = 'text-rose-600 font-bold';
  return `<span class="${colorClass} tabular-nums text-base">${score.toFixed(1)}<span class="text-[10px] text-outline font-normal">/10</span></span>`;
}

// ─── Name / label helpers ─────────────────────────────────────────────────────

/** Strip plan-type and option-type suffixes from a scheme name for compact display. */
function shortName(name) {
  return name
    .replace(/ - Direct Plan/gi, '')
    .replace(/ - Regular Plan/gi, '')
    .replace(/ - Direct/gi, '')
    .replace(/ - Regular/gi, '')
    .replace(/ - Growth Option/gi, '')
    .replace(/ - Growth/gi, '')
    .replace(/ Direct Plan/gi, '')
    .replace(/ Regular Plan/gi, '')
    .replace(/Growth Plan/gi, '')
    .replace(/- Growth$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns two-letter initials from an AMC name (used for avatar placeholders). */
function getInitials(name) {
  if (!name) return '??';
  const words = name.replace(/Mutual Fund/gi, '').replace(/MF/gi, '').trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

/** Returns a deterministic Tailwind colour pair for an AMC name (avatar background). */
function getInitialBg(name) {
  const colors = [
    'bg-indigo-100 text-indigo-800',
    'bg-emerald-100 text-emerald-800',
    'bg-amber-100 text-amber-800',
    'bg-rose-100 text-rose-800',
    'bg-sky-100 text-sky-800',
    'bg-violet-100 text-violet-800',
    'bg-teal-100 text-teal-800',
    'bg-orange-100 text-orange-800',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  return colors[Math.abs(hash) % colors.length];
}

/** Returns an inline info icon with a glass tooltip for a given metric key. */
function tooltipHtml(key) {
  const text = METRIC_TOOLTIPS[key] || '';
  return `<span class="tooltip-trigger relative cursor-help">
    <span class="material-symbols-outlined text-xs ml-0.5 align-middle text-outline">info</span>
    <span class="glass-tooltip">${text}</span>
  </span>`;
}

// ─── Risk badge ───────────────────────────────────────────────────────────────

/** Returns a Tailwind colour pair for a SEBI riskometer label. */
function getRiskBadgeColor(level) {
  if (!level) return 'bg-surface-container-high text-on-surface-variant';
  const l = level.toLowerCase().trim();
  if (l === 'very high')       return 'bg-red-100 text-red-800';
  if (l === 'high')            return 'bg-tertiary-container text-on-tertiary-container';
  if (l === 'moderately high') return 'bg-orange-100 text-orange-800';
  if (l === 'moderate')        return 'bg-amber-100 text-amber-800';
  if (l === 'low to moderate') return 'bg-lime-100 text-lime-800';
  if (l === 'low')             return 'bg-emerald-100 text-emerald-800';
  return 'bg-surface-container-high text-on-surface-variant';
}
