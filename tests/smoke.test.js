'use strict';
/**
 * tests/smoke.test.js
 *
 * Smoke tests — verify that all modules can be imported without errors,
 * and that key shared state shapes are correct.
 *
 * Run with:  npm test
 *
 * Uses Node's built-in test runner (node:test) — no extra dependencies.
 * These tests are intentionally lightweight; they do NOT spin up a server
 * or make network calls, so they run in under a second.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ─── shared/appState ─────────────────────────────────────────────────────────
describe('shared/appState', () => {
  const state = require('../shared/appState');

  test('exports the correct shape', () => {
    assert.ok(Array.isArray(state.allFunds),               'allFunds should be an array');
    assert.ok(typeof state.fundsByCode === 'object',       'fundsByCode should be an object');
    assert.ok(typeof state.categorySummary === 'object',   'categorySummary should be an object');
    assert.ok(typeof state.dataReady === 'boolean',        'dataReady should be a boolean');
    assert.ok(typeof state.loadingProgress === 'object',   'loadingProgress should be an object');
    assert.ok(typeof state.fundBenchmarkTRIs === 'object', 'fundBenchmarkTRIs should be an object');
  });

  test('loadingProgress has required fields', () => {
    const p = state.loadingProgress;
    assert.ok('phase'     in p, 'phase missing');
    assert.ok('completed' in p, 'completed missing');
    assert.ok('total'     in p, 'total missing');
    assert.ok('cached'    in p, 'cached missing');
  });

  test('starts in a not-ready state', () => {
    assert.equal(state.dataReady, false, 'should not be ready before boot');
    assert.equal(state.allFunds.length, 0, 'allFunds should start empty');
  });
});

// ─── shared/logger ───────────────────────────────────────────────────────────
describe('shared/logger', () => {
  const logger = require('../shared/logger');

  test('exports a pino logger with expected methods', () => {
    assert.ok(typeof logger.info  === 'function', 'logger.info must be a function');
    assert.ok(typeof logger.warn  === 'function', 'logger.warn must be a function');
    assert.ok(typeof logger.error === 'function', 'logger.error must be a function');
    assert.ok(typeof logger.fatal === 'function', 'logger.fatal must be a function');
    assert.ok(typeof logger.debug === 'function', 'logger.debug must be a function');
  });

  test('has a level property', () => {
    assert.ok(typeof logger.level === 'string', 'logger.level must be a string');
  });
});

// ─── boot/dataHelpers ────────────────────────────────────────────────────────
describe('boot/dataHelpers', () => {
  const helpers = require('../boot/dataHelpers');

  test('exports all required functions', () => {
    assert.ok(typeof helpers.applyTER                      === 'function', 'applyTER missing');
    assert.ok(typeof helpers.applyAUMandBenchmark          === 'function', 'applyAUMandBenchmark missing');
    assert.ok(typeof helpers.applyIR                       === 'function', 'applyIR missing');
    assert.ok(typeof helpers.applyRiskometer               === 'function', 'applyRiskometer missing');
    assert.ok(typeof helpers.printBootReconciliationReport === 'function', 'printBootReconciliationReport missing');
  });
});

// ─── routes — can be required without throwing ────────────────────────────────
describe('routes', () => {
  test('routes/api exports an Express router', () => {
    const router = require('../routes/api');
    // Express routers are functions with a .stack array
    assert.ok(typeof router === 'function', 'api router must be a function');
  });

  test('routes/admin exports an Express router', () => {
    const router = require('../routes/admin');
    assert.ok(typeof router === 'function', 'admin router must be a function');
  });

  test('routes/ter exports an Express router', () => {
    const router = require('../routes/ter');
    assert.ok(typeof router === 'function', 'ter router must be a function');
  });
});
