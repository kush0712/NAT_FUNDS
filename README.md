# NAT Funds — Institutional-Grade Mutual Fund Analytics

A full-stack Node.js application that aggregates live data from AMFI India, NSE/BSE, and RBI to deliver institutional-grade analytics for Indian mutual funds. Browse ~9,100 schemes, filter by category, compare up to four funds side-by-side, and drill into a rich per-fund analytics page — all without a build step.

---

## Features

| Category | Metrics |
|---|---|
| **Returns** | CAGR 1Y / 3Y / 5Y, CAGR since inception, Rolling returns (1Y daily-step, 3Y monthly-step) |
| **Risk** | Standard Deviation (annualised), Max Drawdown (peak → trough → recovery), Riskometer |
| **Risk-adjusted** | Sharpe Ratio, Sortino Ratio, Calmar Ratio |
| **Benchmark-relative** | Beta, Jensen's Alpha, Calculated Information Ratio, R², Upside/Downside Capture Ratios |
| **AMFI-published** | AMFI Information Ratios (1Y/3Y/5Y/10Y, Direct + Regular), SEBI Riskometer label |
| **Peer scoring** | Consistency Score (0–10, percentile-ranked within sub-category) |
| **Fund metadata** | AUM (₹ Cr), Total Expense Ratio (TER), Benchmark name, Plan type, Option type |

---

## Architecture

```
server.js                    ← Entry point: Express setup, security, route mounting, boot trigger
│
├── shared/
│   ├── appState.js          ← Single source of truth for all in-memory state
│   └── logger.js            ← Pino structured logger (level from LOG_LEVEL env var)
│
├── boot/
│   ├── startup.js           ← Full boot() sequence (parse AMFI → fetch NAVs → compute metrics)
│   └── dataHelpers.js       ← Per-fund enrichment: TER, AUM, AMFI IR, Benchmark, Riskometer
│
├── routes/
│   ├── api.js               ← /api/* REST endpoints (funds, compare, search, nav-history)
│   ├── admin.js             ← /admin/* sync endpoints (auth-protected)
│   └── ter.js               ← /ter/:schemeCode lookup
│
├── services/
│   ├── amfiParser.js        ← Parses live AMFI NAV text feed; selects top funds
│   ├── dataFetcher.js       ← NAV history fetch (mfapi.in) + per-scheme disk cache
│   ├── metricsCalculator.js ← All quantitative metric calculations (~1,200 lines, pure functions)
│   ├── fundPerformanceService.js ← AUM, Benchmark, AMFI IR, SEBI Riskometer (AMFI Fund Performance API)
│   ├── terService.js        ← TER index (axios + ExcelJS); parsed from AMFI XLSX monthly
│   ├── triService.js        ← Benchmark Total Return Index history (NSE/BSE Indices APIs)
│   └── riskFreeRate.js      ← 91-day T-bill rate (RBI) — weekly in-memory cache
│
├── data/                    ← Persisted JSON stores (committed; see .gitignore comments)
│   ├── ter-data.json        ← TER index snapshot
│   ├── aum-data.json        ← AUM per scheme (daily, in Crores)
│   ├── benchmark-data.json  ← Fund → benchmark name mapping (90-day cache TTL)
│   ├── ir-data.json         ← AMFI-published Information Ratios 1Y/3Y/5Y/10Y per plan
│   ├── riskometer-data.json ← SEBI-mandated riskometer labels (daily)
│   └── tri-data.json        ← Benchmark TRI history
│
├── cache/                   ← Gitignored; auto-populated at runtime
│   ├── nav_<schemeCode>.json    ← Per-scheme NAV history (24h TTL)
│   ├── processed_funds.json     ← Full parsed+computed fund list (24h TTL; skips re-parse on warm restart)
│   └── ter-parsed.json          ← Parsed TER data (24h TTL; avoids re-downloading AMFI XLSX)
│
├── tests/
│   └── smoke.test.js        ← 9 import/shape smoke tests (node:test, no network, ~0.5 s)
│
├── dev-tools/               ← Standalone diagnostic scripts (19 files; never imported by the server)
│   ├── test-api.js          ← Basic API smoke test
│   ├── test-metrics.js      ← Metrics calculator unit checks
│   ├── diagnose.js          ← Data-coverage diagnostic report
│   ├── test-benchmark.js    ← TRI benchmark lookup check
│   └── app_original.js      ← Original monolithic frontend (reference only)
│   └── ...                  ← Additional debug scripts (debug-mf, test-beta, test-amfi, etc.)
│
├── scripts/                 ← Read-only data-quality audit tools
│   ├── audit_aum_norm.js    ← AUM match-rate audit across all 9,100+ funds
│   └── test_normalise.js    ← Unit tests for normaliseName() + false-positive check
│
└── public/                  ← Frontend SPA (no build step — vanilla HTML + JS modules)
    ├── index.html           ← SPA shell; loads split JS modules in strict dependency order
    ├── styles.css           ← Vanilla CSS
    └── js/
        ├── constants.js     ← CATEGORY_META, METRIC_TOOLTIPS
        ├── state.js         ← Frontend SPA state object
        ├── api.js           ← fetch() wrapper around /api/*
        ├── formatters.js    ← fmt, fmtNav, fmtAUM, fmtScore, etc.
        ├── router.js        ← Hash-based routing helpers
        ├── ui.js            ← showView, setPlanType, renderSidebar
        ├── search.js        ← Live search bar logic
        ├── compare.js       ← Compare-list management
        ├── charts.js        ← Chart.js wrappers
        ├── init.js          ← App bootstrap: polling loading screen → handleRoute()
        └── views/
            ├── home.js      ← Dashboard / category cards
            ├── explore.js   ← Fund table + filters + pagination
            ├── fund-detail.js ← Full per-fund analytics page
            └── compare.js   ← Side-by-side fund comparison
```

