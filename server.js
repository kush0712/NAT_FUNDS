'use strict';
/**
 * server.js — NAT funds Application Entry Point
 *
 * Responsibilities (this file only):
 *   1. Load environment config (.env)
 *   2. Create and configure the Express app
 *   3. Mount all route modules
 *   4. Start the HTTP server
 *   5. Trigger the boot sequence (data load) after the server is listening
 *
 * All business logic lives in:
 *   routes/    — HTTP request/response handlers
 *   boot/      — Data initialisation sequence
 *   services/  — Core business logic (metrics, data fetching, etc.)
 *   shared/    — Shared in-memory application state
 */

require('dotenv').config();

const express   = require('express');
const path      = require('path');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const logger    = require('./shared/logger');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Security headers (Helmet) ────────────────────────────────────────────────
// Adds X-Content-Type-Options, X-Frame-Options, HSTS, etc.
// CSP is disabled because the frontend loads Tailwind, Chart.js, and Material
// Symbols from CDN — a strict CSP would block those without a nonce setup.
app.use(helmet({ contentSecurityPolicy: false }));

// ─── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── CORS ────────────────────────────────────────────────────────────────────
// The frontend is served by this same Express server (same origin), so CORS
// headers are NOT needed for normal use. Set CORS_ORIGIN in .env only if an
// external client (different domain/port) needs to call the API directly.
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
    next();
  });
  logger.info(`CORS enabled for origin: ${CORS_ORIGIN}`);
}

// ─── Rate limiting (prevents abuse of API endpoints) ─────────────────────────
// 200 requests per minute per IP — generous enough for normal use.
app.use('/api/', rateLimit({
  windowMs:        60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
}));

// ─── Admin authentication middleware ─────────────────────────────────────────
// If ADMIN_SECRET is set in .env, all /admin/* requests must include the
// matching X-Admin-Secret header. Leave ADMIN_SECRET empty to keep open.
const adminAuth = (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ─── Route modules ───────────────────────────────────────────────────────────
app.use('/api',   require('./routes/api'));
app.use('/admin', adminAuth, require('./routes/admin'));
app.use('/',      require('./routes/ter'));

// ─── SPA fallback ────────────────────────────────────────────────────────────
// Must be last — any route not matched above serves the frontend SPA.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  require('./boot/startup')
    .boot()
    .catch(err => logger.error(err, '[Boot] Fatal error'));
});

// ─── Process-level safety net ─────────────────────────────────────────────────
// Logs unhandled promise rejections and uncaught exceptions instead of silently
// crashing. Does NOT change any application behaviour — purely observability.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, '[Process] Unhandled Promise Rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal(err, '[Process] Uncaught Exception');
  process.exit(1);
});
