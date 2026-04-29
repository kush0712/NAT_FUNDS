/**
 * js/router.js
 * Hash-based client-side routing helpers.
 * Depends on: state (state.js)
 */

/** Parse the current URL hash into a { view, ... } route descriptor. */
function getRoute() {
  const hash     = window.location.hash || '#/';
  const hashPath = hash.replace('#', '').split('?')[0];
  const parts    = hashPath.split('/').filter(Boolean);

  if (parts.length === 0)          return { view: 'home' };
  if (parts[0] === 'explore')      return { view: 'explore', category: parts[1] || 'Equity' };
  if (parts[0] === 'fund')         return { view: 'fund', schemeCode: parts[1] };
  if (parts[0] === 'compare')      return { view: 'compare' };
  return { view: 'home' };
}

/** Navigate to a hash route (e.g. '#/explore/Equity'). */
function navigate(hash) {
  window.location.hash = hash;
}
