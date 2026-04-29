/**
 * NAT funds — Frontend Application
 * Client-side SPA with hash routing, API data fetching, and DOM rendering.
 */

// ─── State ──────────────────────────────────────────────────
const state = {
  planType: 'Direct',
  optionType: 'Growth',
  currentView: 'home',
  currentCategory: null,
  currentSubCategories: [],
  selectedSubCategories: [],
  selectedMarketCaps: [],
  sortBy: 'cagr3y',
  sortOrder: 'desc',
  page: 1,
  limit: 20,
  compareList: [], // scheme codes
  searchQuery: '',
  categorySummary: {},
  loadingComplete: false,
};

// Category metadata
const CATEGORY_META = {
  Equity: { icon: 'trending_up', label: 'Equity', tag: 'High Growth', color: 'bg-secondary-container/30 text-secondary', desc: 'Stocks & high-yield market assets.' },
  Debt: { icon: 'account_balance', label: 'Debt', tag: 'Stable', color: 'bg-surface-container-high text-on-surface-variant', desc: 'Bonds, gilts & corporate deposits.' },
  Hybrid: { icon: 'pie_chart', label: 'Hybrid', tag: 'Balanced', color: 'bg-surface-container-high text-on-surface-variant', desc: 'Mixed risk-adjusted portfolios.' },
  Index: { icon: 'list_alt', label: 'Index Funds', tag: 'Passive', color: 'bg-surface-container-high text-on-surface-variant', desc: 'Low-cost market tracking funds.' },
  ETF: { icon: 'currency_exchange', label: 'ETFs', tag: 'Exchange Traded', color: 'bg-surface-container-high text-on-surface-variant', desc: 'Exchange-traded market instruments.' },
  Solution: { icon: 'shield', label: 'Solution', tag: 'Goal Based', color: 'bg-surface-container-high text-on-surface-variant', desc: 'Retirement & children focused.' },
  Other: { icon: 'browse_gallery', label: 'Other', tag: 'Specialized', color: 'bg-surface-container-high text-on-surface-variant', desc: 'Fund of funds & specialized.' },
};

// Tooltip content for metrics
const METRIC_TOOLTIPS = {
  cagr1y: "How much your ₹100 would have grown in 1 year, expressed as annual %.",
  cagr3y: "Average yearly growth rate over the last 3 years — shows medium-term consistency.",
  cagr5y: "Average yearly growth rate over the last 5 years — longer period, more reliable.",
  rollingReturn1y: "Median CAGR across ALL possible 1-year periods (daily rolling). Shows consistency, not just start-to-end. Includes benchmark-beating stats.",
  rollingReturn3y: "Return distribution across monthly-sampled 3-year periods. Each bar shows the realistic range of outcomes for an investor starting at any month. P10–P90 = 80% of all outcomes. P25–P75 = middle half. Dot = median.",
  sharpeRatio: "Reward per unit of risk. Higher = better. Above 1.0 is good, above 2.0 is excellent.",
  sortinoRatio: "Like Sharpe, but only penalises downside volatility (negative months). Higher = better. More meaningful than Sharpe for equity funds with asymmetric return distributions.",
  standardDeviation: "How much returns swing up & down. Lower = more predictable. Think of it as volatility.",
  beta: "Sensitivity to market. Beta=1 means moves exactly with market. <1 is less risky, >1 is more volatile.",
  ter: "Annual fee deducted from your returns. Every 0.1% saved compounds significantly over decades.",
  aum: "Total money managed by this fund (₹ Crores). Larger AUM generally means more investor trust.",
  nav: "Net Asset Value — the current price of one unit of this mutual fund.",
  riskLevel: "SEBI-mandated Riskometer fetched directly from AMFI's Fund Performance portal (riskometerScheme field). Not calculated — this is the official regulator-assigned risk label updated daily by the fund house.",
  maxDrawdown: "Worst peak-to-trough NAV decline in fund history, with recovery date. E.g. −38% means the fund fell 38% from its highest point before recovering. The most important risk metric for retail investors.",
  jensensAlpha: "Excess return above what market risk (Beta) predicts. Positive = manager added value beyond market exposure. Negative on an active fund = underperformance for the risk taken. Uses CAPM: Alpha = Fund Return − [Rf + Beta × (Benchmark − Rf)].",
  upsideCapture: "% of benchmark gains captured in up-market months. >100 means the fund outperformed the benchmark during rallies.",
  downsideCapture: "% of benchmark losses suffered in down-market months. <100 means better crash protection than the benchmark. Ideal: Upside Capture > 100, Downside Capture < 100.",
  calmarRatio: "3Y CAGR divided by Maximum Drawdown magnitude. Higher = better risk-adjusted returns. A fund with 12% CAGR and 20% drawdown (Calmar 0.60) is superior to 14% CAGR with 35% drawdown (Calmar 0.40).",
  informationRatio: "Consistency of benchmark outperformance per unit of active risk (tracking error). IR > 0.5 is good; > 1.0 is exceptional. Key metric for evaluating if an active fund justifies its higher expense ratio.",
  consistencyScore: "Composite quality score 1–10 aggregating rolling return consistency, downside protection, Sortino ratio, and expense efficiency. Scored only against funds in the same sub-category — a Liquid Fund's score is never compared to a Large Cap fund.",
};

// ─── API Helpers ────────────────────────────────────────────
async function api(endpoint) {
  const resp = await fetch(`/api${endpoint}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

// ─── Routing ────────────────────────────────────────────────
function getRoute() {
  const hash = window.location.hash || '#/';
  // Strip query string from hash before parsing route segments
  const hashPath = hash.replace('#', '').split('?')[0];
  const parts = hashPath.split('/').filter(Boolean);
  
  if (parts.length === 0) return { view: 'home' };
  if (parts[0] === 'explore') return { view: 'explore', category: parts[1] || 'Equity' };
  if (parts[0] === 'fund') return { view: 'fund', schemeCode: parts[1] };
  if (parts[0] === 'compare') return { view: 'compare' };
  return { view: 'home' };
}

function navigate(hash) {
  window.location.hash = hash;
}

// ─── View Management ────────────────────────────────────────
function showView(viewId) {
  ['view-home', 'view-explore', 'view-fund', 'view-compare', 'loading-screen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('view-enter');
  }
  
  // Update active nav
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.remove('text-indigo-900', 'border-b-2', 'border-indigo-900', 'font-semibold');
    a.classList.add('text-slate-500');
  });
  
  const navMap = { home: 'nav-dashboard', explore: 'nav-explore', compare: 'nav-compare' };
  const activeNav = document.getElementById(navMap[viewId.replace('view-', '')]);
  if (activeNav) {
    activeNav.classList.add('text-indigo-900', 'border-b-2', 'border-indigo-900', 'font-semibold');
    activeNav.classList.remove('text-slate-500');
  }
}

// ─── Plan Type & Option Type ────────────────────────────────
function setPlanType(type) {
  state.planType = type;
  document.getElementById('toggle-direct').classList.toggle('active', type === 'Direct');
  document.getElementById('toggle-regular').classList.toggle('active', type === 'Regular');
  state.page = 1;
  handleRoute();
}

function setOptionType(type) {
  state.optionType = type;
  document.getElementById('toggle-growth').classList.toggle('active', type === 'Growth');
  document.getElementById('toggle-idcw').classList.toggle('active', type === 'IDCW');
  state.page = 1;
  handleRoute();
}

// Make global
window.setPlanType = setPlanType;
window.setOptionType = setOptionType;

// ─── Charts ──────────────────────────────────────────────────
let navChartInstance = null;
let rr1yChartInstance = null;
let rr3yChartInstance = null;

window.updateNavChart = async function(schemeCode, period) {
  ['1y', '3y', '5y'].forEach(p => {
    const btn = document.getElementById(`btn-chart-${p}`);
    if (btn) {
      if (p === period) {
        btn.classList.replace('bg-white/50', 'bg-white');
        btn.classList.replace('bg-transparent', 'bg-white');
        btn.classList.add('shadow-sm', 'text-primary');
        btn.classList.remove('hover:bg-white/50');
      } else {
        btn.classList.replace('bg-white', 'bg-transparent');
        btn.classList.remove('shadow-sm', 'text-primary');
        btn.classList.add('hover:bg-white/50');
      }
    }
  });

  try {
    const res = await api(`/fund/${schemeCode}/nav-history?period=${period}`);
    if (!res.data || res.data.length === 0) return;
    
    const ctx = document.getElementById('navChart');
    if (!ctx) return;
    
    if (navChartInstance) navChartInstance.destroy();
    
    navChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: res.data.map(d => {
          const dt = new Date(d.date);
          return `${dt.toLocaleString('default', { month: 'short' })} '${dt.getFullYear().toString().substr(-2)}`;
        }),
        datasets: [{
          label: 'NAV',
          data: res.data.map(d => d.nav),
          borderColor: '#000666',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.1,
          fill: {
            target: 'origin',
            above: 'rgba(0, 6, 102, 0.05)'
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function(context) { return '₹ ' + context.parsed.y.toFixed(2); }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 10 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, border: { display: false }, ticks: { font: { size: 10 } } }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false }
      }
    });
  } catch (err) {
    console.error('Failed to load chart data', err);
  }
};

