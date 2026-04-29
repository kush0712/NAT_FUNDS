import sys
import re

with open('/Users/kushagrajaiswal/Desktop/MF kj/public/app.js', 'r') as f:
    code = f.read()

# 1. State
code = code.replace(
    'selectedSubCategories: [],',
    'selectedSubCategories: [],\n  selectedMarketCaps: [],'
)

# 2. getRiskBadgeColor
badge_old = """function getRiskBadgeColor(level) {
  if (!level) return 'bg-surface-container-high text-on-surface-variant';
  const l = level.toLowerCase();
  if (l.includes('very high')) return 'bg-tertiary-container text-on-tertiary-container';
  if (l.includes('high')) return 'bg-tertiary-fixed text-tertiary';
  if (l.includes('moderate')) return 'bg-surface-container-high text-on-surface-variant';
  if (l.includes('low')) return 'bg-secondary-container text-on-secondary-container';
  return 'bg-surface-container-high text-on-surface-variant';
}"""
badge_new = """function getRiskBadgeColor(level) {
  if (!level) return 'bg-surface-container-high text-on-surface-variant';
  const l = level.toLowerCase();
  if (l.includes('very high')) return 'bg-tertiary-container text-on-tertiary-container';
  if (l.includes('moderately high')) return 'bg-orange-100 text-orange-800';
  if (l.includes('high')) return 'bg-tertiary-fixed text-tertiary';
  if (l.includes('low to moderate')) return 'bg-lime-100 text-lime-800';
  if (l.includes('moderate')) return 'bg-amber-100 text-amber-800';
  if (l.includes('low')) return 'bg-emerald-100 text-emerald-800';
  return 'bg-surface-container-high text-on-surface-variant';
}"""
code = code.replace(badge_old, badge_new)

# 3. getRiskMeterPosition
meter_old = """function getRiskMeterPosition(level) {
  if (!level) return -1;
  const l = level.toLowerCase();
  if (l.includes('very high')) return 4;
  if (l.includes('high') && !l.includes('moderate')) return 3;
  if (l.includes('moderate')) return 2;
  if (l.includes('low to moderate')) return 1;
  if (l.includes('low')) return 0;
  return 2;
}"""
meter_new = """function getRiskMeterPosition(level) {
  if (!level) return -1;
  const l = level.toLowerCase();
  if (l.includes('very high')) return 4;
  if (l.includes('moderately high')) return 3;
  if (l.includes('high')) return 3;
  if (l.includes('low to moderate')) return 1;
  if (l.includes('moderate')) return 2;
  if (l.includes('low')) return 0;
  return 2;
}"""
code = code.replace(meter_old, meter_new)

# 4. fmt function
fmt_old = """function fmt(val, suffix = '%', decimals = 2) {
  if (val === null || val === undefined) return '<span class="text-outline text-xs">N/A</span>';
  const num = parseFloat(val);"""
fmt_new = """function fmt(val, suffix = '%', decimals = 2) {
  if (val === null || val === undefined) return '<span class="text-outline text-xs">N/A</span>';
  if (typeof val === 'object' && val.avg !== undefined) val = val.avg;
  const num = parseFloat(val);"""
code = code.replace(fmt_old, fmt_new)

# 5. renderFundTable headers and cells
table_old_cells = """<td class="px-4 py-4 text-right font-label text-sm tabular-nums">${fmtNav(f.nav)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr1y)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr3y)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr5y)}</td>"""
table_new_cells = """<td class="px-4 py-4 text-right font-label text-sm tabular-nums">${fmtNav(f.nav)}</td>
        <td class="px-4 py-4 text-right text-sm tabular-nums">${fmtAUM(f.aum)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr1y)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr3y)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.cagr5y)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.sharpeRatio, '', 2)}</td>
        <td class="px-4 py-4 text-right text-sm">${fmt(f.standardDeviation)}</td>
        <td class="px-4 py-4 text-right text-sm hidden xl:table-cell">${fmt(f.beta, '', 2)}</td>"""
code = code.replace(table_old_cells, table_new_cells)

table_badge_old = """<a href="#/fund/${f.schemeCode}" class="text-sm font-bold text-primary group-hover:underline cursor-pointer block truncate max-w-[300px]">${shortName(f.schemeName)}</a>"""
table_badge_new = """<a href="#/fund/${f.schemeCode}" class="text-sm font-bold text-primary group-hover:underline cursor-pointer flex items-center gap-2 truncate max-w-[300px]">
                <span class="truncate">${shortName(f.schemeName)}</span>
                ${(f.cagr3y > 0 && f.sharpeRatio > 1.0 && f.planType === 'Direct' && f.aum > 500) ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold bg-secondary-container text-on-secondary-container tooltip-trigger relative cursor-help shrink-0">★ PICK<span class="glass-tooltip" style="width:12rem; font-weight:normal; white-space:normal;">Suitable for beginners: >500Cr AUM, Direct plan, good risk-adjusted returns (Sharpe > 1.0).</span></span>` : ''}
              </a>"""
code = code.replace(table_badge_old, table_badge_new)

# 6. Fetching URL
url_old = """let url = `/funds?type=${state.currentCategory}&planType=${state.planType}&optionType=${state.optionType}`;
  url += `&sortBy=${state.sortBy}&order=${state.sortOrder}&page=${state.page}&limit=${state.limit}`;
  
  if (state.selectedSubCategories.length > 0) {
    url += `&subCategory=${state.selectedSubCategories.join(',')}`;
  }"""
