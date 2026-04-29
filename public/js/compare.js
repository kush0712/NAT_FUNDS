/**
 * js/compare.js
 * Compare-list state management and floating compare bar.
 * Depends on: state (state.js)
 *
 * Exposes (window.*):
 *   toggleCompare(schemeCode)
 *   clearCompare()
 *   goToCompare()
 */

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
  const bar    = document.getElementById('compare-bar');
  const text   = document.getElementById('compare-bar-text');
  const action = document.getElementById('compare-action');
  const count  = document.getElementById('compare-count');

  if (state.compareList.length >= 2) {
    bar.classList.add('visible');
    if (action) action.classList.remove('hidden');
    if (count)  count.textContent = state.compareList.length;
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

// Expose to HTML onclick handlers
window.toggleCompare = toggleCompare;
window.clearCompare  = clearCompare;
window.goToCompare   = goToCompare;
