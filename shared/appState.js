'use strict';
/**
 * shared/appState.js
 *
 * Single source of truth for all mutable in-memory application state.
 * Imported by routes and the boot sequence; mutated directly (objects are
 * passed by reference in Node.js, so all modules see the same values).
 */

const state = {
  /** @type {Array} Full list of all funds, enriched with metrics at boot */
  allFunds: [],

  /** @type {Object} schemeCode → fund object (O(1) lookup by code) */
  fundsByCode: {},

  /** @type {Object} Category summary used by /api/categories */
  categorySummary: {},

  /** @type {boolean} Set to true once the boot sequence completes */
  dataReady: false,

  /** @type {{ phase: string, completed: number, total: number, cached: number }} */
  loadingProgress: { phase: 'init', completed: 0, total: 0, cached: 0 },

  /**
   * schemeCode → TRI series array [{date: Date, nav: number}]
   * Populated at boot; used for per-fund beta/alpha/capture metrics.
   */
  fundBenchmarkTRIs: {},
};

module.exports = state;
