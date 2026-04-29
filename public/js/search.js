/**
 * js/search.js
 * Global search input logic.
 * Depends on: api, shortName
 */

(function() {
  const searchInput   = document.getElementById('global-search');
  const searchResults = document.getElementById('search-results');
  let searchTimeout   = null;

  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) {
      searchResults.classList.add('hidden');
      return;
    }
    searchTimeout = setTimeout(async () => {
      try {
        const resp = await api(`/search?q=${encodeURIComponent(q)}`);
        if (resp.results.length === 0) {
          searchResults.classList.add('hidden');
          return;
        }
        searchResults.innerHTML = resp.results.map(f => `
          <a href="#/fund/${f.schemeCode}" class="block px-4 py-3 hover:bg-surface-container-low transition-colors border-b border-outline-variant/10 last:border-b-0" onclick="document.getElementById('search-results').classList.add('hidden'); document.getElementById('global-search').value='';">
            <div class="text-sm font-bold text-primary truncate">${shortName(f.schemeName)}</div>
            <div class="text-[10px] text-on-surface-variant uppercase">${f.type}: ${f.subCategory} • ${f.planType} • ${f.optionType}</div>
          </a>
        `).join('');
        searchResults.classList.remove('hidden');
      } catch (err) {
        searchResults.classList.add('hidden');
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('search-container')?.contains(e.target)) {
      searchResults.classList.add('hidden');
    }
  });
})();
