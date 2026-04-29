'use strict';
/**
 * shared/logger.js — Structured application logger (Pino)
 *
 * Usage:
 *   const logger = require('./shared/logger');       // from project root
 *   const logger = require('../shared/logger');      // from subdirectories
 *
 *   logger.info('Server started');
 *   logger.warn({ fundCode: 123 }, 'Missing TER');
 *   logger.error(err, 'Fatal boot error');
 *
 * Output:
 *   Development  → pino-pretty (human-readable, colourised)
 *   Production   → newline-delimited JSON (structured, pipe to log aggregator)
 *
 * Log level is controlled by the LOG_LEVEL env var (default: 'info').
 */

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize:      true,
        translateTime: 'HH:MM:ss',
        ignore:        'pid,hostname',
      },
    },
  }),
});

module.exports = logger;