window.renderRollingReturnCharts = function(funds) {
  const chartSection = document.getElementById('rolling-return-chart-section');
  if (!chartSection) return;
  
  if (funds.length < 2) {
    chartSection.classList.add('hidden');
    return;
  }
  chartSection.classList.remove('hidden');

  const names = funds.map(f => shortName(f.schemeName));
  const colors = ['#000666', '#a0f399', '#ffb59d', '#8690ee'];

  const createChart = (canvasId, instance, prop) => {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return instance;
    if (instance) instance.destroy();
    
    // Only chart funds that have the data
    const validFunds = funds.filter(f => f[prop] && typeof f[prop] === 'object' && f[prop].avg !== undefined);
    if (validFunds.length === 0) return null;

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: validFunds.map(f => shortName(f.schemeName)),
        datasets: [
          {
            label: 'Min',
            data: validFunds.map(f => f[prop].min),
            backgroundColor: 'rgba(186, 26, 26, 0.7)',
            barPercentage: 0.25,
            categoryPercentage: 0.8
          },
          {
            label: 'Median',
            data: validFunds.map(f => f[prop].median || f[prop].avg),
            backgroundColor: validFunds.map((f, i) => colors[i % colors.length]),
            barPercentage: 0.5,
            categoryPercentage: 0.8
          },
          {
            label: 'Max',
            data: validFunds.map(f => f[prop].max),
            backgroundColor: 'rgba(27, 109, 36, 0.7)',
            barPercentage: 0.25,
            categoryPercentage: 0.8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: function(context) { return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + '%'; }
            }
          }
        },
        scales: {
          x: { stacked: false },
          y: { 
            stacked: false,
            title: { display: true, text: 'Annualized Return (%)' }
          }
        }
      }
    });
  };

  rr1yChartInstance = createChart('rolling-chart-1y', rr1yChartInstance, 'rollingReturn1y');
  rr3yChartInstance = createChart('rolling-chart-3y', rr3yChartInstance, 'rollingReturn3y');
};

// ─── Compare ────────────────────────────────────────────────
function toggleCompare(schemeCode) {
  const idx = state.compareList.indexOf(schemeCode);
  if (idx >= 0) {
    state.compareList.splice(idx, 1);
  } else if (state.compareList.length < 4) {
    state.compareList.push(schemeCode);
  }
  updateCompareBar();
  updateCompareCheckboxes();
}

function updateCompareBar() {
  const bar = document.getElementById('compare-bar');
  const text = document.getElementById('compare-bar-text');
  const action = document.getElementById('compare-action');
  const count = document.getElementById('compare-count');
  
  if (state.compareList.length >= 2) {
    bar.classList.add('visible');
    if (action) action.classList.remove('hidden');
    if (count) count.textContent = state.compareList.length;
  } else {
    bar.classList.remove('visible');
    if (action && state.compareList.length < 2) action.classList.add('hidden');
  }
  text.textContent = `${state.compareList.length} fund${state.compareList.length !== 1 ? 's' : ''} selected`;
}

function updateCompareCheckboxes() {
  document.querySelectorAll('.compare-cb').forEach(cb => {
    cb.checked = state.compareList.includes(cb.dataset.code);
  });
}

function clearCompare() {
  state.compareList = [];
  updateCompareBar();
  updateCompareCheckboxes();
}

function goToCompare() {
  if (state.compareList.length >= 2) {
    navigate(`#/compare?codes=${state.compareList.join(',')}`);
  }
}

window.toggleCompare = toggleCompare;
window.clearCompare = clearCompare;
window.goToCompare = goToCompare;

// ─── Formatting Helpers ─────────────────────────────────────
function fmt(val, suffix = '%', decimals = 2) {
  if (val === null || val === undefined) return '<span class="text-outline text-xs">N/A</span>';
  if (val === 'Insufficient Data') return '<span class="text-outline text-xs tracking-normal whitespace-nowrap">Insufficient Data</span>';
  if (typeof val === 'object' && val.avg !== undefined) val = val.avg;
  const num = parseFloat(val);
  if (isNaN(num)) return '<span class="text-outline text-xs">N/A</span>';
  const formatted = num.toFixed(decimals);
  const isPositive = num > 0;
  const color = suffix === '%' ? (isPositive ? 'text-secondary font-bold' : 'text-error font-bold') : 'text-on-surface';
  const prefix = isPositive && suffix === '%' ? '+' : '';
  return `<span class="${color} tabular-nums">${prefix}${formatted}${suffix}</span>`;
}

function fmtNav(val) {
  if (val === null || val === undefined) return 'N/A';
  return `₹ ${parseFloat(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getAumMissingReason(f) {
  if (!f || !f.schemeName) return 'Data unavailable';
  const name = f.schemeName.toLowerCase();
  // Most Missing AUMs are because of odd dividend plan identifiers or new ETFs
  if (name.includes('idcw') || name.includes('dividend') || name.includes('bonus')) return 'Niche dividend plan';
  if (name.includes('half yearly') || name.includes('quarterly') || name.includes('monthly') || name.includes('weekly') || name.includes('daily')) return 'Custom payout option';
  if (name.includes('etf')) return 'Excluded from AMFI';
  if (window.location.hash.includes(f.schemeCode)) return 'Unpublished NFO'; // General fallback
  return 'Unpublished data';
}

function fmtAUM(f) {
  if (!f || f.aum === null || f.aum === undefined) {
    const reason = getAumMissingReason(f);
    return `<span class="text-outline text-xs tooltip-trigger relative cursor-help">N/A
      <span class="glass-tooltip whitespace-nowrap !font-normal">${reason}</span>
    </span>`;
  }
  return `<span class="tabular-nums">₹ ${parseFloat(f.aum).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr</span>`;
}

function fmtScore(val) {
  if (val === null || val === undefined) return '<span class="text-outline text-xs">N/A</span>';
  if (typeof val !== 'number') return '<span class="text-outline text-xs">N/A</span>';
  const score = parseFloat(val);
  let colorClass;
  if (score >= 7.5) colorClass = 'text-emerald-600 font-extrabold';
  else if (score >= 5.0) colorClass = 'text-amber-600 font-bold';
  else colorClass = 'text-rose-600 font-bold';
  return `<span class="${colorClass} tabular-nums text-base">${score.toFixed(1)}<span class="text-[10px] text-outline font-normal">/10</span></span>`;
}

function getInitials(name) {
  if (!name) return '??';
  const words = name.replace(/Mutual Fund/gi, '').replace(/MF/gi, '').trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

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

function tooltipHtml(key) {
  const text = METRIC_TOOLTIPS[key] || '';
  return `<span class="tooltip-trigger relative cursor-help">
    <span class="material-symbols-outlined text-xs ml-0.5 align-middle text-outline">info</span>
    <span class="glass-tooltip">${text}</span>
  </span>`;
}

// Short scheme name (remove AMC prefix, plan type suffix for display)
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

// ─── Render: Sidebar ────────────────────────────────────────
function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  const types = ['Equity', 'Debt', 'Hybrid', 'Index', 'ETF', 'Solution', 'Other'];
  
  nav.innerHTML = types.map(type => {
    const meta = CATEGORY_META[type] || {};
    const count = state.categorySummary[type] ? state.categorySummary[type].count : 0;
    if (count === 0) return '';
    const isActive = state.currentView === 'explore' && state.currentCategory === type;
    return `
      <a href="#/explore/${type}" 
         class="flex items-center gap-3 px-6 py-3 transition-transform duration-200 hover:translate-x-1 ${
           isActive 
             ? 'bg-indigo-100 text-indigo-900 font-bold border-r-4 border-indigo-900' 
             : 'text-slate-600 hover:bg-slate-200'
         }">
        <span class="material-symbols-outlined text-xl" ${isActive ? "style=\"font-variation-settings: 'FILL' 1\"" : ''}>${meta.icon || 'folder'}</span>
        <span class="text-xs tracking-widest uppercase font-label">${meta.label || type}</span>
        <span class="ml-auto text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded tabular-nums">${count}</span>
      </a>
    `;
  }).join('');
}

// ─── Render: Home View ──────────────────────────────────────
async function renderHome() {
  showView('view-home');
  state.currentView = 'home';
  state.currentCategory = null;
  renderSidebar();
  
  try {
    // Fetch categories filtered by current plan/option type
    const cats = await api(`/categories?planType=${state.planType}&optionType=${state.optionType}`);
    state.categorySummary = cats;
    renderSidebar();
    
    // Render category cards
    const cardsEl = document.getElementById('category-cards');
    const types = ['Equity', 'Debt', 'Hybrid', 'Index', 'ETF', 'Solution'];
    
    cardsEl.innerHTML = types.filter(t => cats[t] && cats[t].count > 0).map(type => {
      const meta = CATEGORY_META[type];
      const count = cats[type].count;
      return `
        <a href="#/explore/${type}" class="group bg-white/80 backdrop-blur-md p-6 rounded-[1.5rem] hover:shadow-[0px_20px_50px_rgba(79,70,229,0.15)] hover:-translate-y-1.5 hover:bg-white border border-indigo-100 transition-all cursor-pointer relative overflow-hidden block">
          <div class="flex justify-between items-start mb-8">
            <span class="material-symbols-outlined text-3xl text-primary">${meta.icon}</span>
            <span class="text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 ${meta.color} rounded-full">${meta.tag}</span>
          </div>
          <h3 class="text-xl font-headline font-extrabold text-primary mb-1">${meta.label}</h3>
          <p class="text-on-surface-variant text-xs mb-4">${meta.desc}</p>
          <div class="flex items-center gap-2 text-on-surface-variant text-xs">
            <span class="tabular-nums font-bold">${count}</span>
            <span class="opacity-70">schemes</span>
          </div>
        </a>
      `;
    }).join('');
    
    // Fetch featured funds (top by 3Y CAGR from each category)
    const featuredEl = document.getElementById('featured-funds');
    const resp = await api(`/funds?planType=${state.planType}&optionType=${state.optionType}&sortBy=cagr3y&order=desc&limit=10`);
    
    if (resp.funds.length === 0) {
      featuredEl.innerHTML = '<div class="p-8 text-center text-on-surface-variant">Loading fund data... Please wait.</div>';
      return;
    }
    
    featuredEl.innerHTML = `
      <table class="w-full text-left">
        <thead>
          <tr class="bg-surface-container-low border-b border-outline-variant/15">
            <th class="px-6 py-4 text-[10px] font-bold tracking-widest uppercase text-on-surface-variant">Fund Name</th>
            <th class="px-6 py-4 text-[10px] font-bold tracking-widest uppercase text-on-surface-variant">Category</th>
            <th class="px-6 py-4 text-[10px] font-bold tracking-widest uppercase text-on-surface-variant text-right">3Y CAGR</th>
            <th class="px-6 py-4 text-[10px] font-bold tracking-widest uppercase text-on-surface-variant text-right">Risk</th>
            <th class="px-6 py-4 text-[10px] font-bold tracking-widest uppercase text-on-surface-variant text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-variant/15">
          ${resp.funds.map(f => `
            <tr class="group hover:bg-surface-bright transition-colors">
              <td class="px-6 py-5">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-lg ${getInitialBg(f.amc)} flex items-center justify-center font-bold text-xs">${getInitials(f.amc)}</div>
                  <div>
                    <a href="#/fund/${f.schemeCode}" class="font-headline font-bold text-primary hover:underline text-sm">${shortName(f.schemeName)}</a>
                    <p class="text-[10px] text-on-surface-variant uppercase">${f.planType} • ${f.optionType}</p>
                  </div>
                </div>
              </td>
              <td class="px-6 py-5 text-sm text-on-surface-variant">${f.type}: ${f.subCategory}</td>
              <td class="px-6 py-5 text-right text-sm">${fmt(f.cagr3y)}</td>
              <td class="px-6 py-5 text-right">
                ${f.riskLevel ? `<span class="text-[10px] font-bold tracking-wide px-3 py-1.5 ${getRiskBadgeColor(f.riskLevel)} rounded-full">${f.riskLevel}</span>` : '<span class="text-outline text-xs">—</span>'}
              </td>
              <td class="px-6 py-5 text-right">
                <a href="#/fund/${f.schemeCode}" class="px-3 py-1.5 border border-primary text-primary text-xs font-bold rounded-lg hover:bg-primary hover:text-white transition-all">View Details</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Error rendering home:', err);
  }
}

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

// ─── Render: Explore View ───────────────────────────────────
async function renderExplore(category) {
  showView('view-explore');
  state.currentView = 'explore';

  // When switching to a different category, clear sub-category and market-cap filters
  if (state.currentCategory !== category) {
    state.selectedSubCategories = [];
    state.selectedMarketCaps = [];
  }

  // Always reset to page 1 whenever we (re-)enter the explore view
  state.page = 1;
  state.currentCategory = category;
  renderSidebar();
  
  const meta = CATEGORY_META[category] || { label: category };
  
  // Breadcrumb
  document.getElementById('explore-breadcrumb').innerHTML = `
    <a href="#/" class="hover:text-primary cursor-pointer">Explore</a>
    <span class="material-symbols-outlined text-xs">chevron_right</span>
    <span class="font-semibold text-primary">${meta.label} Funds</span>
  `;
  document.getElementById('explore-title').textContent = `${meta.label} Deep-Dive`;
  document.getElementById('explore-subtitle').textContent = `Institutional grade analysis of ${meta.label.toLowerCase()} mutual funds. Screen across sub-categories and performance.`;
  document.getElementById('table-title').textContent = `${meta.label} Performance Matrix`;
  
  // Fetch categories for sub-category filters
  try {
    const cats = await api(`/categories?planType=${state.planType}&optionType=${state.optionType}`);

    state.categorySummary = cats;
    renderSidebar();
    
    const subCats = cats[category] ? cats[category].subCategories : {};
    state.currentSubCategories = Object.keys(subCats);
    
    // Render sub-category filters
    const filtersEl = document.getElementById('subcategory-filters');
    filtersEl.innerHTML = Object.entries(subCats).map(([sub, count]) => `
      <label class="flex items-center gap-3 group cursor-pointer">
        <input type="checkbox" 
               class="w-4 h-4 rounded border-outline text-primary focus:ring-primary subcategory-cb" 
               value="${sub}" 
               ${state.selectedSubCategories.includes(sub) ? 'checked' : ''}
               onchange="toggleSubCategory('${sub}')">
        <span class="text-sm font-medium text-on-surface group-hover:text-primary transition-colors">${sub}</span>
        <span class="ml-auto text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded tabular-nums">${count}</span>
      </label>
    `).join('');
    
    // Market Cap filters for Equity
    const mcSection = document.getElementById('marketcap-filter-section');
    const mcButtons = document.getElementById('marketcap-buttons');
    if (category === 'Equity') {
      const caps = ['Large Cap', 'Large & Mid Cap', 'Mid Cap', 'Small Cap', 'Multi Cap', 'Flexi Cap'];
      mcButtons.innerHTML = caps.map(cap => {
        const isActive = state.selectedMarketCaps.includes(cap);
        return `<button onclick="toggleMarketCap('${cap}')" class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition-all ${isActive ? 'bg-primary text-white border-primary' : 'bg-surface border-outline-variant/50 text-on-surface-variant hover:border-primary/50'}">${cap}</button>`;
      }).join('');
      mcSection.classList.remove('hidden');
    } else {
      mcSection.classList.add('hidden');
    }
    
    // Fetch and render funds
    await fetchAndRenderFunds();
  } catch (err) {
    console.error('Error rendering explore:', err);
  }
}

