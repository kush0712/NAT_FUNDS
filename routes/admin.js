'use strict';

const logger = require('../shared/logger');/**
 * routes/admin.js
 *
 * Admin-only endpoints for manually triggering data syncs.
 * These are protected by the adminAuth middleware mounted in server.js.
 *
 * Endpoints:
 *   GET /admin/sync-ter   — Full AMFI TER sync
 *   GET /admin/sync-aum   — Full AMFI AUM + Riskometer sync
 *   GET /admin/sync-tri   — Full TRI benchmark refresh
 */

const express = require('express');
const router  = express.Router();

const state = require('../shared/appState');

const { syncTER, getTERDate }                          = require('../services/terService');
const { syncAUM, getAUMByName, getRiskometerByName }   = require('../services/fundPerformanceService');
const { syncTRI, getTRIHistory }                       = require('../services/triService');

// ─── GET /admin/sync-ter ─────────────────────────────────────────────────────
/**
 * Manually trigger a full AMFI TER sync.
 * Returns { ok, schemesProcessed, date } or { ok: false, error }.
 */
router.get('/sync-ter', async (req, res) => {
  logger.info('[Admin] Manual TER sync triggered');
  try {
    const count = await syncTER();
    res.json({
      ok: true,
      schemesProcessed: count,
      date: getTERDate(),
      message: `TER sync complete — ${count} schemes processed`,
    });
  } catch (err) {
    logger.error('[Admin] Manual TER sync failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /admin/sync-aum ─────────────────────────────────────────────────────
/**
 * Manually trigger a fresh AMFI daily AUM sync via Fund Performance API.
 * Also re-applies updated riskometer labels to all in-memory funds.
 */
router.get('/sync-aum', async (req, res) => {
  logger.info('[Admin] Manual AUM sync triggered (AMFI Fund Performance API)');
  try {
    const count = await syncAUM();
    let riskometerUpdated = 0;
    for (const f of state.allFunds) {
      const aum = getAUMByName(f.schemeName);
      f.aum = aum !== null ? aum : null;
      const riskometer = getRiskometerByName(f.schemeName);
      if (riskometer) {
        f.riskLevel = riskometer;
        f._amfiRiskometer = true;
        riskometerUpdated++;
      }
    }
    logger.info(`[Admin] Riskometer re-applied to ${riskometerUpdated} funds`);
    res.json({
      ok: true,
      schemesProcessed: count,
      riskometerUpdated,
      message: `AUM + Riskometer sync complete — ${count} schemes updated, ${riskometerUpdated} riskometers refreshed`,
    });
  } catch (err) {
    logger.error('[Admin] Manual AUM sync failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /admin/sync-tri ─────────────────────────────────────────────────────
/**
 * Manually trigger a full TRI refresh for all benchmark indices.
 * Also rebuilds the fundBenchmarkTRIs lookup map in memory.
 */
router.get('/sync-tri', async (req, res) => {
  logger.info('[Admin] Manual TRI sync triggered');
  try {
    const benchmarkNames = [...new Set(state.allFunds.map(f => f.benchmarkName).filter(Boolean))];
    const { saveTRI } = require('../services/triService');
    const count = await syncTRI(benchmarkNames);
    saveTRI();

    for (const f of state.allFunds) {
      if (f.benchmarkName) {
        const tri = getTRIHistory(f.benchmarkName);
        if (tri) state.fundBenchmarkTRIs[f.schemeCode] = tri;
      }
    }

    res.json({
      ok: true,
      benchmarksSynced: count,
      message: `TRI sync complete — ${count} benchmark indices refreshed`,
    });
  } catch (err) {
    logger.error('[Admin] Manual TRI sync failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
