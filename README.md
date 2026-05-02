# NAT Funds — Institutional-Grade Mutual Fund Analytics

A full-stack Node.js application that aggregates live data from AMFI India, NSE/BSE, and RBI to deliver institutional-grade analytics for Indian mutual funds. Browse ~9,100 schemes, filter by category, compare up to four funds side-by-side, and drill into a rich per-fund analytics page — all without a build step.

---

## Features

| Category | Metrics |
|---|---|
| **Returns** | CAGR 1Y / 3Y / 5Y, CAGR since inception, Rolling returns (1Y daily-step, 3Y monthly-step) |
| **Risk** | Standard Deviation (annualised), Max Drawdown (peak → trough → recovery), Riskometer |
| **Risk-adjusted** | Sharpe Ratio, Sortino Ratio, Calmar Ratio |
| **Benchmark-relative** | Beta, Jensen's Alpha, Information Ratio, R², Upside/Downside Capture Ratios |
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
│   └── dataHelpers.js       ← Per-fund enrichment: TER, AUM, IR, Benchmark, Riskometer
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
│   ├── fundPerformanceService.js ← AUM, benchmark, IR, Riskometer (AMFI Fund Performance API)
│   ├── terService.js        ← TER index parsed from AMFI XLSX
│   ├── triService.js        ← Benchmark Total Return Index history (NSE/BSE Indices APIs)
│   └── riskFreeRate.js      ← 91-day T-bill rate (RBI) — weekly cache
│
├── data/                    ← Persisted JSON stores (committed; see .gitignore comments)
│   ├── ter-data.json        ← TER index snapshot (~500 KB)
│   ├── aum-data.json        ← AUM per scheme (~76 KB)
│   ├── benchmark-data.json  ← Fund → benchmark mapping (~108 KB)
│   ├── ir-data.json         ← Information Ratio from AMFI (~93 KB)
│   ├── riskometer-data.json ← Official AMFI riskometer labels (~86 KB)
│   └── tri-data.json        ← Benchmark TRI history (~14 MB)
│
├── cache/                   ← Per-scheme NAV history (gitignored; auto-populated at runtime)
│   └── nav_<schemeCode>.json
│
├── tests/
│   └── smoke.test.js        ← 9 import/shape smoke tests (node:test, no network, ~0.5 s)
│
├── dev-tools/               ← Standalone diagnostic scripts (never imported by the server)
│   ├── test-api.js          ← Basic API smoke test
│   ├── test-metrics.js      ← Metrics calculator unit checks
│   ├── diagnose.js          ← Data-coverage diagnostic report
│   ├── test-benchmark.js    ← TRI benchmark lookup check
│   └── app_original.js      ← Original monolithic frontend (reference only)
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
| mfapi.in | Per-scheme historical NAV (full history) | Per-scheme disk cache (on fetch) |
| AMFI Fund Performance API | AUM (₹ Cr), fund→benchmark map, IR, Riskometer | Daily cron + `/admin/sync-aum` |
| AMFI TER XLSX | Total Expense Ratio per scheme | Daily cron + `/admin/sync-ter` |
| NSE / BSE Indices API | Benchmark TRI history (used for Beta, Alpha, IR, Capture) | Daily cron + `/admin/sync-tri` |
| RBI 91-day T-bill | Risk-free rate for Sharpe / Sortino / Jensen's Alpha | Weekly in-memory cache |

### Caching strategy

- **`data/*.json`** — persistent JSON stores committed to the repo (TER, AUM, TRI, benchmarks, riskometers). Refreshed via cron and admin endpoints.
- **`cache/nav_<schemeCode>.json`** — per-scheme NAV history. Git-ignored; auto-populated by `dataFetcher.js` on first request and reused on subsequent boots. The boot sequence uses a **24-hour TTL** on a processed-data cache to skip the full parse+compute cycle on warm restarts.

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
1. Initialises TER, AUM/Benchmark/Riskometer, and risk-free rate from persisted `data/` stores.
2. Parses the live AMFI NAV feed (~9,100 schemes).
3. Batch-fetches historical NAV for the top ~3,000 schemes (using the disk cache for already-fetched schemes).
4. Computes all metrics (CAGR, Sharpe, Beta, Drawdown, etc.) in memory.
5. Sets `dataReady = true` and serves the SPA.

