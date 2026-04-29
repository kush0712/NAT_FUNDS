/**
 * js/charts.js
 * Chart.js wrapper functions for the NAV trend chart and rolling-return charts.
 * Depends on: api (api.js), formatters — shortName (formatters.js)
 *
 * Exposes (window.*):
 *   updateNavChart(schemeCode, period)
 *   renderRollingReturnCharts(funds)
 */

let navChartInstance  = null;
let rr1yChartInstance = null;
let rr3yChartInstance = null;

// ─── NAV History chart ────────────────────────────────────────────────────────

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
          fill: { target: 'origin', above: 'rgba(0, 6, 102, 0.05)' },
        }],
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
              label: function(context) { return '₹ ' + context.parsed.y.toFixed(2); },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 10 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, border: { display: false }, ticks: { font: { size: 10 } } },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
      },
    });
  } catch (err) {
    console.error('Failed to load chart data', err);
  }
};

// ─── Rolling-Return bar charts ────────────────────────────────────────────────

window.renderRollingReturnCharts = function(funds) {
  const chartSection = document.getElementById('rolling-return-chart-section');
  if (!chartSection) return;

  if (funds.length < 2) {
    chartSection.classList.add('hidden');
    return;
  }
  chartSection.classList.remove('hidden');

  const colors = ['#000666', '#a0f399', '#ffb59d', '#8690ee'];

  const createChart = (canvasId, instance, prop) => {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return instance;
    if (instance) instance.destroy();

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
            categoryPercentage: 0.8,
          },
          {
            label: 'Median',
            data: validFunds.map(f => f[prop].median || f[prop].avg),
            backgroundColor: validFunds.map((f, i) => colors[i % colors.length]),
            barPercentage: 0.5,
            categoryPercentage: 0.8,
          },
          {
            label: 'Max',
            data: validFunds.map(f => f[prop].max),
            backgroundColor: 'rgba(27, 109, 36, 0.7)',
            barPercentage: 0.25,
            categoryPercentage: 0.8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: function(context) {
                return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + '%';
              },
            },
          },
        },
        scales: {
          x: { stacked: false },
          y: { stacked: false, title: { display: true, text: 'Annualized Return (%)' } },
        },
      },
    });
  };

  rr1yChartInstance = createChart('rolling-chart-1y', rr1yChartInstance, 'rollingReturn1y');
  rr3yChartInstance = createChart('rolling-chart-3y', rr3yChartInstance, 'rollingReturn3y');
};