window.toggleMarketCap = function(cap) {
  const idx = state.selectedMarketCaps.indexOf(cap);
  if (idx >= 0) state.selectedMarketCaps.splice(idx, 1);
  else state.selectedMarketCaps.push(cap);
  state.page = 1;
  fetchAndRenderFunds();
  renderExplore(state.currentCategory);
};

window.toggleSubCategory = function(sub) {
  const idx = state.selectedSubCategories.indexOf(sub);
  if (idx >= 0) {
    state.selectedSubCategories.splice(idx, 1);
  } else {
    state.selectedSubCategories.push(sub);
  }
  state.page = 1;
  fetchAndRenderFunds();
};

async function fetchAndRenderFunds() {
  let url = `/funds?type=${state.currentCategory}&planType=${state.planType}&optionType=${state.optionType}`;
  url += `&sortBy=${state.sortBy}&order=${state.sortOrder}&page=${state.page}&limit=${state.limit}`;
  
  if (state.selectedSubCategories.length > 0) {
    url += `&subCategory=${state.selectedSubCategories.join(',')}`;
  }
  if (state.selectedMarketCaps.length > 0) {
    url += `&marketCap=${state.selectedMarketCaps.join(',')}`;
  }
  
  try {
    const resp = await api(url);
    renderFundTable(resp.funds, resp.pagination);
  } catch (err) {
    console.error('Error fetching funds:', err);
  }
}

