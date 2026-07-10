/**
 * js/views/fund-detail.js
 * Renders the Fund Detail view.
 * Depends on: state, api, METRIC_TOOLTIPS, fmt, fmtNav, fmtAUM, fmtScore,
 *             tooltipHtml, getRiskBadgeColor, getInitials, getInitialBg,
 *             shortName, getAumMissingReason, updateNavChart,
 *             toggleCompare, updateCompareBar, renderSidebar, showView
 */

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
      <div class="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <nav class="flex items-center gap-2 text-ink-muted text-[12px] mb-3">
            <a href="#/" class="hover:text-primary cursor-pointer">Explore</a>
            <span class="material-symbols-outlined" style="font-size:14px;">chevron_right</span>
            <a href="#/explore/${fund.type}" class="hover:text-primary cursor-pointer">${fund.type}</a>
            <span class="material-symbols-outlined" style="font-size:14px;">chevron_right</span>
            <span class="text-ink font-medium">${fund.subCategory}</span>
          </nav>
          <div class="flex items-center gap-4 mb-2">
            <div class="w-11 h-11 rounded-xl ${getInitialBg(fund.amc)} flex items-center justify-center font-bold text-base">${getInitials(fund.amc)}</div>
            <h1 class="text-2xl md:text-3xl font-bold font-headline text-ink" style="letter-spacing:-1px;">${shortName(fund.schemeName)}</h1>
          </div>
          <p class="text-ink-muted text-sm leading-relaxed">
            ${fund.amc} · ${fund.type}: ${fund.subCategory} · ${fund.planType} Plan · ${fund.optionType}
          </p>
        </div>
        <div class="flex gap-3">
          <button onclick="toggleCompare('${fund.schemeCode}'); updateCompareBar();" class="px-5 py-2.5 flex items-center gap-2 border border-hairline text-primary font-medium rounded-full bg-canvas hover:bg-canvas-soft transition-all text-sm">
            <span class="material-symbols-outlined" style="font-size:18px;">compare_arrows</span>
            Compare
          </button>
        </div>
      </div>
      
      <!-- Bento Grid -->
      <div class="grid grid-cols-1 2xl:grid-cols-12 gap-8">
        <!-- Performance Section -->
        <div class="2xl:col-span-8 space-y-8 min-w-0">
          <!-- NAV Chart -->
          <section class="bg-canvas border border-hairline p-7 rounded-xl" style="box-shadow: var(--shadow-soft);">
            <div class="flex justify-between items-center mb-5">
              <div>
                <h2 class="font-headline font-bold text-ink mb-0.5" style="font-size:20px; letter-spacing:-0.125px;">Growth Performance</h2>
                <p class="text-sm text-ink-muted">Historical NAV trend</p>
              </div>
              <div class="flex bg-canvas-soft border border-hairline rounded-md p-0.5">
                <button onclick="updateNavChart('${schemeCode}', '1y')" id="btn-chart-1y" class="px-3 py-1 text-[11px] font-semibold rounded text-ink-muted hover:text-ink transition-colors uppercase">1Y</button>
                <button onclick="updateNavChart('${schemeCode}', '3y')" id="btn-chart-3y" class="px-3 py-1 text-[11px] font-semibold rounded text-ink-muted hover:text-ink transition-colors uppercase">3Y</button>
                <button onclick="updateNavChart('${schemeCode}', '5y')" id="btn-chart-5y" class="px-3 py-1 bg-canvas border border-hairline text-primary text-[11px] font-semibold rounded uppercase" style="box-shadow: var(--shadow-soft);">5Y</button>
              </div>
            </div>
            <div class="h-[280px] w-full relative overflow-hidden">
              <canvas id="navChart"></canvas>
            </div>
          </section>
          
          <!-- Returns & Risk Metrics -->
          <section class="bg-canvas border border-hairline p-7 rounded-xl" style="box-shadow: var(--shadow-soft);">
            <h2 class="font-headline font-bold text-ink mb-7" style="font-size:20px; letter-spacing:-0.125px;">Performance &amp; Risk Metrics</h2>
            
            <!-- Returns -->
            <div class="mb-8">
              <h3 class="text-xs font-bold uppercase tracking-widest text-ink-faint mb-1">Returns</h3>
              <p class="text-[10px] text-ink-muted mb-4">Trailing as of ${new Date().toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'})} (latest NAV)</p>
              ${fund.fundAgeMonths != null && fund.fundAgeMonths < 36 ? `
              <div class="flex items-start gap-2 text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3">
                <span class="material-symbols-outlined text-sm shrink-0">info</span>
                <span>This fund is <strong>${fund.fundAgeMonths} months old</strong>. Metrics requiring 3-year history (CAGR 3Y, Beta, etc.) are unavailable — consistent with Tickertape &amp; Zerodha Coin.</span>
              </div>` : ''}
              <div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
                <div class="p-4 rounded-lg bg-canvas-soft border border-hairline">
                  <p class="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                    CAGR 1Y ${tooltipHtml('cagr1y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums text-ink">${fmt(fund.cagr1y)}</p>
                </div>
                <div class="p-4 rounded-lg bg-canvas-soft border border-hairline">
                  <p class="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                    CAGR 3Y ${tooltipHtml('cagr3y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums text-ink">${fmt(fund.cagr3y)}</p>
                </div>
                <div class="p-4 rounded-lg bg-canvas-soft border border-hairline">
                  <p class="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                    CAGR 5Y ${tooltipHtml('cagr5y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums text-ink">${fmt(fund.cagr5y)}</p>
                </div>
                <div class="p-4 rounded-lg" style="background:rgba(0,117,222,0.07); border:1px solid rgba(0,117,222,0.18);">
                  <p class="text-[10px] font-semibold text-primary uppercase tracking-widest mb-1">
                    Since Inception
                  </p>
                  <p class="text-xl font-bold tabular-nums text-primary">${fmt(fund.cagrSinceInception)}</p>
                  ${fund.fundAgeMonths != null ? `<p class="text-[9px] text-ink-muted mt-1">${fund.fundAgeMonths} months</p>` : ''}
                </div>
              </div>
            </div>

            <!-- Rolling Returns Analysis -->
            ${(fund.rollingReturn1y && typeof fund.rollingReturn1y === 'object') || (fund.rollingReturn3y && typeof fund.rollingReturn3y === 'object') ? `
            <div class="mb-8">
              <h3 class="text-xs font-bold uppercase tracking-widest text-ink-faint mb-4">Rolling Returns Analysis (Daily CAGR)</h3>
              ${fund.isIdcwPlan ? `<div class="flex items-start gap-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                <span class="material-symbols-outlined text-sm shrink-0">info</span>
                <span>IDCW plan: returns are based on <strong>NAV movement only</strong> — dividends declared are not included in these figures.</span>
              </div>` : ''}
              <div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
                ${fund.rollingReturn1y && typeof fund.rollingReturn1y === 'object' ? `
                <div class="p-5 rounded-lg bg-canvas-soft border border-hairline">
                  <p class="text-xs font-bold text-ink-muted uppercase tracking-widest mb-3 flex items-center gap-1">
                    1-Year Rolling ${tooltipHtml('rollingReturn1y')}
                  </p>
                  <div class="grid gap-3 mb-3" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">
                    <div>
                      <p class="text-[10px] text-ink-faint uppercase">Median</p>
                      <p class="text-xl font-bold tabular-nums">${fmt(fund.rollingReturn1y.median)}</p>
                    </div>
                    <div>
                      <p class="text-[10px] text-ink-faint uppercase">Average</p>
                      <p class="text-lg tabular-nums text-ink-muted">${fmt(fund.rollingReturn1y.avg)}</p>
                    </div>
                    <div>
                      <p class="text-[10px] text-ink-faint uppercase">Best</p>
                      <p class="text-sm font-bold tabular-nums text-primary">${fmt(fund.rollingReturn1y.max)}</p>
                    </div>
                    <div>
                      <p class="text-[10px] text-ink-faint uppercase">Worst</p>
                      <p class="text-sm font-bold tabular-nums text-error">${fmt(fund.rollingReturn1y.min)}</p>
                    </div>
                  </div>
                  <div class="border-t border-hairline pt-3 space-y-1.5">
                    <div class="flex justify-between text-xs">
                      <span class="text-ink-muted">✅ Positive returns</span>
                      <span class="font-bold tabular-nums">${fund.rollingReturn1y.positivePercent}%</span>
                    </div>
                    ${fund.rollingReturn1y.beatBenchmarkPercent !== null ? `
                    <div class="flex justify-between text-xs">
                      <span class="text-ink-muted">📊 Beat benchmark</span>
                      <span class="font-bold tabular-nums ${fund.rollingReturn1y.beatBenchmarkPercent >= 50 ? 'text-primary' : 'text-error'}">${fund.rollingReturn1y.beatBenchmarkPercent}%</span>
                    </div>` : ''}
                    <div class="flex justify-between text-xs">
                      <span class="text-ink-faint">${fund.rollingReturn1y.totalPeriods.toLocaleString()} periods analyzed</span>
                    </div>
                  </div>
                </div>` : ''}
                ${fund.rollingReturn3y && typeof fund.rollingReturn3y === 'object' && fund.rollingReturn3y.totalPeriods != null ? `
                <div class="p-5 rounded-lg bg-canvas-soft border border-hairline">
                  <p class="text-xs font-bold text-ink-muted uppercase tracking-widest mb-3 flex items-center gap-1">
                    3-Year Rolling ${tooltipHtml('rollingReturn3y')}
                  </p>
                  <div class="grid gap-3 mb-4" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">
                    <div>
                      <p class="text-[10px] text-ink-faint uppercase">Median</p>
                      <p class="text-xl font-bold tabular-nums">${fmt(fund.rollingReturn3y.median)}</p>
                    </div>
                    <div>
                      <p class="text-[10px] text-ink-faint uppercase">Average</p>
                      <p class="text-lg tabular-nums text-ink-muted">${fmt(fund.rollingReturn3y.avg)}</p>
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
                    const isPos = (v) => v >= 0 ? 'text-primary' : 'text-error';
                    return `
                    <div class="mb-4">
                      <div class="flex justify-between text-[9px] font-semibold mb-1.5">
                        <span class="${isPos(rr.p10)}">P10 ${fmt(rr.p10)}</span>
                        <span class="text-ink-faint text-[8px] font-normal">← 80% of all 3Y outcomes →</span>
                        <span class="${isPos(rr.p90)}">P90 ${fmt(rr.p90)}</span>
                      </div>
                      <div class="relative h-1.5 rounded-full bg-canvas-soft" style="overflow:visible">
                        <div class="absolute rounded-full bg-primary/30"
                             style="top:-3px;bottom:-3px;left:${innerLeft}%;width:${innerWidth}%"></div>
                        <div class="absolute rounded-full bg-primary shadow-sm"
                             style="top:-5px;bottom:-5px;width:3px;left:calc(${medPos}% - 1.5px)"></div>
                      </div>
                      <div class="flex justify-between text-[9px] text-ink-muted mt-1.5">
                        <span>P25 ${fmt(rr.p25)}</span>
                        <span>P75 ${fmt(rr.p75)}</span>
                      </div>
                    </div>`;
                  })()}

                  <div class="border-t border-hairline pt-3 space-y-1.5">
                    <div class="flex justify-between text-xs">
                      <span class="text-ink-muted">✅ Positive returns</span>
                      <span class="font-bold tabular-nums">${fund.rollingReturn3y.positivePercent}%</span>
                    </div>
                    ${fund.rollingReturn3y.beatBenchmarkPercent !== null ? `
                    <div class="flex justify-between text-xs">
                      <span class="text-ink-muted">📊 Beat benchmark</span>
                      <span class="font-bold tabular-nums ${fund.rollingReturn3y.beatBenchmarkPercent >= 50 ? 'text-primary' : 'text-error'}">${fund.rollingReturn3y.beatBenchmarkPercent}%</span>
                    </div>` : ''}
                    <div class="flex justify-between text-xs">
                      <span class="text-ink-faint">${fund.rollingReturn3y.totalPeriods.toLocaleString()} monthly windows analyzed</span>
                    </div>
                  </div>
                </div>` : ''}
              </div>
            </div>
            ` : ''}
            </div>
            
            <!-- Risk (conditional on fund type) -->
            <div>
              <h3 class="text-xs font-bold uppercase tracking-widest text-ink-faint mb-4">
                Risk & Volatility
                ${!isEquityLike ? '<span class="text-[10px] normal-case font-medium text-ink-muted ml-2">(Some metrics less relevant for non-equity funds)</span>' : ''}
              </h3>
              ${['Overnight', 'Liquid', 'Money Market', 'Ultra Short Duration'].includes(fund.subCategory) && fund.type === 'Debt'
                ? `<p class="text-sm text-ink-muted p-4 bg-canvas-soft rounded-lg leading-relaxed">
                    <span class="material-symbols-outlined text-xs align-middle mr-1">info</span>
                    Volatility metrics (Std Deviation, Sharpe Ratio) are <strong>not meaningful</strong> for
                    <span class="font-semibold">${fund.subCategory}</span> funds — returns are near-constant by design.
                    Use <strong>YTM</strong> and <strong>Modified Duration</strong> as primary risk signals for these funds.
                   </p>`
                : `<div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
                    ${(isEquityLike || fund.type === 'Hybrid') ? `<div class="p-4 rounded-lg bg-canvas-soft"><p class="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">Sharpe Ratio ${tooltipHtml('sharpeRatio')}</p><p class="text-xl font-bold tabular-nums">${fmt(fund.sharpeRatio, '', 2)}</p></div>` : ''}
                    <div class="p-4 rounded-lg bg-canvas-soft"><p class="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">Std Deviation ${tooltipHtml('standardDeviation')}</p><p class="text-xl font-bold tabular-nums">${fmt(fund.standardDeviation)}</p></div>
                    ${isEquityLike ? `<div class="p-4 rounded-lg bg-canvas-soft"><p class="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">Beta ${tooltipHtml('beta')}</p><p class="text-xl font-bold tabular-nums">${fmt(fund.beta, '', 2)}</p></div>` : ''}
                   </div>`
              }
            </div>
          </section>
          
          <!-- Advanced Risk & Alpha Metrics -->
          <section class="bg-canvas border border-hairline p-7 rounded-xl" id="advanced-metrics-section" style="box-shadow: var(--shadow-soft);">
            <h2 class="font-headline font-bold text-ink mb-1" style="font-size:20px; letter-spacing:-0.125px;">Advanced Risk &amp; Alpha</h2>
            <p class="text-xs text-ink-muted mb-8">Institutional-grade signals for risk-adjusted performance evaluation.</p>
            
            <!-- Maximum Drawdown -->
            ${fund.maxDrawdown !== null && fund.maxDrawdown !== undefined ? `
            <div class="mb-8">
              <h3 class="text-xs font-bold uppercase tracking-widest text-ink-faint mb-3 flex items-center gap-1">Maximum Drawdown ${tooltipHtml('maxDrawdown')}</h3>
              <div class="p-5 rounded-xl bg-rose-50 border border-rose-200/60">
                <div class="flex items-baseline gap-3 mb-4">
                  <span class="text-4xl font-extrabold text-error tabular-nums">${fund.maxDrawdown.toFixed(1)}%</span>
                  <span class="text-xs text-rose-500 font-medium">worst peak-to-trough decline</span>
                </div>
                <div class="flex items-center gap-3 text-xs">
                  <div class="flex flex-col items-center">
                    <span class="w-7 h-7 rounded-full bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center text-[10px] font-bold text-emerald-700">▲</span>
                    <span class="text-[9px] text-ink-muted mt-1 font-semibold">PEAK</span>
                    <span class="text-[10px] font-bold text-ink tabular-nums">${fund.maxDrawdownPeak ? new Date(fund.maxDrawdownPeak).toLocaleDateString('en-IN', {month:'short', year:'numeric'}) : 'N/A'}</span>
                  </div>
                  <div class="flex-1 h-px bg-rose-300 relative"><div class="absolute inset-0 border-t-2 border-dashed border-rose-300"></div></div>
                  <div class="flex flex-col items-center">
                    <span class="w-7 h-7 rounded-full bg-rose-100 border-2 border-rose-500 flex items-center justify-center text-[10px] font-bold text-rose-700">▼</span>
                    <span class="text-[9px] text-ink-muted mt-1 font-semibold">TROUGH</span>
                    <span class="text-[10px] font-bold text-ink tabular-nums">${fund.maxDrawdownTrough ? new Date(fund.maxDrawdownTrough).toLocaleDateString('en-IN', {month:'short', year:'numeric'}) : 'N/A'}</span>
                  </div>
                  <div class="flex-1 h-px relative"><div class="absolute inset-0 border-t-2 border-dashed ${fund.maxDrawdownRecovery ? 'border-emerald-400' : 'border-hairline'}"></div></div>
                  <div class="flex flex-col items-center">
                    <span class="w-7 h-7 rounded-full ${fund.maxDrawdownRecovery ? 'bg-emerald-100 border-2 border-emerald-400 text-emerald-700' : 'bg-canvas-soft border-2 border-hairline text-ink-faint'} flex items-center justify-center text-[10px] font-bold">★</span>
                    <span class="text-[9px] text-ink-muted mt-1 font-semibold">RECOVERY</span>
                    <span class="text-[10px] font-bold tabular-nums ${fund.maxDrawdownRecovery ? 'text-ink' : 'text-ink-faint'}">${fund.maxDrawdownRecovery ? new Date(fund.maxDrawdownRecovery).toLocaleDateString('en-IN', {month:'short', year:'numeric'}) : 'Not yet recovered'}</span>
                  </div>
                </div>
              </div>
            </div>` : ''}
            
            <!-- Calmar + Sortino -->
            <div class="grid gap-4 mb-8" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
              <div class="p-4 rounded-lg bg-canvas-soft">
                <p class="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                  Calmar Ratio ${tooltipHtml('calmarRatio')}
                </p>
                <p class="text-xl font-bold tabular-nums">${typeof fund.calmarRatio === 'number' ? fund.calmarRatio.toFixed(2) : '<span class="text-ink-faint text-sm font-normal">N/A</span>'}</p>
                <p class="text-[10px] text-ink-muted mt-0.5">3Y CAGR / |Max Drawdown|</p>
              </div>
              <div class="p-4 rounded-lg bg-canvas-soft">
                <p class="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                  Sortino Ratio ${tooltipHtml('sortinoRatio')}
                </p>
                <p class="text-xl font-bold tabular-nums">${typeof fund.sortinoRatio === 'number' ? fund.sortinoRatio.toFixed(2) : '<span class="text-ink-faint text-sm font-normal">' + (fund.sortinoRatio || 'N/A') + '</span>'}</p>
                <p class="text-[10px] text-ink-muted mt-0.5">Downside-risk adjusted</p>
              </div>
            </div>
            
            <!-- Capture Ratios (equity only) -->
            ${typeof fund.upsideCapture === 'number' || typeof fund.downsideCapture === 'number' ? `
            <div class="mb-8">
              <h3 class="text-xs font-bold uppercase tracking-widest text-ink-faint mb-3">
                Market Capture Ratios 
                <span class="tooltip-trigger relative cursor-help">
                  <span class="material-symbols-outlined text-[13px] text-ink-faint align-middle">info</span>
                  <span class="glass-tooltip" style="width:16rem">${METRIC_TOOLTIPS.upsideCapture} ${METRIC_TOOLTIPS.downsideCapture}</span>
                </span>
              </h3>
               <div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
                <div class="p-5 rounded-xl bg-emerald-50 border border-emerald-200/60 text-center">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-2">Upside Capture</p>
                  <p class="text-3xl font-extrabold tabular-nums text-emerald-700">${typeof fund.upsideCapture === 'number' ? fund.upsideCapture.toFixed(0) : 'N/A'}<span class="text-lg">%</span></p>
                  <p class="text-[10px] text-emerald-600 mt-1">${typeof fund.upsideCapture === 'number' ? (fund.upsideCapture >= 100 ? '▲ Outperforms in rallies' : '▼ Underperforms in rallies') : ''}</p>
                </div>
                <div class="p-5 rounded-xl bg-rose-50 border border-rose-200/60 text-center">
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
                if (v === null || v === undefined) return 'text-ink-faint';
                if (v >= 1.0) return 'text-emerald-600 font-extrabold';
                if (v >= 0.5) return 'text-primary font-bold';
                if (v >= 0)   return 'text-amber-600 font-bold';
                return 'text-error font-bold';
              }

              return `
            <div class="space-y-4 mt-0">
              ${hasAlpha ? `
              <div class="p-4 rounded-lg bg-canvas-soft">
                <p class="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                  Jensen&#39;s Alpha ${tooltipHtml('jensensAlpha')}
                </p>
                <p class="text-xl font-bold tabular-nums ${fund.jensensAlpha >= 0 ? 'text-primary' : 'text-error'}">${fund.jensensAlpha >= 0 ? '+' : ''}${fund.jensensAlpha.toFixed(2)}%</p>
                <p class="text-[10px] text-ink-muted mt-0.5">${fund.jensensAlpha > 0 ? 'Manager added value' : fund.jensensAlpha === 0 ? 'No excess return' : 'Underperformed CAPM'}</p>
              </div>` : ''}

              ${hasAmfiIR ? `
              <div class="p-4 rounded-lg bg-canvas-soft">
                <p class="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-3 flex items-center gap-1">
                  Information Ratio ${tooltipHtml('informationRatio')}
                  <span class="ml-auto text-[9px] normal-case font-medium text-ink-faint bg-canvas px-2 py-0.5 rounded-full">Source: AMFI</span>
                </p>
                <div class="grid gap-2" style="grid-template-columns:repeat(4,minmax(60px,1fr))">
                  ${[
                    { period: '1Y',  val: fund.amfiIR.ir1y  },
                    { period: '3Y',  val: fund.amfiIR.ir3y  },
                    { period: '5Y',  val: fund.amfiIR.ir5y  },
                    { period: '10Y', val: fund.amfiIR.ir10y },
                  ].map(({ period, val }) => `
                  <div class="text-center p-2 rounded-md bg-canvas">
                    <p class="text-[9px] font-bold text-ink-faint uppercase mb-1">${period}</p>
                    <p class="text-base tabular-nums ${irColor(val)}">${val !== null && val !== undefined ? parseFloat(val).toFixed(2) : '—'}</p>
                  </div>`).join('')}
                </div>
                <div class="mt-2 flex items-center gap-3 text-[9px] text-ink-muted">
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>≥1.0 Exceptional</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-primary inline-block"></span>≥0.5 Good</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>0–0.5 Moderate</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-rose-400 inline-block"></span>&lt;0 Lag</span>
                </div>
              </div>` : hasComputedIR ? `
              <div class="p-4 rounded-lg bg-canvas-soft">
                <p class="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                  Information Ratio ${tooltipHtml('informationRatio')}
                </p>
                <p class="text-xl font-bold tabular-nums ${fund.informationRatio >= 0.5 ? 'text-primary' : fund.informationRatio >= 0 ? 'text-amber-600' : 'text-error'}">${fund.informationRatio.toFixed(2)}</p>
                <p class="text-[10px] text-ink-muted mt-0.5">${fund.informationRatio >= 1.0 ? 'Exceptional consistency' : fund.informationRatio >= 0.5 ? 'Good consistency' : fund.informationRatio >= 0 ? 'Below benchmark half the time' : 'Consistent underperformer'}</p>
              </div>` : ''}
            </div>`;
            })()}
          </section>

        </div>
        
        <!-- Sidebar Facts -->
        <div class="2xl:col-span-4 space-y-6 min-w-0">
          <!-- Key Facts -->
          <section class="bg-secondary text-on-primary p-6 rounded-xl" style="box-shadow: var(--shadow-soft);">
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
                <span class="text-white/60 text-sm flex items-center gap-1">AUM <span class="tooltip-trigger relative cursor-help"><span class="material-symbols-outlined text-xs text-white/40">info</span><span class="glass-tooltip !text-ink">${METRIC_TOOLTIPS.aum}</span></span></span>
                <span class="text-base font-bold tabular-nums text-right leading-tight">${fund.aum ? '₹ ' + fund.aum + ' Cr' : 'N/A <span class="block text-[10px] text-white/50 font-normal tracking-wide">' + getAumMissingReason(fund) + '</span>'}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-white/60 text-sm flex items-center gap-1">Expense Ratio <span class="tooltip-trigger relative cursor-help"><span class="material-symbols-outlined text-xs text-white/40">info</span><span class="glass-tooltip !text-ink">${METRIC_TOOLTIPS.ter}</span></span></span>
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
          <section class="bg-canvas border border-hairline p-6 rounded-xl" style="box-shadow: var(--shadow-soft);">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-semibold flex items-center gap-1">Consistency Score ${tooltipHtml('consistencyScore')}</span>
              <span class="text-[10px] text-ink-muted">vs. ${fund.subCategory} peers</span>
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
                <p class="text-xs text-ink-muted mt-1">Composite quality rating within same sub-category</p>
              </div>
            </div>
          </section>
          ` : ''}
          
          <!-- Risk Meter -->
          <section class="bg-canvas border border-hairline p-6 rounded-xl" style="box-shadow: var(--shadow-soft);">
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
            <div class="flex justify-between mt-2 text-[8px] text-ink-muted font-medium">
              <span>Low</span>
              <span class="hidden sm:block">L-Mod</span>
              <span>Mod</span>
              <span class="hidden sm:block">Mod-H</span>
              <span>High</span>
              <span>V.High</span>
            </div>
            ${!fund.riskLevel ? '<p class="text-xs text-ink-muted mt-2">Risk level not available</p>' : ''}
          </section>
          
          <!-- ISIN -->
          <section class="bg-canvas border border-hairline p-6 rounded-xl" style="box-shadow: var(--shadow-soft);">
            <h3 class="text-xs font-bold uppercase tracking-widest text-ink-faint mb-4">Identifiers</h3>
            <div class="space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-ink-muted">Scheme Code</span>
                <span class="font-mono text-ink font-bold">${fund.schemeCode}</span>
              </div>
              ${fund.isinGrowth ? `<div class="flex justify-between">
                <span class="text-ink-muted">ISIN</span>
                <span class="font-mono text-ink text-xs">${fund.isinGrowth}</span>
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
    container.innerHTML = `<div class="text-center py-20 text-ink-muted">
      <span class="material-symbols-outlined text-4xl text-ink-faint mb-4 block">error</span>
      <p>Fund not found or error loading data.</p>
      <a href="#/" class="text-primary font-semibold text-sm mt-4 inline-block hover:underline">← Back to Dashboard</a>
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
