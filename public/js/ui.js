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
    a.classList.remove('active-nav');
  });

  const navMap = { home: 'nav-dashboard', explore: 'nav-explore', compare: 'nav-compare' };
  const activeNav = document.getElementById(navMap[viewId.replace('view-', '')]);
  if (activeNav) {
    activeNav.classList.add('active-nav');
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
         class="flex items-center gap-3 px-4 py-2.5 rounded-md transition-all duration-150 relative ${
           isActive
             ? 'bg-[rgba(0,117,222,0.07)] text-ink font-semibold sidebar-active'
             : 'text-ink-muted hover:bg-canvas-soft hover:text-ink'
         }">
        <span class="material-symbols-outlined" style="font-size:18px; ${isActive ? "font-variation-settings:'FILL' 1;color:var(--color-primary)" : 'color:var(--color-ink-faint)'}">${meta.icon || 'folder'}</span>
        <span class="text-[13px] font-label">${meta.label || type}</span>
        <span class="ml-auto text-[11px] text-ink-faint tabular-nums">${count}</span>
      </a>
    `;
  }).join('');
}
