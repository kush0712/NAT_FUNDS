/**
 * js/ui.js
 * View management and plan/option type toggles.
 * Depends on: state (state.js)
 *
 * Exposes:
 *   showView(viewId)  — hide all views, show the named one, update nav
 *   setPlanType(type) — Direct/Regular toggle (called from HTML onclick)
 *   setOptionType(type) — Growth/IDCW toggle (called from HTML onclick)
 *   renderSidebar()   — repaint the left-sidebar category links
 */

// ─── View switcher ────────────────────────────────────────────────────────────

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

  // Update active nav link
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

// ─── Plan / Option type toggles ───────────────────────────────────────────────

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

// Expose to HTML onclick handlers
window.setPlanType  = setPlanType;
window.setOptionType = setOptionType;

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar() {
  const nav   = document.getElementById('sidebar-nav');
  const types = ['Equity', 'Debt', 'Hybrid', 'Index', 'ETF', 'Solution', 'Other'];

  nav.innerHTML = types.map(type => {
    const meta    = CATEGORY_META[type] || {};
    const count   = state.categorySummary[type] ? state.categorySummary[type].count : 0;
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