---

## Data Sources

| Source | Data | Refresh |
|---|---|---|
| AMFI NAV text feed (`amfiindia.com`) | Live NAV for ~9,100 schemes | On demand / boot |
| mfapi.in | Per-scheme historical NAV (full history) | Per-scheme disk cache (24h TTL) |
| AMFI Fund Performance API | AUM (₹ Cr), fund→benchmark map, AMFI IR (1Y/3Y/5Y/10Y), SEBI Riskometer | Daily cron at **09:30 IST** + `/admin/sync-aum` |
| AMFI TER XLSX | Total Expense Ratio per scheme | Daily cron at **09:00 IST** + `/admin/sync-ter` |
| NSE / BSE Indices API | Benchmark TRI history (used for Beta, Alpha, IR, Capture) | Daily cron at **09:31 IST** + `/admin/sync-tri` |
| CCIL India (91-day T-bill YTM) | Risk-free rate for Sharpe / Sortino / Jensen's Alpha | 24-hour disk cache; refreshed daily at boot |

> **Benchmark cache TTL**: `benchmark-data.json` has a 90-day cache TTL (benchmarks are semi-permanent per SEBI mandate). The `/admin/sync-aum` endpoint refreshes AUM + AMFI IR + Riskometer daily; benchmarks are re-synced only when the file is >90 days old.

### Caching strategy

Three tiers of cache are used:

- **`data/*.json`** — Persistent JSON stores committed to the repo (TER, AUM, TRI, benchmarks, AMFI IR, riskometers). Refreshed by cron jobs and admin endpoints.
- **`cache/nav_<schemeCode>.json`** — Per-scheme NAV history from mfapi.in. 24-hour TTL; git-ignored; auto-populated on first fetch.
- **`cache/processed_funds.json`** — Full parsed+computed fund list (all metrics applied). 24-hour TTL; git-ignored. On a warm restart within 24 hours, the boot sequence loads this file directly, skipping the full parse → fetch → compute cycle entirely.
- **`cache/ter-parsed.json`** — Pre-parsed TER data (JSON). 24-hour TTL; avoids re-downloading the large AMFI TER XLSX on every restart.

---

## How to Run

### Prerequisites
- Node.js 18+
- Internet access (fetches live AMFI data on first boot)

### Install & Start

