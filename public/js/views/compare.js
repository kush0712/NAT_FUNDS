/**
 * js/views/compare.js
 * Renders the Compare view.
 * Depends on: state, api, METRIC_TOOLTIPS, fmt, getInitials, getInitialBg,
 *             shortName, renderRollingReturnCharts, renderSidebar, showView
 */

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