url_new = """let url = `/funds?type=${state.currentCategory}&planType=${state.planType}&optionType=${state.optionType}`;
  url += `&sortBy=${state.sortBy}&order=${state.sortOrder}&page=${state.page}&limit=${state.limit}`;
  
  if (state.selectedSubCategories.length > 0) {
    url += `&subCategory=${state.selectedSubCategories.join(',')}`;
  }
  if (state.selectedMarketCaps.length > 0) {
    url += `&marketCap=${state.selectedMarketCaps.join(',')}`;
  }"""
code = code.replace(url_old, url_new)

# 7. renderExplore - market cap
market_cap_logic = """// Fetch and render funds"""
market_cap_replacement = """// Market Cap filters for Equity
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
    
    // Fetch and render funds"""
code = code.replace(market_cap_logic, market_cap_replacement)

toggle_mc_code = """window.toggleSubCategory = function(sub) {"""
toggle_mc_replacement = """window.toggleMarketCap = function(cap) {
  const idx = state.selectedMarketCaps.indexOf(cap);
  if (idx >= 0) state.selectedMarketCaps.splice(idx, 1);
  else state.selectedMarketCaps.push(cap);
  state.page = 1;
  fetchAndRenderFunds();
  renderExplore(state.currentCategory);
};

window.toggleSubCategory = function(sub) {"""
code = code.replace(toggle_mc_code, toggle_mc_replacement)

# 8. renderFundDetail moving rolling return and nav chart
fund_detail_old_chart = """<!-- NAV Chart placeholder -->
          <section class="bg-surface-container-lowest p-8 rounded-xl">
            <div class="flex justify-between items-center mb-8">
              <div>
                <h2 class="text-xl font-bold font-headline mb-1">Growth Performance</h2>
                <p class="text-sm text-on-surface-variant">NAV trend over time</p>
              </div>
            </div>
            <div class="h-[200px] w-full relative overflow-hidden rounded-lg bg-surface-container-low flex items-center justify-center">
              <div class="text-center text-on-surface-variant">
                <span class="material-symbols-outlined text-4xl opacity-30 mb-2 block">show_chart</span>
                <p class="text-xs">NAV: ${fmtNav(fund.nav)} (as of ${fund.date || 'latest'})</p>
              </div>
            </div>
          </section>"""
fund_detail_new_chart = """<!-- NAV Chart -->
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
            <div class="h-[280px] w-full relative">
              <canvas id="navChart"></canvas>
            </div>
          </section>"""
code = code.replace(fund_detail_old_chart, fund_detail_new_chart)

rolling_ret_3y_old = """<div class="p-4 rounded-lg bg-surface-container-low">
                  <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                    Rolling 1Y ${tooltipHtml('rollingReturn1y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums">${fmt(fund.rollingReturn1y)}</p>
                </div>
              </div>
            </div>
            
            <!-- Risk (conditional on fund type) -->
            <div>
              <h3 class="text-xs font-bold uppercase tracking-widest text-outline mb-4">
                Risk & Volatility"""

rolling_ret_3y_new = """<div class="p-4 rounded-lg bg-surface-container-low">
                  <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                    Rolling 1Y ${tooltipHtml('rollingReturn1y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums">${fmt(fund.rollingReturn1y?.avg || fund.rollingReturn1y)}</p>
                </div>
                <div class="p-4 rounded-lg bg-surface-container-low">
                  <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                    Rolling 3Y ${tooltipHtml('rollingReturn3y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums">${fmt(fund.rollingReturn3y?.avg || fund.rollingReturn3y)}</p>
                </div>
              </div>
            </div>
            
            <!-- Risk (conditional on fund type) -->
            <div>
              <h3 class="text-xs font-bold uppercase tracking-widest text-outline mb-4">
                Risk & Volatility"""
code = code.replace(rolling_ret_3y_old, rolling_ret_3y_new)

rolling_ret_3y_risk_old = """<div class="p-4 rounded-lg bg-surface-container-low">
                  <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1 flex items-center gap-1">
                    Rolling 3Y ${tooltipHtml('rollingReturn3y')}
                  </p>
                  <p class="text-xl font-bold tabular-nums">${fmt(fund.rollingReturn3y)}</p>
                </div>"""
code = code.replace(rolling_ret_3y_risk_old, "")

chart_logic_append = """    container.innerHTML = `
      <div class="lg:col-span-4 flex flex-col items-center justify-center py-20 text-center">"""

render_fund_chart_logic = """
    // Render chart
    setTimeout(() => {
        updateNavChart(fund.schemeCode, '5y');
    }, 100);

  } catch (err) {"""

code = code.replace("  } catch (err) {\n    container.innerHTML = `<div class=\"text-center py-20 text-on-surface-variant\">", render_fund_chart_logic + "\n    container.innerHTML = `<div class=\"text-center py-20 text-on-surface-variant\">")

# Now add chart.js instances and update logic
chart_js_globals = """// ─── Compare ────────────────────────────────────────────────"""
chart_js_globals_replacement = """// ─── Charts ──────────────────────────────────────────────────
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
            label: 'Average',
            data: validFunds.map(f => f[prop].avg),
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

// ─── Compare ────────────────────────────────────────────────"""
code = code.replace(chart_js_globals, chart_js_globals_replacement)

# End of renderCompare logic to render rolling charts
render_compare_end = """    container.innerHTML = labelsHtml + fundCardsHtml + emptyCard;
    
  } catch (err) {"""
render_compare_end_new = """    container.innerHTML = labelsHtml + fundCardsHtml + emptyCard;
    
    setTimeout(() => {
        renderRollingReturnCharts(funds);
    }, 100);
    
  } catch (err) {"""
code = code.replace(render_compare_end, render_compare_end_new)

with open('/Users/kushagrajaiswal/Desktop/MF kj/public/app.js', 'w') as f:
    f.write(code)

print("Modifications successfully applied.")