```bash
npm install
npm start       # production — node server.js
npm run dev     # development — nodemon (auto-restarts on code changes)
npm test        # run smoke test suite (9 tests, ~0.5 s, no network)
```

On first boot the server:
1. Initialises TER index from `data/ter-data.json` (or syncs from AMFI if missing).
2. Loads AUM, Benchmark, AMFI IR, and SEBI Riskometer from `data/` stores (or syncs from AMFI Fund Performance API if stale).
3. Fetches the risk-free rate (RBI 91-day T-bill).
4. Checks for a fresh `cache/processed_funds.json` (< 24h old). If found, loads it and skips steps 5–7.
5. Parses the live AMFI NAV feed (~9,100 schemes).
6. Batch-fetches historical NAV for the top ~3,000 schemes using `cache/nav_<schemeCode>.json` (10 concurrent requests).
7. Computes all metrics (CAGR, Sharpe, Beta, Drawdown, etc.) in memory and saves `processed_funds.json`.
8. Sets `dataReady = true` and serves the SPA.

The frontend shows a live progress bar (polling `/api/status`) during steps 5–7.

### Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `ADMIN_SECRET` | _(empty)_ | If set, `/admin/*` requires `X-Admin-Secret` header |
| `CORS_ORIGIN` | _(empty)_ | If set, adds `Access-Control-Allow-Origin` for that domain. Leave empty — the frontend is served by this same server |
| `LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

---

## API Reference

### Public endpoints (`/api/*`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Server readiness + boot progress (polled by frontend) |
| `GET` | `/api/categories` | Category/sub-category counts; supports `?planType=` and `?optionType=` |
| `GET` | `/api/funds` | Paginated fund list with filtering and sorting |
| `GET` | `/api/fund/:schemeCode` | Single fund detail with live NAV sync and on-the-fly metric recalculation |
| `GET` | `/api/fund/:schemeCode/nav-history` | Sampled monthly NAV for charting; `?period=` accepts `1y`, `3y`, `5y`, `max` |
| `GET` | `/api/compare?codes=...` | Side-by-side comparison for 2–4 scheme codes |
| `GET` | `/api/search?q=...` | Full-text search across scheme name and AMC (top 20 results) |
| `GET` | `/ter/:schemeCode` | TER lookup for a single scheme code |

Query parameters for `/api/funds`:

| Param | Example | Description |
|---|---|---|
| `type` | `Equity` | Filter by fund type |
| `subCategory` | `Large Cap` | Filter by sub-category (comma-separated for multiple) |
| `planType` | `Direct` | `Direct` or `Regular` |
| `optionType` | `Growth` | `Growth` or `IDCW` |
| `search` | `HDFC` | Full-text search across scheme name and AMC |
| `sortBy` | `cagr3y` | Field to sort by (supports nested objects like rolling returns) |
| `order` | `desc` | `asc` or `desc` |
| `page` | `1` | Page number (1-indexed) |
| `limit` | `20` | Items per page (max 100) |

### Admin endpoints (`/admin/*`)

Require `X-Admin-Secret` header if `ADMIN_SECRET` env var is set.

```
GET /admin/sync-ter   — Re-download AMFI TER XLSX; rebuild ter-data.json
GET /admin/sync-aum   — Refresh AUM + AMFI IR + SEBI Riskometer from AMFI Fund Performance API
GET /admin/sync-tri   — Refresh all benchmark TRI histories from NSE/BSE
```

---

## Key Dev Scripts

### `dev-tools/` — standalone diagnostic runners

19 files total; safe to run independently at any time. Never imported by the server.

```bash
node dev-tools/test-api.js          # Basic API smoke test
node dev-tools/test-metrics.js      # Metrics calculator unit checks
node dev-tools/diagnose.js          # Data-coverage diagnostic report
node dev-tools/test-benchmark.js    # TRI benchmark lookup check
```

### `scripts/` — data-quality audit scripts

Read-only tools for verifying AUM normalisation correctness.
Never imported by the server. Safe to run after a data refresh.

```bash
node scripts/audit_aum_norm.js    # AUM match-rate audit across all 9,100+ funds
node scripts/test_normalise.js    # Unit tests for normaliseName() + false-positive check
```

---

## Metrics Methodology

All calculations live in `services/metricsCalculator.js` as pure functions.

### Calculated metrics (computed from NAV history + TRI)

| Metric | Methodology |
|---|---|
| **CAGR** | Closest-previous NAV lookup; max 7-day gap tolerance; N.A. if fund history is too short |
| **Rolling Returns (1Y)** | Daily-stepped windows; min/max distribution |
| **Rolling Returns (3Y)** | Monthly-stepped windows (one per calendar month); p10/p25/p75/p90 distribution |
| **Standard Deviation** | Annualised sample StdDev of monthly returns (36-month lookback, min 12) |
| **Sharpe Ratio** | `(avg_excess_return / stddev_fund) × √12`; excess return uses geometric monthly RFR from RBI T-bill |
| **Sortino Ratio** | Same as Sharpe but denominator is downside deviation only |
| **Beta** | Covariance/variance of 36 aligned monthly returns (fund vs TRI); requires real TRI data |
| **Jensen's Alpha** | `AnnFundReturn − [Rf + Beta × (AnnBenchReturn − Rf)]`; geometric annualisation |
| **Max Drawdown** | Two-pass O(n) scan; returns peak date, trough date, and recovery date |
| **Calmar Ratio** | `3Y CAGR (%) / abs(Max Drawdown (%))`; both inputs in percentage units (e.g. 12.5 for 12.5%); returns `null` if 3Y CAGR is unavailable or Max Drawdown is zero; rounded to 2 decimal places |
| **Information Ratio** | `(AnnFundReturn − AnnBenchReturn) / Tracking Error`; requires ≥36 aligned months |
| **R²** | Pearson correlation² between fund and benchmark monthly returns (0–100 scale) |
| **Upside/Downside Capture** | Morningstar method; ≥10 up-months and ≥6 down-months required |
| **Riskometer** | SEBI-mandated AMFI label when available; otherwise within-category percentile rank of StdDev |
| **Consistency Score** | Composite 0–10 score: 30% median 3Y rolling, 20% rolling positive %, 20% downside capture (inverted), 20% Sortino, 10% 3Y CAGR; percentile-normalised within sub-category |

### AMFI-published data (not calculated — sourced directly)

| Field | Source |
|---|---|
| **AMFI IR (1Y/3Y/5Y/10Y)** | `ir1YrDirect`, `ir3YrDirect`, etc. from AMFI Fund Performance API; stored in `ir-data.json`; applied as `fund.amfiIR` |
| **SEBI Riskometer** | `riskometerScheme` field from AMFI Fund Performance API; stored in `riskometer-data.json` |
| **AUM** | `dailyAUM` field from AMFI Fund Performance API; stored in `aum-data.json` |
| **Benchmark name** | `benchmark` field from AMFI Fund Performance API; stored in `benchmark-data.json` |
| **TER** | AMFI TER XLSX (`/api/populate-te-rdata-revised`); parsed by `terService.js` using ExcelJS; stored in `ter-data.json` |

> **IDCW note**: Rolling returns for IDCW plans reflect NAV movement only. Dividends paid out are not included, matching Tickertape/INDmoney methodology.

---

## Notes

- **No build step required** — plain HTML + vanilla JS split into modules loaded via `<script>` tags in strict dependency order in `index.html`.
- **`dev-tools/app_original.js`** is the original monolithic frontend (~88 KB) kept for reference only. The live application loads exclusively from `public/js/` modules.
- All financial calculations are read-only — no metric computation mutates external state.
- The `cache/` directory is git-ignored. On a fresh clone it is empty; it fills automatically as NAV data is fetched during the first boot and is fully rebuilt within 24 hours.
- `data/*.json` files can optionally be git-ignored (see commented lines in `.gitignore`) if you prefer not to commit the JSON stores. The application will re-sync them from AMFI/NSE/BSE on first boot.
- Rate limiting is enforced at the Express layer: **200 requests per minute per IP** (configurable in `server.js`).
