# NAT funds — Institutional-Grade Mutual Fund Analytics

A full-stack Node.js application that aggregates AMFI India data to provide institutional-grade analytics for Indian mutual funds — including rolling returns, Sharpe/Sortino ratios, Jensen's Alpha, drawdown analysis, and a real-time riskometer.

## Architecture

```
server.js              ← Entry point (~75 lines): Express setup, route mounting, boot trigger
├── shared/
│   └── appState.js    ← Single source of truth for all in-memory state
├── boot/
│   ├── dataHelpers.js ← Per-fund enrichment: TER, AUM, IR, Riskometer
│   └── startup.js     ← Full boot() sequence: parse AMFI, fetch NAVs, compute metrics
├── routes/
│   ├── api.js         ← /api/* REST endpoints
│   ├── admin.js       ← /admin/* sync endpoints (auth-protected)
│   └── ter.js         ← /ter/:schemeCode lookup
├── services/
│   ├── amfiParser.js          ← Parses live AMFI NAV text feed
│   ├── dataFetcher.js         ← NAV history fetch + disk cache
│   ├── metricsCalculator.js   ← All quantitative metric calculations
│   ├── terService.js          ← TER index (AMFI XLSX)
│   ├── fundPerformanceService.js ← AUM, benchmark, IR, riskometer (AMFI API)
│   ├── triService.js          ← Benchmark TRI history (NSE/BSE)
│   └── riskFreeRate.js        ← 91-day T-bill rate (RBI)
└── public/
    ├── index.html     ← SPA shell; loads split JS modules in order
    ├── styles.css     ← Vanilla CSS
    └── js/
        ├── constants.js      ← CATEGORY_META, METRIC_TOOLTIPS
        ├── state.js          ← Frontend SPA state object
        ├── api.js            ← fetch() wrapper
        ├── formatters.js     ← fmt, fmtNav, fmtAUM, fmtScore, etc.
        ├── router.js         ← Hash-based routing helpers
        ├── ui.js             ← showView, setPlanType, renderSidebar
        ├── compare.js        ← Compare-list management
        ├── charts.js         ← Chart.js wrappers
        └── views/
            ├── home.js       ← Dashboard / category cards
            ├── explore.js    ← Fund table + filters + pagination
            ├── fund-detail.js← Full fund analytics page
            └── compare.js    ← Side-by-side comparison
```

## Data Sources

| Source | Data | Refresh |
|---|---|---|
| AMFI NAV text feed | Live NAV for ~9,100 schemes | On demand / boot |
| AMFI Fund Performance API | AUM (₹ Cr), benchmark, IR, riskometer | Daily cron |
| AMFI TER XLSX | Total Expense Ratio per scheme | Daily cron |
| NSE / BSE TRI | Benchmark Total Return Index history | Daily cron |
| RBI 91-day T-bill | Risk-free rate for Sharpe/Jensen calculations | Weekly cache |

## How to Run

### Prerequisites
- Node.js 18+
- Internet access (fetches live AMFI data on boot)

### Install & Start

```bash
npm install
npm start       # production — node server.js
npm run dev     # development — nodemon (auto-restarts on code changes)
npm test        # run the test suite (9 smoke tests, ~0.5s)
```

### Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `ADMIN_SECRET` | _(empty)_ | If set, `/admin/*` requires `X-Admin-Secret` header |
| `CORS_ORIGIN` | _(empty)_ | If set, adds `Access-Control-Allow-Origin` for that domain. Leave empty — not needed when frontend is served by this same server |
| `LOG_LEVEL` | `info` | Pino log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` |

### Admin Endpoints

These trigger manual data syncs (require `X-Admin-Secret` header if `ADMIN_SECRET` is set):

```
GET /admin/sync-ter   — Refresh TER index from AMFI XLSX
GET /admin/sync-aum   — Refresh AUM + riskometer from AMFI Fund Performance API
GET /admin/sync-tri   — Refresh all benchmark TRI histories
```

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
node scripts/audit_aum_norm.js   # AUM match-rate audit across all 9,100+ funds
node scripts/test_normalise.js   # Unit tests for normaliseName() + false-positive check
```

## Notes

- **No build step required** — plain HTML + vanilla-JS split into modules loaded via `<script>` tags in strict dependency order.
- `public/app.js` is the **original monolithic frontend file** kept for reference only. The live application loads from `public/js/` modules exclusively. It is not loaded by `index.html`.
- All financial calculations are read-only — the refactoring introduced zero logic changes.