function renderFundTable(funds, pagination) {
  const tbody = document.getElementById('fund-table-body');
  
  if (funds.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6" class="px-6 py-16 text-center text-on-surface-variant">
        <span class="material-symbols-outlined text-4xl text-outline mb-2 block">search_off</span>
        No funds found. Try adjusting your filters.
      </td></tr>
    `;
  } else {
    tbody.innerHTML = funds.map((f, i) => `
      <tr class="${i % 2 === 1 ? 'bg-indigo-50/30' : ''} hover:bg-indigo-50/80 relative transition-colors group">
        <td class="px-4 py-4">
          <input type="checkbox" 
                 class="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary compare-cb" 
                 data-code="${f.schemeCode}"
                 ${state.compareList.includes(f.schemeCode) ? 'checked' : ''}
                 onchange="toggleCompare('${f.schemeCode}')">
        </td>
        <td class="px-4 py-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded ${getInitialBg(f.amc)} flex items-center justify-center font-bold text-[10px] flex-shrink-0">${getInitials(f.amc)}</div>
            <div class="min-w-0">
              <a href="#/fund/${f.schemeCode}" class="text-sm font-bold text-primary group-hover:underline cursor-pointer flex items-center gap-2 truncate max-w-[300px]">
                <span class="truncate">${shortName(f.schemeName)}</span>
                ${(f.cagr3y > 0 && f.sharpeRatio > 1.0 && f.planType === 'Direct' && f.aum > 500) ? `<span class="inline-flex items-center px-2 py-1 rounded-full text-[9px] font-bold bg-secondary-container text-on-secondary-container tooltip-trigger relative cursor-help shrink-0">★ PICK<span class="glass-tooltip" style="width:12rem; font-weight:normal; white-space:normal;">Suitable for beginners: >500Cr AUM, Direct plan, good risk-adjusted returns (Sharpe > 1.0).</span></span>` : ''}
              </a>
              <div class="text-[10px] text-on-surface-variant uppercase">${f.subCategory} • ${f.planType}</div>
            </div>
          </div>
        </td>
        <td class="px-4 py-4 text-right font-label text-sm tabular-nums">${fmtNav(f.nav)}</td>
        <td class="px-4 py-4 text-right text-sm tabular-nums">${fmtAUM(f)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr1y)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr3y)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr5y)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.sharpeRatio, '', 2)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.standardDeviation)}</td>
        <td class="px-4 py-4 text-right text-sm hidden xl:table-cell">${fmt(f.beta, '', 2)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmtScore(f.consistencyScore)}</td>
      </tr>
    `).join('');
  }
  
  // Pagination
  const pagEl = document.getElementById('table-pagination');
  pagEl.innerHTML = `
    <span class="text-xs text-on-surface-variant font-medium">
      Showing ${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.totalCount)} of ${pagination.totalCount} funds
    </span>
    <div class="flex gap-2">
      <button onclick="changePage(${pagination.page - 1})" 
              class="px-3 py-1.5 bg-surface-container-highest rounded text-[11px] font-bold text-on-surface hover:bg-surface-container-high transition-colors ${pagination.page <= 1 ? 'opacity-50 cursor-not-allowed' : ''}"
              ${pagination.page <= 1 ? 'disabled' : ''}>PREVIOUS</button>
      <span class="px-3 py-1.5 text-[11px] font-bold text-on-surface-variant tabular-nums">
        ${pagination.page} / ${pagination.totalPages}
      </span>
      <button onclick="changePage(${pagination.page + 1})" 
              class="px-3 py-1.5 bg-primary text-white rounded text-[11px] font-bold hover:opacity-90 transition-opacity ${pagination.page >= pagination.totalPages ? 'opacity-50 cursor-not-allowed' : ''}"
              ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>NEXT</button>
    </div>
  `;
}

window.changePage = function(newPage) {
  state.page = newPage;
  fetchAndRenderFunds();
  // Scroll to top of table
  document.getElementById('fund-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Sort handling
document.addEventListener('click', e => {
  const sortable = e.target.closest('.sortable');
  if (sortable && sortable.dataset.sort) {
    const field = sortable.dataset.sort;
    if (state.sortBy === field) {
      state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortBy = field;
      state.sortOrder = 'desc';
    }
    state.page = 1;
    fetchAndRenderFunds();
  }
});

// ─── Render: Fund Detail ────────────────────────────────────
async function renderFundDetail(schemeCode) {
  showView('view-fund');
  state.currentView = 'fund';
  renderSidebar();
  
  const container = document.getElementById('fund-detail-content');
  container.innerHTML = '<div class="flex justify-center py-20"><div class="spinner"></div></div>';
  
  try {
    const fund = await api(`/fund/${schemeCode}`);
    const isEquityLike = ['Equity', 'Index', 'ETF'].includes(fund.type);
    
    container.innerHTML = `
      <!-- Header -->
      <div class="mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <nav class="flex items-center gap-2 text-on-surface-variant text-[12px] mb-4">
            <a href="#/" class="hover:text-primary cursor-pointer">Explore</a>
            <span class="material-symbols-outlined text-[14px]">chevron_right</span>
            <a href="#/explore/${fund.type}" class="hover:text-primary cursor-pointer">${fund.type}</a>
            <span class="material-symbols-outlined text-[14px]">chevron_right</span>
            <span class="text-on-surface font-semibold">${fund.subCategory}</span>
          </nav>
          <div class="flex items-center gap-4 mb-2">
            <div class="w-12 h-12 rounded-xl ${getInitialBg(fund.amc)} flex items-center justify-center font-bold text-lg">${getInitials(fund.amc)}</div>
            <h1 class="text-2xl md:text-3xl font-extrabold font-headline text-on-surface tracking-tight">${shortName(fund.schemeName)}</h1>
          </div>
          <p class="text-on-surface-variant max-w-2xl leading-relaxed">
            ${fund.amc} • ${fund.type}: ${fund.subCategory} • ${fund.planType} Plan • ${fund.optionType}
          </p>
        </div>
        <div class="flex gap-3">
          <button onclick="toggleCompare('${fund.schemeCode}'); updateCompareBar();" class="px-5 py-3 flex items-center gap-2 border border-outline-variant/30 text-primary font-semibold rounded-xl bg-surface-container-lowest hover:bg-surface-bright transition-all text-sm">
            <span class="material-symbols-outlined">compare_arrows</span>
            Compare
          </button>
        </div>
      </div>
      
      <!-- Bento Grid -->
      <div class="grid grid-cols-1 2xl:grid-cols-12 gap-8">
        <!-- Performance Section -->
        <div class="2xl:col-span-8 space-y-8 min-w-0">
          <!-- NAV Chart -->
          <section class="bg-surface-container-lowest p-8 rounded-xl shadow-sm">
            <div class="flex justify-between items-center mb-6">
              <div>
                <h2 class="text-xl font-bold font-headline mb-1">Growth Performance</h2>
                <p class="text-sm text-on-surface-variant">Historical NAV trend</p>
              </div>
              <div class="flex bg-surface-container-high rounded-lg p-1">
                <button onclick="updateNavChart('${schemeCode}', '1y')" id="btn-chart-1y" class="px-3 py-1 text-[10px] font-bold rounded-md hover:bg-white/50 transition-colors uppercase">1Y</button>
                <button onclick="updateNavChart('${schemeCode}', '3y')" id="btn-chart-3y" class="px-3 py-1 text-[10px] font-bold rounded-md hover:bg-white/50 transition-colors uppercase">3Y</button>
                <button onclick="updateNavChart('${schemeCode}', '5y')" id="btn-chart-5y" class="px-3 py-1 bg-white shadow-sm text-primary text-[10px] font-bold rounded-md uppercase">5Y</button>
              </div>
            </div>
            <div class="h-[280px] w-full relative overflow-hidden">
              <canvas id="navChart"></canvas>
            </div>
          </section>
          
          <!-- Returns & Risk Metrics -->
          <section class="bg-surface-container-lowest p-8 rounded-xl">
            <h2 class="text-xl font-bold font-headline mb-8">Performance & Risk Metrics</h2>
            
            <!-- Returns -->
            <div class="mb-8">
              <h3 class="text-xs font-bold uppercase tracking-widest text-outline mb-1">Returns</h3>
              <p class="text-[10px] text-on-surface-variant mb-4">Trailing as of ${new Date().toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'})} (latest NAV)</p>
              ${fund.fundAgeMonths != null && fund.fundAgeMonths < 36 ? `
              <div class="flex items-start gap-2 text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3">
                <span class="material-symbols-outlined text-sm shrink-0">info</span>
                <span>This fund is <strong>${fund.fundAgeMonths} months old</strong>. Metrics requiring 3-year history (CAGR 3Y, Beta, etc.) are unavailable — consistent with Tickertape &amp; Zerodha Coin.</span>
              </div>` : ''}
              <div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
                <div class="p-4 rounded-lg bg-surface-container-low">
                  <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                    CAGR 1Y ${tooltipHtml('cagr1y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums">${fmt(fund.cagr1y)}</p>
                </div>
                <div class="p-4 rounded-lg bg-surface-container-low">
                  <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                    CAGR 3Y ${tooltipHtml('cagr3y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums">${fmt(fund.cagr3y)}</p>
                </div>
                <div class="p-4 rounded-lg bg-surface-container-low">
                  <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                    CAGR 5Y ${tooltipHtml('cagr5y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums">${fmt(fund.cagr5y)}</p>
                </div>
                <div class="p-4 rounded-lg bg-primary-container">
                  <p class="text-[10px] font-bold text-on-primary-container uppercase tracking-widest mb-1">
                    Since Inception
                  </p>
                  <p class="text-xl font-bold tabular-nums text-primary">${fmt(fund.cagrSinceInception)}</p>
                  ${fund.fundAgeMonths != null ? `<p class="text-[9px] text-on-surface-variant mt-1">${fund.fundAgeMonths} months</p>` : ''}
                </div>
              </div>
            </div>

            <!-- Rolling Returns Analysis -->
            ${(fund.rollingReturn1y && typeof fund.rollingReturn1y === 'object') || (fund.rollingReturn3y && typeof fund.rollingReturn3y === 'object') ? `
            <div class="mb-8">
              <h3 class="text-xs font-bold uppercase tracking-widest text-outline mb-4">Rolling Returns Analysis (Daily CAGR)</h3>
              ${fund.isIdcwPlan ? `<div class="flex items-start gap-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                <span class="material-symbols-outlined text-sm shrink-0">info</span>
                <span>IDCW plan: returns are based on <strong>NAV movement only</strong> — dividends declared are not included in these figures.</span>
              </div>` : ''}
              <div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
                ${fund.rollingReturn1y && typeof fund.rollingReturn1y === 'object' ? `
                <div class="p-5 rounded-lg bg-surface-container-low border border-outline-variant/10">
                  <p class="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-3 flex items-center gap-1">
                    1-Year Rolling ${tooltipHtml('rollingReturn1y')}
                  </p>
                  <div class="grid gap-3 mb-3" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">
                    <div>
                      <p class="text-[10px] text-outline uppercase">Median</p>
                      <p class="text-xl font-bold tabular-nums">${fmt(fund.rollingReturn1y.median)}</p>
                    </div>
                    <div>
                      <p class="text-[10px] text-outline uppercase">Average</p>
                      <p class="text-lg tabular-nums text-on-surface-variant">${fmt(fund.rollingReturn1y.avg)}</p>
                    </div>
                    <div>
                      <p class="text-[10px] text-outline uppercase">Best</p>
                      <p class="text-sm font-bold tabular-nums text-secondary">${fmt(fund.rollingReturn1y.max)}</p>
                    </div>
                    <div>
                      <p class="text-[10px] text-outline uppercase">Worst</p>
                      <p class="text-sm font-bold tabular-nums text-error">${fmt(fund.rollingReturn1y.min)}</p>
                    </div>
                  </div>
                  <div class="border-t border-outline-variant/10 pt-3 space-y-1.5">
                    <div class="flex justify-between text-xs">
                      <span class="text-on-surface-variant">✅ Positive returns</span>
                      <span class="font-bold tabular-nums">${fund.rollingReturn1y.positivePercent}%</span>
                    </div>
                    ${fund.rollingReturn1y.beatBenchmarkPercent !== null ? `
                    <div class="flex justify-between text-xs">
                      <span class="text-on-surface-variant">📊 Beat benchmark</span>
                      <span class="font-bold tabular-nums ${fund.rollingReturn1y.beatBenchmarkPercent >= 50 ? 'text-secondary' : 'text-error'}">${fund.rollingReturn1y.beatBenchmarkPercent}%</span>
                    </div>` : ''}
                    <div class="flex justify-between text-xs">
                      <span class="text-outline">${fund.rollingReturn1y.totalPeriods.toLocaleString()} periods analyzed</span>
                    </div>
                  </div>
                </div>` : ''}
                ${fund.rollingReturn3y && typeof fund.rollingReturn3y === 'object' && fund.rollingReturn3y.totalPeriods != null ? `
                <div class="p-5 rounded-lg bg-surface-container-low border border-outline-variant/10">
                  <p class="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-3 flex items-center gap-1">
                    3-Year Rolling ${tooltipHtml('rollingReturn3y')}
                  </p>
                  <div class="grid gap-3 mb-4" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">
                    <div>
                      <p class="text-[10px] text-outline uppercase">Median</p>
                      <p class="text-xl font-bold tabular-nums">${fmt(fund.rollingReturn3y.median)}</p>
                    </div>
                    <div>
                      <p class="text-[10px] text-outline uppercase">Average</p>
                      <p class="text-lg tabular-nums text-on-surface-variant">${fmt(fund.rollingReturn3y.avg)}</p>
                    </div>
                  </div>

                  ${(() => {
                    const rr = fund.rollingReturn3y;
                    if (rr.p10 == null || rr.p90 == null) return '';
                    const range = rr.p90 - rr.p10;
                    const safePos = (v) => range > 0 ? Math.max(0, Math.min(100, ((v - rr.p10) / range) * 100)) : 50;
                    const innerLeft  = safePos(rr.p25).toFixed(1);
                    const innerWidth = (range > 0 ? Math.max(0, Math.min(100, ((rr.p75 - rr.p25) / range) * 100)) : 50).toFixed(1);
                    const medPos     = safePos(rr.median).toFixed(1);
                    const isPos = (v) => v >= 0 ? 'text-secondary' : 'text-error';
                    return `
                    <div class="mb-4">
                      <div class="flex justify-between text-[9px] font-semibold mb-1.5">
                        <span class="${isPos(rr.p10)}">P10 ${fmt(rr.p10)}</span>
                        <span class="text-outline text-[8px] font-normal">← 80% of all 3Y outcomes →</span>
                        <span class="${isPos(rr.p90)}">P90 ${fmt(rr.p90)}</span>
                      </div>
                      <div class="relative h-1.5 rounded-full bg-surface-container-high" style="overflow:visible">
                        <div class="absolute rounded-full bg-primary/30"
                             style="top:-3px;bottom:-3px;left:${innerLeft}%;width:${innerWidth}%"></div>
                        <div class="absolute rounded-full bg-primary shadow-sm"
                             style="top:-5px;bottom:-5px;width:3px;left:calc(${medPos}% - 1.5px)"></div>
                      </div>
                      <div class="flex justify-between text-[9px] text-on-surface-variant mt-1.5">
                        <span>P25 ${fmt(rr.p25)}</span>
                        <span>P75 ${fmt(rr.p75)}</span>
                      </div>
                    </div>`;
                  })()}

                  <div class="border-t border-outline-variant/10 pt-3 space-y-1.5">
                    <div class="flex justify-between text-xs">
                      <span class="text-on-surface-variant">✅ Positive returns</span>
                      <span class="font-bold tabular-nums">${fund.rollingReturn3y.positivePercent}%</span>
                    </div>
                    ${fund.rollingReturn3y.beatBenchmarkPercent !== null ? `
                    <div class="flex justify-between text-xs">
                      <span class="text-on-surface-variant">📊 Beat benchmark</span>
                      <span class="font-bold tabular-nums ${fund.rollingReturn3y.beatBenchmarkPercent >= 50 ? 'text-secondary' : 'text-error'}">${fund.rollingReturn3y.beatBenchmarkPercent}%</span>
                    </div>` : ''}
                    <div class="flex justify-between text-xs">
                      <span class="text-outline">${fund.rollingReturn3y.totalPeriods.toLocaleString()} monthly windows analyzed</span>
                    </div>
                  </div>
                </div>` : ''}
              </div>
            </div>
            ` : ''}
            </div>
            
            <!-- Risk (conditional on fund type) -->
            <div>
              <h3 class="text-xs font-bold uppercase tracking-widest text-outline mb-4">
                Risk & Volatility
                ${!isEquityLike ? '<span class="text-[10px] normal-case font-medium text-on-surface-variant ml-2">(Some metrics less relevant for non-equity funds)</span>' : ''}
              </h3>
              ${['Overnight', 'Liquid', 'Money Market', 'Ultra Short Duration'].includes(fund.subCategory) && fund.type === 'Debt'
                ? `<p class="text-sm text-on-surface-variant p-4 bg-surface-container-low rounded-lg leading-relaxed">
                    <span class="material-symbols-outlined text-xs align-middle mr-1">info</span>
                    Volatility metrics (Std Deviation, Sharpe Ratio) are <strong>not meaningful</strong> for
                    <span class="font-semibold">${fund.subCategory}</span> funds — returns are near-constant by design.
                    Use <strong>YTM</strong> and <strong>Modified Duration</strong> as primary risk signals for these funds.
                   </p>`
                : `<div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
                    ${(isEquityLike || fund.type === 'Hybrid') ? `<div class="p-4 rounded-lg bg-surface-container-low"><p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">Sharpe Ratio ${tooltipHtml('sharpeRatio')}</p><p class="text-xl font-bold tabular-nums">${fmt(fund.sharpeRatio, '', 2)}</p></div>` : ''}
                    <div class="p-4 rounded-lg bg-surface-container-low"><p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">Std Deviation ${tooltipHtml('standardDeviation')}</p><p class="text-xl font-bold tabular-nums">${fmt(fund.standardDeviation)}</p></div>
                    ${isEquityLike ? `<div class="p-4 rounded-lg bg-surface-container-low"><p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">Beta ${tooltipHtml('beta')}</p><p class="text-xl font-bold tabular-nums">${fmt(fund.beta, '', 2)}</p></div>` : ''}
                   </div>`
              }
            </div>
          </section>
          
          <!-- Advanced Risk & Alpha Metrics -->
          <section class="bg-surface-container-lowest p-8 rounded-xl" id="advanced-metrics-section">
            <h2 class="text-xl font-bold font-headline mb-2">Advanced Risk &amp; Alpha</h2>
            <p class="text-xs text-on-surface-variant mb-8">Institutional-grade signals for risk-adjusted performance evaluation.</p>
            
            <!-- Maximum Drawdown -->
            ${fund.maxDrawdown !== null && fund.maxDrawdown !== undefined ? `
            <div class="mb-8">
              <h3 class="text-xs font-bold uppercase tracking-widest text-outline mb-3 flex items-center gap-1">Maximum Drawdown ${tooltipHtml('maxDrawdown')}</h3>
              <div class="p-5 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60">
                <div class="flex items-baseline gap-3 mb-4">
                  <span class="text-4xl font-extrabold text-rose-600 tabular-nums">${fund.maxDrawdown.toFixed(1)}%</span>
                  <span class="text-xs text-rose-500 font-medium">worst peak-to-trough decline</span>
                </div>
                <div class="flex items-center gap-3 text-xs">
                  <div class="flex flex-col items-center">
                    <span class="w-7 h-7 rounded-full bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center text-[10px] font-bold text-emerald-700">▲</span>
                    <span class="text-[9px] text-on-surface-variant mt-1 font-semibold">PEAK</span>
                    <span class="text-[10px] font-bold text-on-surface tabular-nums">${fund.maxDrawdownPeak ? new Date(fund.maxDrawdownPeak).toLocaleDateString('en-IN', {month:'short', year:'numeric'}) : 'N/A'}</span>
                  </div>
                  <div class="flex-1 h-px bg-rose-300 relative"><div class="absolute inset-0 border-t-2 border-dashed border-rose-300"></div></div>
                  <div class="flex flex-col items-center">
                    <span class="w-7 h-7 rounded-full bg-rose-100 border-2 border-rose-500 flex items-center justify-center text-[10px] font-bold text-rose-700">▼</span>
                    <span class="text-[9px] text-on-surface-variant mt-1 font-semibold">TROUGH</span>
                    <span class="text-[10px] font-bold text-on-surface tabular-nums">${fund.maxDrawdownTrough ? new Date(fund.maxDrawdownTrough).toLocaleDateString('en-IN', {month:'short', year:'numeric'}) : 'N/A'}</span>
                  </div>
                  <div class="flex-1 h-px relative"><div class="absolute inset-0 border-t-2 border-dashed ${fund.maxDrawdownRecovery ? 'border-emerald-400' : 'border-outline-variant/30'}"></div></div>
                  <div class="flex flex-col items-center">
                    <span class="w-7 h-7 rounded-full ${fund.maxDrawdownRecovery ? 'bg-emerald-100 border-2 border-emerald-400 text-emerald-700' : 'bg-surface-container border-2 border-outline-variant/30 text-outline'} flex items-center justify-center text-[10px] font-bold">★</span>
                    <span class="text-[9px] text-on-surface-variant mt-1 font-semibold">RECOVERY</span>
                    <span class="text-[10px] font-bold tabular-nums ${fund.maxDrawdownRecovery ? 'text-on-surface' : 'text-outline'}">${fund.maxDrawdownRecovery ? new Date(fund.maxDrawdownRecovery).toLocaleDateString('en-IN', {month:'short', year:'numeric'}) : 'Not yet recovered'}</span>
                  </div>
                </div>
              </div>
            </div>` : ''}
            
            <!-- Calmar + Sortino -->
            <div class="grid gap-4 mb-8" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
              <div class="p-4 rounded-lg bg-surface-container-low">
                <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                  Calmar Ratio ${tooltipHtml('calmarRatio')}
                </p>
                <p class="text-xl font-bold tabular-nums">${typeof fund.calmarRatio === 'number' ? fund.calmarRatio.toFixed(2) : '<span class="text-outline text-sm font-normal">N/A</span>'}</p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">3Y CAGR / |Max Drawdown|</p>
              </div>
              <div class="p-4 rounded-lg bg-surface-container-low">
                <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                  Sortino Ratio ${tooltipHtml('sortinoRatio')}
                </p>
                <p class="text-xl font-bold tabular-nums">${typeof fund.sortinoRatio === 'number' ? fund.sortinoRatio.toFixed(2) : '<span class="text-outline text-sm font-normal">' + (fund.sortinoRatio || 'N/A') + '</span>'}</p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">Downside-risk adjusted</p>
              </div>
            </div>
            
            <!-- Capture Ratios (equity only) -->
            ${typeof fund.upsideCapture === 'number' || typeof fund.downsideCapture === 'number' ? `
            <div class="mb-8">
              <h3 class="text-xs font-bold uppercase tracking-widest text-outline mb-3">
                Market Capture Ratios 
                <span class="tooltip-trigger relative cursor-help">
                  <span class="material-symbols-outlined text-[13px] text-outline align-middle">info</span>
                  <span class="glass-tooltip" style="width:16rem">${METRIC_TOOLTIPS.upsideCapture} ${METRIC_TOOLTIPS.downsideCapture}</span>
                </span>
              </h3>
               <div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
                <div class="p-5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/60 text-center">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-2">Upside Capture</p>
                  <p class="text-3xl font-extrabold tabular-nums text-emerald-700">${typeof fund.upsideCapture === 'number' ? fund.upsideCapture.toFixed(0) : 'N/A'}<span class="text-lg">%</span></p>
                  <p class="text-[10px] text-emerald-600 mt-1">${typeof fund.upsideCapture === 'number' ? (fund.upsideCapture >= 100 ? '▲ Outperforms in rallies' : '▼ Underperforms in rallies') : ''}</p>
                </div>
                <div class="p-5 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 text-center">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-rose-700 mb-2">Downside Capture</p>
                  <p class="text-3xl font-extrabold tabular-nums text-rose-700">${typeof fund.downsideCapture === 'number' ? fund.downsideCapture.toFixed(0) : 'N/A'}<span class="text-lg">%</span></p>
                  <p class="text-[10px] text-rose-600 mt-1">${typeof fund.downsideCapture === 'number' ? (fund.downsideCapture < 100 ? '✓ Better crash protection' : '✗ Amplifies benchmark losses') : ''}</p>
                </div>
              </div>
            </div>` : ''}
            
            <!-- Jensen's Alpha + Information Ratio (equity only) -->
            ${(() => {
              const hasAlpha = typeof fund.jensensAlpha === 'number';
              const hasAmfiIR = fund.amfiIR && (
                fund.amfiIR.ir1y !== null || fund.amfiIR.ir3y !== null ||
                fund.amfiIR.ir5y !== null || fund.amfiIR.ir10y !== null
              );
              const hasComputedIR = typeof fund.informationRatio === 'number';
              if (!hasAlpha && !hasAmfiIR && !hasComputedIR) return '';

              function irColor(v) {
                if (v === null || v === undefined) return 'text-outline';
                if (v >= 1.0) return 'text-emerald-600 font-extrabold';
                if (v >= 0.5) return 'text-secondary font-bold';
                if (v >= 0)   return 'text-amber-600 font-bold';
                return 'text-error font-bold';
              }
              function irLabel(v) {
                if (v === null || v === undefined) return '—';
                return `<span class="${irColor(v)} tabular-nums">${v >= 0 ? '' : ''}${parseFloat(v).toFixed(2)}</span>`;
              }

              return `
            <div class="space-y-4 mt-0">
              ${hasAlpha ? `
              <div class="p-4 rounded-lg bg-surface-container-low">
                <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                  Jensen&#39;s Alpha ${tooltipHtml('jensensAlpha')}
                </p>
                <p class="text-xl font-bold tabular-nums ${fund.jensensAlpha >= 0 ? 'text-secondary' : 'text-error'}">${fund.jensensAlpha >= 0 ? '+' : ''}${fund.jensensAlpha.toFixed(2)}%</p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">${fund.jensensAlpha > 0 ? 'Manager added value' : fund.jensensAlpha === 0 ? 'No excess return' : 'Underperformed CAPM'}</p>
              </div>` : ''}

              ${hasAmfiIR ? `
              <div class="p-4 rounded-lg bg-surface-container-low">
                <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-3 flex items-center gap-1">
                  Information Ratio ${tooltipHtml('informationRatio')}
                  <span class="ml-auto text-[9px] normal-case font-medium text-outline bg-surface-container px-2 py-0.5 rounded-full">Source: AMFI</span>
                </p>
                <div class="grid gap-2" style="grid-template-columns:repeat(4,minmax(60px,1fr))">
                  ${[
                    { period: '1Y',  val: fund.amfiIR.ir1y  },
                    { period: '3Y',  val: fund.amfiIR.ir3y  },
                    { period: '5Y',  val: fund.amfiIR.ir5y  },
                    { period: '10Y', val: fund.amfiIR.ir10y },
                  ].map(({ period, val }) => `
                  <div class="text-center p-2 rounded-md bg-surface-container">
                    <p class="text-[9px] font-bold text-outline uppercase mb-1">${period}</p>
                    <p class="text-base tabular-nums ${irColor(val)}">${val !== null && val !== undefined ? parseFloat(val).toFixed(2) : '—'}</p>
                  </div>`).join('')}
                </div>
                <div class="mt-2 flex items-center gap-3 text-[9px] text-on-surface-variant">
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>≥1.0 Exceptional</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-secondary inline-block"></span>≥0.5 Good</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>0–0.5 Moderate</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-rose-400 inline-block"></span>&lt;0 Lag</span>
                </div>
              </div>` : hasComputedIR ? `
              <div class="p-4 rounded-lg bg-surface-container-low">
                <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                  Information Ratio ${tooltipHtml('informationRatio')}
                </p>
                <p class="text-xl font-bold tabular-nums ${fund.informationRatio >= 0.5 ? 'text-secondary' : fund.informationRatio >= 0 ? 'text-amber-600' : 'text-error'}">${fund.informationRatio.toFixed(2)}</p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">${fund.informationRatio >= 1.0 ? 'Exceptional consistency' : fund.informationRatio >= 0.5 ? 'Good consistency' : fund.informationRatio >= 0 ? 'Below benchmark half the time' : 'Consistent underperformer'}</p>
              </div>` : ''}
            </div>`;
            })()}
          </section>

        </div>
        
        <!-- Sidebar Facts -->
        <div class="2xl:col-span-4 space-y-6 min-w-0">
          <!-- Key Facts -->
          <section class="bg-primary text-white p-6 rounded-xl shadow-xl">
            <h2 class="text-lg font-bold font-headline mb-6 border-b border-white/10 pb-4">Key Fund Facts</h2>
            <div class="space-y-5">
              <div class="flex justify-between items-center">
                <span class="text-white/60 text-sm">NAV</span>
                <span class="text-xl font-bold tabular-nums">${fmtNav(fund.nav)}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-white/60 text-sm">As On</span>
                <span class="text-base font-bold">${fund.date || 'N/A'}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-white/60 text-sm flex items-center gap-1">AUM <span class="tooltip-trigger relative cursor-help"><span class="material-symbols-outlined text-xs text-white/40">info</span><span class="glass-tooltip !text-on-surface">${METRIC_TOOLTIPS.aum}</span></span></span>
                <span class="text-base font-bold tabular-nums text-right leading-tight">${fund.aum ? '₹ ' + fund.aum + ' Cr' : 'N/A <span class="block text-[10px] text-white/50 font-normal tracking-wide">' + getAumMissingReason(fund) + '</span>'}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-white/60 text-sm flex items-center gap-1">Expense Ratio <span class="tooltip-trigger relative cursor-help"><span class="material-symbols-outlined text-xs text-white/40">info</span><span class="glass-tooltip !text-on-surface">${METRIC_TOOLTIPS.ter}</span></span></span>
                <span class="text-base font-bold tabular-nums">${fund.ter ? fund.ter + '%' : 'N/A'}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-white/60 text-sm">Category</span>
                <span class="text-base font-bold">${fund.type}: ${fund.subCategory}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-white/60 text-sm">Plan</span>
                <span class="text-base font-bold">${fund.planType} • ${fund.optionType}</span>
              </div>
            </div>
          </section>
          
          <!-- Consistency Score Gauge -->
          ${fund.consistencyScore !== null && fund.consistencyScore !== undefined ? `
          <section class="bg-surface-container-lowest p-6 rounded-xl">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-semibold flex items-center gap-1">Consistency Score ${tooltipHtml('consistencyScore')}</span>
              <span class="text-[10px] text-on-surface-variant">vs. ${fund.subCategory} peers</span>
            </div>
            <div class="flex items-center gap-6 mt-4">
              <div class="relative flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" stroke-width="8"/>
                  <circle cx="40" cy="40" r="34" fill="none"
                    stroke="${ fund.consistencyScore >= 7.5 ? '#10b981' : fund.consistencyScore >= 5.0 ? '#f59e0b' : '#ef4444' }"
                    stroke-width="8"
                    stroke-dasharray="${(fund.consistencyScore / 10 * 213.6).toFixed(1)} 213.6"
                    stroke-dashoffset="53.4"
                    stroke-linecap="round"
                    transform="rotate(-90 40 40)"/>
                  <text x="40" y="44" text-anchor="middle" font-size="18" font-weight="800" fill="${fund.consistencyScore >= 7.5 ? '#10b981' : fund.consistencyScore >= 5.0 ? '#f59e0b' : '#ef4444'}">${fund.consistencyScore.toFixed(1)}</text>
                </svg>
              </div>
              <div>
                <p class="text-2xl font-extrabold ${ fund.consistencyScore >= 7.5 ? 'text-emerald-600' : fund.consistencyScore >= 5.0 ? 'text-amber-600' : 'text-rose-600' }">
                  ${ fund.consistencyScore >= 7.5 ? 'High Quality' : fund.consistencyScore >= 5.0 ? 'Average' : 'Below Average' }
                </p>
                <p class="text-xs text-on-surface-variant mt-1">Composite quality rating within same sub-category</p>
              </div>
            </div>
          </section>
          ` : ''}
          
          <!-- Risk Meter -->
          <section class="bg-surface-container-lowest p-6 rounded-xl">
            <div class="flex items-center justify-between mb-4">
              <span class="text-sm font-semibold flex items-center gap-1">Risk Meter ${tooltipHtml('riskLevel')}</span>
              ${fund.riskLevel ? `<span class="px-2 py-0.5 ${getRiskBadgeColor(fund.riskLevel)} text-[10px] font-bold rounded uppercase">${fund.riskLevel}</span>` : ''}
            </div>
            <!-- SEBI 6-level riskometer -->
            <div class="flex gap-1 mb-2">
              ${['Low','Low to Moderate','Moderate','Moderately High','High','Very High'].map((label, i) => {
                const pos = getRiskMeterPosition(fund.riskLevel);
                const colors = [
                  'bg-emerald-400',   // Low
                  'bg-lime-400',      // Low to Moderate
                  'bg-yellow-400',    // Moderate
                  'bg-orange-400',    // Moderately High
                  'bg-red-500',       // High
                  'bg-red-700',       // Very High
                ];
                const isActive = pos === i;
                return `<div class="flex-1 h-3 rounded-sm ${colors[i]} ${!isActive ? 'opacity-30' : ''} ${isActive ? 'ring-2 ring-offset-1 ring-gray-700 scale-y-125' : ''} transition-all"></div>`;
              }).join('')}
            </div>
            <div class="flex justify-between mt-2 text-[8px] text-on-surface-variant font-medium">
              <span>Low</span>
              <span class="hidden sm:block">L-Mod</span>
              <span>Mod</span>
              <span class="hidden sm:block">Mod-H</span>
              <span>High</span>
              <span>V.High</span>
            </div>
            ${!fund.riskLevel ? '<p class="text-xs text-on-surface-variant mt-2">Risk level not available</p>' : ''}
          </section>
          
          <!-- ISIN -->
          <section class="bg-surface-container-lowest p-6 rounded-xl">
            <h3 class="text-xs font-bold uppercase tracking-widest text-outline mb-4">Identifiers</h3>
            <div class="space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-on-surface-variant">Scheme Code</span>
                <span class="font-mono text-on-surface font-bold">${fund.schemeCode}</span>
              </div>
              ${fund.isinGrowth ? `<div class="flex justify-between">
                <span class="text-on-surface-variant">ISIN</span>
                <span class="font-mono text-on-surface text-xs">${fund.isinGrowth}</span>
              </div>` : ''}
            </div>
          </section>
        </div>
      </div>
    `;

    // Render chart
    setTimeout(() => {
        updateNavChart(fund.schemeCode, '5y');
    }, 100);

  } catch (err) {
    container.innerHTML = `<div class="text-center py-20 text-on-surface-variant">
      <span class="material-symbols-outlined text-4xl text-outline mb-4 block">error</span>
      <p>Fund not found or error loading data.</p>
      <a href="#/" class="text-primary font-bold text-sm mt-4 inline-block hover:underline">← Back to Dashboard</a>
    </div>`;
  }
}

function getRiskMeterPosition(level) {
  if (!level) return -1;
  const l = level.toLowerCase();
  if (l === 'low') return 0;
  if (l === 'low to moderate') return 1;
  if (l === 'moderate') return 2;
  if (l === 'moderately high') return 3;
  if (l === 'high') return 4;
  if (l === 'very high') return 5;
  return -1;
}

// ─── Render: Compare View ───────────────────────────────────
async function renderCompare() {
  showView('view-compare');
  state.currentView = 'compare';
  renderSidebar();
  
  const container = document.getElementById('compare-content');
  const warningEl = document.getElementById('compare-warning');
  
  // Get codes from URL or state
  const hash = window.location.hash;
  const codesMatch = hash.match(/codes=([^&]+)/);
  const codes = codesMatch ? codesMatch[1].split(',') : state.compareList;
  
  if (codes.length < 2) {
    container.innerHTML = `
      <div class="lg:col-span-4 flex flex-col items-center justify-center py-20 text-center">
        <span class="material-symbols-outlined text-5xl text-outline mb-4">compare_arrows</span>
        <h3 class="font-headline text-xl font-bold text-on-surface mb-2">Select Funds to Compare</h3>
        <p class="text-on-surface-variant text-sm max-w-md mb-6">Go to <a href="#/explore" class="text-primary font-bold hover:underline">Explore Funds</a> and select 2-4 funds using the checkboxes, then click Compare.</p>
      </div>
    `;
    warningEl.classList.add('hidden');
    return;
  }
  
  try {
    const resp = await api(`/compare?codes=${codes.join(',')}`);
    
    if (resp.warning) {
      warningEl.textContent = '⚠️ ' + resp.warning;
      warningEl.classList.remove('hidden');
    } else {
      warningEl.classList.add('hidden');
    }
    
    const funds = resp.funds;
    const isEquityLike = funds.some(f => ['Equity', 'Index', 'ETF'].includes(f.type));
    
    // Build comparison grid
    const metrics = [
      { group: 'Performance', items: [
        { key: 'cagrSinceInception', label: 'Since Inception CAGR', suffix: '%' },
        { key: 'cagr1y', label: 'CAGR 1Y', suffix: '%' },
        { key: 'cagr3y', label: 'CAGR 3Y', suffix: '%' },
        { key: 'cagr5y', label: 'CAGR 5Y', suffix: '%' },
        { key: 'rollingReturn1y', label: 'Rolling Median (1Y)', suffix: '%' },
        { key: 'rollingReturn3y', label: 'Rolling Median (3Y)', suffix: '%' },
      ]},
      { group: 'Risk & Volatility', items: [
        { key: 'sharpeRatio', label: 'Sharpe Ratio', suffix: '' },
        { key: 'sortinoRatio', label: 'Sortino Ratio', suffix: '' },
        { key: 'standardDeviation', label: 'Standard Deviation', suffix: '%', neutral: true },
        ...(isEquityLike ? [{ key: 'beta', label: 'Beta', suffix: '' }] : []),
      ]},
      { group: 'Advanced Risk / Alpha', items: [
        { key: 'maxDrawdown', label: 'Max Drawdown', suffix: '%' },
        { key: 'calmarRatio', label: 'Calmar Ratio', suffix: '' },
        ...(isEquityLike ? [
          { key: 'jensensAlpha', label: "Jensen's Alpha", suffix: '%' },
          { key: 'upsideCapture', label: 'Upside Capture', suffix: '%' },
          { key: 'downsideCapture', label: 'Downside Capture', suffix: '%' },
          { key: 'amfiIR_1y',  label: 'Info Ratio (1Y)',  suffix: '', amfiPeriod: 'ir1y'  },
          { key: 'amfiIR_3y',  label: 'Info Ratio (3Y)',  suffix: '', amfiPeriod: 'ir3y'  },
          { key: 'amfiIR_5y',  label: 'Info Ratio (5Y)',  suffix: '', amfiPeriod: 'ir5y'  },
          { key: 'amfiIR_10y', label: 'Info Ratio (10Y)', suffix: '', amfiPeriod: 'ir10y' },
        ] : []),
        { key: 'consistencyScore', label: 'Consistency Score', suffix: '/10' },
      ]},
      { group: 'Cost & Size', items: [
        { key: 'ter', label: 'Total Expense Ratio', suffix: '%' },
        { key: 'aum', label: 'AUM (₹ Cr)', suffix: '' },
      ]},
    ];
    
    // Labels column
    let labelsHtml = `<div class="hidden lg:flex flex-col pt-[208px] gap-0">`;
    for (const group of metrics) {
      labelsHtml += `<div class="pt-6 pb-3 border-t border-outline-variant/15 lg:border-t-0 lg:h-12 lg:pt-0 lg:pb-2 lg:flex lg:items-end">
        <span class="text-xs font-bold uppercase tracking-widest text-outline">${group.group}</span>
      </div>`;
      for (const item of group.items) {
        // For amfiIR rows, use the informationRatio tooltip
        const tooltipKey = item.amfiPeriod ? 'informationRatio' : item.key;
        labelsHtml += `<div class="h-16 flex items-center">
          <div class="tooltip-trigger relative flex items-center gap-2 cursor-help">
            <span class="text-sm font-semibold text-on-surface">${item.label}</span>
            <span class="material-symbols-outlined text-base text-outline">info</span>
            <span class="glass-tooltip">${METRIC_TOOLTIPS[tooltipKey] || ''}</span>
          </div>
        </div>`;
      }
    }
    labelsHtml += `</div>`;
    
    // Fund cards
    const fundCardsHtml = funds.map(f => {
      let valuesHtml = '';
      for (const group of metrics) {
        valuesHtml += `<div class="pt-6 pb-2 border-t border-outline-variant/15 lg:border-t-0 lg:h-12 lg:pt-0 lg:pb-2 lg:flex lg:items-end">
          <span class="lg:invisible text-xs font-bold uppercase tracking-widest text-outline">${group.group}</span>
        </div>`;
        for (const item of group.items) {
          // Handle amfiIR multi-period keys
          let val;
          if (item.amfiPeriod) {
            val = f.amfiIR ? f.amfiIR[item.amfiPeriod] : null;
          } else {
            val = f[item.key];
            if (val && typeof val === 'object' && val.median !== undefined) {
              val = val.median;
            } else if (val && typeof val === 'object' && val.avg !== undefined) {
              val = val.avg;
            }
          }

          let displayHtml;
          if (item.amfiPeriod) {
            // Information Ratio period cell — colour-coded
            function irColor(v) {
              if (v === null || v === undefined) return 'text-outline';
              if (v >= 1.0) return 'text-emerald-600 font-extrabold';
              if (v >= 0.5) return 'text-secondary font-bold';
              if (v >= 0)   return 'text-amber-600 font-bold';
              return 'text-error font-bold';
            }
            if (val === null || val === undefined) {
              displayHtml = `<span class="text-outline text-base">—</span>`;
            } else {
              const num = parseFloat(val);
              displayHtml = `<span class="${irColor(num)} tabular-nums">${num.toFixed(2)}</span>`;
            }
          } else if (val === 'Insufficient Data' || val === null || val === undefined) {
            // Bug 7 fix: unify 'Insufficient Data' and null/undefined — both display as '—'
            // 'Insufficient Data' (equity, no TRI) and null (debt, not applicable) mean
            // the same thing to the user: metric not available for this fund.
            displayHtml = `<span class="text-outline text-base">—</span>`;
          } else if (item.key === 'consistencyScore') {
            // Colour-coded score /10
            const score = parseFloat(val);
            const scoreColor = score >= 7.5 ? 'text-emerald-600' : score >= 5.0 ? 'text-amber-600' : 'text-rose-600';
            displayHtml = `<span class="${scoreColor}">${score.toFixed(1)}<span class="text-xs text-outline font-normal">/10</span></span>`;
          } else if (item.key === 'maxDrawdown') {
            // Always red — it's a loss metric
            const num = parseFloat(val);
            displayHtml = `<span class="text-rose-600">${num.toFixed(2)}%</span>`;
          } else if (item.key === 'downsideCapture') {
            // Lower is better → red if >100, green if <100
            const num = parseFloat(val);
            const color = num < 100 ? 'text-emerald-600' : 'text-rose-600';
            displayHtml = `<span class="${color}">${num.toFixed(2)}%</span>`;
          } else if (item.key === 'upsideCapture') {
            // Higher is better → green if >100, amber otherwise
            const num = parseFloat(val);
            const color = num > 100 ? 'text-emerald-600' : 'text-amber-600';
            displayHtml = `<span class="${color}">${num.toFixed(2)}%</span>`;
          } else if (item.neutral) {
            // Bug 1 fix: neutral metrics (e.g. Standard Deviation) — higher is NOT better,
            // so never color green. Use neutral text-on-surface regardless of value sign.
            const num = parseFloat(val);
            displayHtml = `<span class="text-on-surface">${num.toFixed(2)}${item.suffix}</span>`;
          } else {
            const num = parseFloat(val);
            const isPositive = num > 0;
            const colorClass = item.suffix === '%' || item.suffix === ''
              ? (isPositive ? 'text-secondary' : 'text-rose-600')
              : 'text-on-surface';
            const prefix = isPositive && item.suffix === '%' ? '+' : '';
            displayHtml = `<span class="${colorClass}">${prefix}${num.toFixed(2)}${item.suffix}</span>`;
          }

          valuesHtml += `<div class="h-16 flex flex-col justify-center">
            <span class="lg:hidden text-[10px] uppercase font-bold text-outline mb-1">${item.label}</span>
            <span class="text-2xl font-bold tabular-nums">
              ${displayHtml}
            </span>
          </div>`;
        }

      }
      
      return `
        <div class="bg-surface-container-lowest rounded-xl p-6 shadow-sm ring-1 ring-outline-variant/10 hover:shadow-md transition-shadow">
          <div class="mb-6 lg:h-[160px] flex flex-col items-start">
            <div class="w-12 h-12 rounded-lg ${getInitialBg(f.amc)} flex items-center justify-center mb-4 font-bold shrink-0">${getInitials(f.amc)}</div>
            <h3 class="font-headline font-bold text-lg text-primary leading-tight line-clamp-3 shrink-0 w-full">
              <a href="#/fund/${f.schemeCode}" class="hover:underline" title="${f.schemeName}">${shortName(f.schemeName)}</a>
            </h3>
            <div class="mt-auto pt-2 shrink-0">
              <span class="inline-block px-2 py-1 bg-primary-container text-on-primary-container text-[10px] font-bold rounded uppercase tracking-wide mb-1">${f.type}: ${f.subCategory}</span>
              <span class="inline-block px-2 py-1 bg-surface-container-high text-on-surface-variant text-[10px] font-bold rounded uppercase tracking-wide ml-1 mb-1">${f.planType}</span>
            </div>
          </div>
          ${valuesHtml}
        </div>
      `;
    }).join('');
    
    // Empty card if less than 3
    const emptyCard = funds.length < 3 ? `
      <a href="#/explore" class="bg-surface-container-low rounded-xl p-6 border-2 border-dashed border-outline-variant/30 flex flex-col items-center justify-center group cursor-pointer hover:bg-surface-container-high transition-all min-h-[400px]">
        <div class="w-16 h-16 rounded-full bg-surface-container-highest flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <span class="material-symbols-outlined text-outline text-3xl">add</span>
        </div>
        <h3 class="font-headline font-bold text-outline">Add Another Fund</h3>
        <p class="text-outline-variant text-xs mt-2 text-center px-4">Go to Explore to add more funds for comparison.</p>
      </a>
    ` : '';
    
    container.innerHTML = labelsHtml + fundCardsHtml + emptyCard;
    
    setTimeout(() => {
        renderRollingReturnCharts(funds);
    }, 100);
    
  } catch (err) {
    container.innerHTML = `<div class="lg:col-span-4 text-center py-20 text-on-surface-variant">
      <p>Error loading comparison data. Please try again.</p>
    </div>`;
  }
}

// ─── Search ─────────────────────────────────────────────────
const searchInput = document.getElementById('global-search');
const searchResults = document.getElementById('search-results');
let searchTimeout = null;

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) {
      searchResults.classList.add('hidden');
      return;
    }
    searchTimeout = setTimeout(async () => {
      try {
        const resp = await api(`/search?q=${encodeURIComponent(q)}`);
        if (resp.results.length === 0) {
          searchResults.classList.add('hidden');
          return;
        }
        searchResults.innerHTML = resp.results.map(f => `
          <a href="#/fund/${f.schemeCode}" class="block px-4 py-3 hover:bg-surface-container-low transition-colors border-b border-outline-variant/10 last:border-b-0" onclick="document.getElementById('search-results').classList.add('hidden'); document.getElementById('global-search').value='';">
            <div class="text-sm font-bold text-primary truncate">${shortName(f.schemeName)}</div>
            <div class="text-[10px] text-on-surface-variant uppercase">${f.type}: ${f.subCategory} • ${f.planType} • ${f.optionType}</div>
          </a>
        `).join('');
        searchResults.classList.remove('hidden');
      } catch (err) {
        searchResults.classList.add('hidden');
      }
    }, 300);
  });
  
  // Hide search results on click outside
  document.addEventListener('click', (e) => {
    if (!document.getElementById('search-container')?.contains(e.target)) {
      searchResults.classList.add('hidden');
    }
  });
}

// ─── Router ─────────────────────────────────────────────────
async function handleRoute() {
  const route = getRoute();
  
  switch (route.view) {
    case 'home':
      await renderHome();
      break;
    case 'explore':
      await renderExplore(route.category);
      break;
    case 'fund':
      await renderFundDetail(route.schemeCode);
      break;
    case 'compare':
      await renderCompare();
      break;
    default:
      await renderHome();
  }
}

// ─── Init ───────────────────────────────────────────────────
async function init() {
  // Show loading screen
  showView('loading-screen');
  
  // Poll for data readiness
  let ready = false;
  while (!ready) {
    try {
      const status = await api('/status');
      ready = status.ready;
      
      if (status.progress.total > 0) {
        const pct = Math.round((status.progress.completed / status.progress.total) * 100);
        document.getElementById('loading-bar-fill').style.width = pct + '%';
        document.getElementById('loading-message').textContent = 
          status.progress.phase === 'fetching' 
            ? `Fetching historical data: ${status.progress.completed}/${status.progress.total} schemes (${status.progress.cached} cached)...`
            : status.progress.phase === 'calculating'
            ? 'Calculating performance metrics...'
            : status.progress.phase === 'complete'
            ? 'Ready!'
            : 'Parsing AMFI data...';
      }
    } catch (err) {
      // Server not ready yet
    }
    
    if (!ready) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  state.loadingComplete = true;
  
  // Load categories filtered by current plan/option type
  try {
    state.categorySummary = await api(`/categories?planType=${state.planType}&optionType=${state.optionType}`);
  } catch (err) {}
  
  // Handle initial route
  handleRoute();
}

// Listen for hash changes
window.addEventListener('hashchange', handleRoute);

// Boot
init();
