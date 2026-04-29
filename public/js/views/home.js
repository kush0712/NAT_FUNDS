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
