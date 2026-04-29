/**
 * js/init.js
 * Application bootstrap: handleRoute, init, event listeners.
 * Loaded last — all other modules must be loaded first.
 */

async function handleRoute() {
  const route = getRoute();
  switch (route.view) {
    case 'home':    await renderHome();                      break;
    case 'explore': await renderExplore(route.category);    break;
    case 'fund':    await renderFundDetail(route.schemeCode); break;
    case 'compare': await renderCompare();                  break;
    default:        await renderHome();
  }
}

async function init() {
  showView('loading-screen');

  let ready = false;
  while (!ready) {
    try {
      const status = await api('/status');
      ready = status.ready;
      if (status.progress.total > 0) {
        const pct = Math.round((status.progress.completed / status.progress.total) * 100);
        document.getElementById('loading-bar-fill').style.width = pct + '%';
        document.getElementById('loading-message').textContent =
          status.progress.phase === 'fetching'
            ? `Fetching historical data: ${status.progress.completed}/${status.progress.total} schemes (${status.progress.cached} cached)...`
            : status.progress.phase === 'calculating'
            ? 'Calculating performance metrics...'
            : status.progress.phase === 'complete'
            ? 'Ready!'
            : 'Parsing AMFI data...';
      }
    } catch (err) { /* server not ready yet */ }
    if (!ready) await new Promise(r => setTimeout(r, 1000));
  }

  state.loadingComplete = true;

  try {
    state.categorySummary = await api(`/categories?planType=${state.planType}&optionType=${state.optionType}`);
  } catch (err) {}

  handleRoute();
}

window.addEventListener('hashchange', handleRoute);
init();
