/**
 * js/views/home.js
 * Renders the Dashboard / Home view.
 * Depends on: state, api, CATEGORY_META, getInitialBg, getInitials,
 *             shortName, fmt, getRiskBadgeColor, renderSidebar, showView
 */

async function renderHome() {
  showView('view-home');
  state.currentView    = 'home';
  state.currentCategory = null;
  renderSidebar();

  try {
    // Fetch categories filtered by current plan/option type
    const cats = await api(`/categories?planType=${state.planType}&optionType=${state.optionType}`);
    state.categorySummary = cats;
    renderSidebar();

    // Render category bento cards
    const cardsEl = document.getElementById('category-cards');
    const types   = ['Equity', 'Debt', 'Hybrid', 'Index', 'ETF', 'Solution'];

    cardsEl.innerHTML = types.filter(t => cats[t] && cats[t].count > 0).map(type => {
      const meta  = CATEGORY_META[type];
      const count = cats[type].count;
      return `
        <a href="#/explore/${type}" class="group bg-canvas border border-hairline p-6 rounded-lg hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden block" style="box-shadow:none; transition: box-shadow 0.2s ease, transform 0.2s ease;" onmouseenter="this.style.boxShadow='var(--shadow-soft)'" onmouseleave="this.style.boxShadow='none'">
          <div class="flex justify-between items-start mb-6">
            <span class="material-symbols-outlined text-primary" style="font-size:28px;">${meta.icon}</span>
            <span class="badge-pill">${meta.tag}</span>
          </div>
          <h3 class="font-headline font-bold text-ink mb-1" style="font-size:20px; letter-spacing:-0.125px;">${meta.label}</h3>
          <p class="text-ink-muted text-[13px] mb-4 leading-relaxed">${meta.desc}</p>
          <div class="flex items-center gap-2 text-ink-muted text-[13px]">
            <span class="tabular-nums font-semibold text-ink">${count}</span>
            <span class="opacity-70">schemes</span>
          </div>
        </a>
      `;
    }).join('');

    // Fetch featured funds (top by 3Y CAGR)
    const featuredEl = document.getElementById('featured-funds');
    const resp = await api(`/funds?planType=${state.planType}&optionType=${state.optionType}&sortBy=cagr3y&order=desc&limit=10`);

    if (resp.funds.length === 0) {
      featuredEl.innerHTML = '<div class="p-8 text-center text-on-surface-variant">Loading fund data... Please wait.</div>';
      return;
    }

    featuredEl.innerHTML = `
      <table class="w-full text-left">
        <thead>
          <tr class="bg-canvas-soft border-b border-hairline">
            <th class="px-6 py-3 eyebrow-label">Fund Name</th>
            <th class="px-6 py-3 eyebrow-label">Category</th>
            <th class="px-6 py-3 eyebrow-label text-right">3Y CAGR</th>
            <th class="px-6 py-3 eyebrow-label text-right">Risk</th>
            <th class="px-6 py-3 eyebrow-label text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-hairline">
          ${resp.funds.map(f => `
            <tr class="group hover:bg-canvas-soft transition-colors">
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-lg ${getInitialBg(f.amc)} flex items-center justify-center font-bold text-xs">${getInitials(f.amc)}</div>
                  <div>
                    <a href="#/fund/${f.schemeCode}" class="font-label font-semibold text-primary hover:underline text-sm" style="letter-spacing:-0.125px;">${shortName(f.schemeName)}</a>
                    <p class="text-[11px] text-ink-faint uppercase tracking-wide">${f.planType} · ${f.optionType}</p>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-ink-muted">${f.type}: ${f.subCategory}</td>
              <td class="px-6 py-4 text-right text-sm tabular-nums font-semibold">${fmt(f.cagr3y)}</td>
              <td class="px-6 py-4 text-right">
                ${f.riskLevel ? `<span class="text-[10px] font-semibold tracking-wide px-3 py-1 ${getRiskBadgeColor(f.riskLevel)} rounded-full">${f.riskLevel}</span>` : '<span class="text-ink-faint text-xs">—</span>'}
              </td>
              <td class="px-6 py-4 text-right">
                <a href="#/fund/${f.schemeCode}" class="px-4 py-1.5 border border-primary text-primary text-xs font-semibold rounded-full hover:bg-primary hover:text-white transition-all">View Details</a>
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
