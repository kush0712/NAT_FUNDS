/**
 * js/views/explore.js
 * Renders the Explore / Category deep-dive view and fund table.
 * Depends on: state, api, CATEGORY_META, getInitialBg, getInitials,
 *             shortName, fmt, fmtNav, fmtAUM, fmtScore, renderSidebar, showView
 *
 * Exposes (window.*):
 *   toggleMarketCap(cap)
 *   toggleSubCategory(sub)
 *   changePage(newPage)
 */

async function renderExplore(category) {
  showView('view-explore');
  state.currentView = 'explore';

  // When switching to a different category, reset filters
  if (state.currentCategory !== category) {
    state.selectedSubCategories = [];
    state.selectedMarketCaps    = [];
  }

  // Always reset to page 1 on (re-)enter
  state.page = 1;
  state.currentCategory = category;
  renderSidebar();

  const meta = CATEGORY_META[category] || { label: category };

  // Breadcrumb + titles
  document.getElementById('explore-breadcrumb').innerHTML = `
    <a href="#/" class="hover:text-primary cursor-pointer">Explore</a>
    <span class="material-symbols-outlined text-xs">chevron_right</span>
    <span class="font-semibold text-primary">${meta.label} Funds</span>
  `;
  document.getElementById('explore-title').textContent    = `${meta.label} Deep-Dive`;
  document.getElementById('explore-subtitle').textContent = `Institutional grade analysis of ${meta.label.toLowerCase()} mutual funds. Screen across sub-categories and performance.`;
  document.getElementById('table-title').textContent      = `${meta.label} Performance Matrix`;

  try {
    const cats = await api(`/categories?planType=${state.planType}&optionType=${state.optionType}`);
    state.categorySummary = cats;
    renderSidebar();

    const subCats = cats[category] ? cats[category].subCategories : {};
    state.currentSubCategories = Object.keys(subCats);

    // Sub-category checkboxes
    const filtersEl   = document.getElementById('subcategory-filters');
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

    // Market Cap quick filters (Equity only)
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

    await fetchAndRenderFunds();
  } catch (err) {
    console.error('Error rendering explore:', err);
  }
}

window.toggleMarketCap = function(cap) {
  const idx = state.selectedMarketCaps.indexOf(cap);
  if (idx >= 0) state.selectedMarketCaps.splice(idx, 1);
  else          state.selectedMarketCaps.push(cap);
  state.page = 1;
  fetchAndRenderFunds();
  renderExplore(state.currentCategory);
};

window.toggleSubCategory = function(sub) {
  const idx = state.selectedSubCategories.indexOf(sub);
  if (idx >= 0) state.selectedSubCategories.splice(idx, 1);
  else          state.selectedSubCategories.push(sub);
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

  // Pagination controls
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
  document.getElementById('fund-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Sort-column click handler (attached once at the module level)
document.addEventListener('click', e => {
  const sortable = e.target.closest('.sortable');
  if (sortable && sortable.dataset.sort) {
    const field = sortable.dataset.sort;
    if (state.sortBy === field) {
      state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortBy    = field;
      state.sortOrder = 'desc';
    }
    state.page = 1;
    fetchAndRenderFunds();
  }
});
