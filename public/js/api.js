/**
 * js/api.js
 * Thin wrapper around fetch() for all backend API calls.
 */

async function api(endpoint) {
  const resp = await fetch(`/api${endpoint}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}