The frontend shows a live progress bar (polling `/api/status`) during the boot sequence.

### Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `ADMIN_SECRET` | _(empty)_ | If set, `/admin/*` requires `X-Admin-Secret` header |
| `CORS_ORIGIN` | _(empty)_ | If set, adds `Access-Control-Allow-Origin` for that domain. Leave empty — not needed when the frontend is served by this same server |
| `LOG_LEVEL` | `info` | Pino log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` |

---

## API Reference

### Public endpoints (`/api/*`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Server readiness + boot progress (polled by frontend) |
| `GET` | `/api/categories` | Category/sub-category counts; supports `?planType=` and `?optionType=` |
| `GET` | `/api/funds` | Paginated fund list with filtering and sorting |
| `GET` | `/api/fund/:schemeCode` | Single fund detail with live NAV sync and on-the-fly metric recalculation |
| `GET` | `/api/fund/:schemeCode/nav-history` | Sampled monthly NAV for charting; `?period=1y\|3y\|5y\|max` |
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
GET /admin/sync-ter   — Refresh TER index from AMFI XLSX
GET /admin/sync-aum   — Refresh AUM + Riskometer from AMFI Fund Performance API
GET /admin/sync-tri   — Refresh all benchmark TRI histories
```

---

## Key Dev Scripts

### `dev-tools/` — standalone diagnostic runners

Safe to run independently at any time. Never imported by the server.

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

| Metric | Methodology |
|---|---|
| **CAGR** | Closest-previous NAV lookup; max 7-day gap tolerance; N.A. if fund history is too short |
| **Rolling Returns (1Y)** | Daily-stepped windows; min/max distribution |
| **Rolling Returns (3Y)** | Monthly-stepped windows (one per calendar month); p10/p25/p75/p90 distribution |
| **Standard Deviation** | Annualised sample StdDev of monthly returns (36-month lookback, min 12) |
| **Sharpe Ratio** | `(avg_excess_return / stddev_fund) × √12`; excess return uses geometric monthly RFR from RBI T-bill |
| **Sortino Ratio** | Same as Sharpe but denominator is downside deviation only |
| **Beta** | OLS regression on 36 aligned monthly returns (fund vs TRI); requires real TRI data |
| **Jensen's Alpha** | `AnnFundReturn − [Rf + Beta × (AnnBenchReturn − Rf)]`; geometric annualisation |
| **Max Drawdown** | Two-pass O(n) scan; returns peak date, trough date, and recovery date |
| **Calmar Ratio** | `3Y CAGR / |Max Drawdown|` |
| **Information Ratio** | `(AnnFundReturn − AnnBenchReturn) / Tracking Error`; requires ≥36 aligned months |
| **R²** | Pearson correlation² between fund and benchmark monthly returns (0–100 scale) |
| **Upside/Downside Capture** | MorningStar method; ≥10 up-months and ≥6 down-months required |
| **Riskometer** | Official AMFI label when available; otherwise within-category percentile rank of StdDev |
| **Consistency Score** | Composite 0–10 score: 30% median 3Y rolling, 20% rolling positive %, 20% downside capture (inverted), 20% Sortino, 10% 3Y CAGR; percentile-normalised within sub-category |

> **IDCW note**: Rolling returns for IDCW plans reflect NAV movement only. Dividends paid out are not included, matching Tickertape/INDmoney methodology.

---

## Notes

- **No build step required** — plain HTML + vanilla JS split into modules loaded via `<script>` tags in strict dependency order.
- **`dev-tools/app_original.js`** is the original monolithic frontend (~88 KB) kept for reference only. The live application loads exclusively from `public/js/` modules.
- All financial calculations are read-only — no metric computation mutates external state.
- The `cache/` directory is git-ignored. On a fresh clone the cache is empty; it fills automatically as NAV data is fetched during the first boot.
- `data/*.json` files can optionally be git-ignored (see commented lines in `.gitignore`) if you prefer not to commit the large JSON stores. The application will re-fetch them from AMFI/NSE/BSE on first boot.
