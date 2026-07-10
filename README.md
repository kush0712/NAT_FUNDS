# NAT funds — Indian Mutual Fund Analytics Platform

A full-stack web app for discovering, analysing, and comparing Indian mutual funds using institutional-grade metrics — built from scratch with Node.js and vanilla JS.

---

## What is this?

I got frustrated trying to compare mutual funds on existing platforms. Most of them hide the good metrics behind a paywall, don't show you beta/alpha/sortino at all, or give you numbers without explaining what they mean. So I built my own.

NAT funds pulls live NAV data from AMFI, fetches real TRI (Total Return Index) benchmark data directly from NSE/BSE, and computes ~15 risk-adjusted financial metrics locally — Sharpe Ratio, Sortino Ratio, Jensen's Alpha, Calmar Ratio, Upside/Downside Capture, R², Information Ratio, and a composite Consistency Score. Everything is calculated server-side with the actual math, not scraped from a third-party API.

---

## Features

- **Live AMFI data** — Fetches the full NAV universe (~9,000+ schemes) from `amfiindia.com` on every boot. Parses the bulk NAV text file, categorises every fund, and has the entire universe available in memory within seconds.

- **Real TRI benchmarks** — Fetches actual Total Return Index time-series from NSE's Nifty Indices API. BSE-benchmarked funds use the corresponding Nifty TRI series as a wholesale substitute due to lack of public BSE TRI APIs. **Empirically validated:** A rigorous 10-year analysis (2014-2023) proves a Pearson $r$ of 0.965–0.975 for broad market pairs. This substitution preserves Beta stability ($\Delta\beta \approx 0.025$) and effectively suppresses a dangerous 1.77% Alpha inflation bias that would occur if using public BSE Price data.

- **Proper financial metrics** — Not scraped, actually computed:
  - CAGR (1Y / 3Y / 5Y / Since Inception) with binary search date alignment and 7-day gap tolerance
  - Rolling Returns (1Y daily-stepped, 3Y monthly-stepped with p10/p25/p75/p90 distribution)
  - Sharpe and Sortino Ratio using live 91-day T-bill yield from CCIL India
  - Beta, Jensen's Alpha, R² using 36-month aligned monthly returns against real TRI
  - Max Drawdown with peak/trough/recovery dates
  - Calmar Ratio (3Y CAGR ÷ Max Drawdown)
  - Upside / Downside Capture Ratios (MorningStar standard, ≥10 up-months required)
  - Information Ratio with geometric annualisation
  - Composite Consistency Score (0–10) normalised within sub-category peers

- **Smart caching** — Market-aware cache TTL. Cache is stale only if saved before the last AMFI NAV publish date (6 PM IST on the last business day). Stale cache fast-path serves data immediately while a background refresh runs — zero startup lag.

- **Fund comparison** — Select 2–4 funds and compare them side-by-side. Rolling return distribution chart (Chart.js) shows the full distribution, not just averages.

- **AMFI riskometer integration** — Official SEBI riskometer labels from AMFI's Fund Performance API are loaded daily and take priority over the calculated risk level. No chance of a Liquid fund being labelled "Very High" due to an edge case in the percentile logic.

- **AUM, TER, IR, Benchmark data** — All pulled from AMFI. Fuzzy name matching with 4-level lookup cascade (exact → substring → space-collapsed → token overlap ≥ 0.75) handles the naming inconsistencies between AMFI's different APIs.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Node.js, Express |
| Frontend | Vanilla JS (modular, no framework), Tailwind CSS (CDN), Chart.js |
| Data sources | AMFI India, mfapi.in, NSE Nifty Indices, BSE India, CCIL India, RBI |
| Caching | Filesystem (JSON + XLSX) |
| Security | Helmet, express-rate-limit |
| Scheduling | node-cron (daily AUM + TRI refresh at 09:30 IST) |
| Logging | Pino |

---

## Project Structure

```
.
├── server.js                   # Express app, route mounting, process safety net
├── boot/
│   ├── startup.js              # Full boot sequence — 5-phase init with cache-aware fast paths
│   └── dataHelpers.js          # TER/AUM/Benchmark/Riskometer enrichment helpers
├── services/
│   ├── amfiParser.js           # AMFI NAV bulk file parser + fund categorisation
│   ├── dataFetcher.js          # mfapi.in NAV history, TER Excel parsing, cache management
│   ├── metricsCalculator.js    # All financial metric calculations (1,191 lines of pure math)
│   ├── fundPerformanceService.js # AUM, benchmarks, IR, riskometer from AMFI Fund Perf API
│   ├── triService.js           # TRI time-series from NSE; BSE benchmarks served via wholesale Nifty substitution (r≈0.97, empirically validated Beta stability)
│   └── riskFreeRate.js         # 91-day T-bill yield from CCIL India, weekly cached
├── routes/
│   ├── api.js                  # REST API handlers (/api/funds, /api/fund/:code, /api/compare, etc.)
│   ├── admin.js                # Admin endpoints (secret-header gated)
│   └── ter.js                  # TER data endpoint
├── shared/
│   ├── appState.js             # In-memory state (allFunds, fundsByCode, fundBenchmarkTRIs, etc.)
│   └── logger.js               # Pino logger wrapper
├── public/
│   ├── index.html              # SPA shell, Tailwind config, layout
│   ├── styles.css              # Custom CSS (spinners, glassmorphism, tooltips)
│   └── js/
│       ├── constants.js        # Metric labels, risk colours, sort options
│       ├── state.js            # Frontend state (selected filters, compare basket)
│       ├── api.js              # fetch() wrappers for all API endpoints
│       ├── formatters.js       # Number/percentage/date formatters
│       ├── router.js           # Hash-based SPA router (#/, #/explore, #/fund/:code, #/compare)
│       ├── ui.js               # Shared UI helpers (tooltips, pagination, loading bar)
│       ├── charts.js           # Chart.js wrappers for NAV history + rolling return charts
│       ├── search.js           # Global search (debounced, dropdown)
│       ├── compare.js          # Compare basket state (localStorage persisted)
│       └── views/
│           ├── home.js         # Dashboard view — category cards, top performers
│           ├── explore.js      # Explore view — fund table with filters, sort, pagination
│           ├── fund-detail.js  # Fund detail view — all metrics + NAV chart
│           └── compare.js      # Compare view — side-by-side metric table + rolling charts
└── data/
    ├── aum-data.json           # Daily AUM index (normalised name → AUM in Cr.)
    ├── benchmark-data.json     # Per-fund benchmark assignments (quarterly refresh)
    ├── ir-data.json            # Information Ratios from AMFI
    ├── riskometer-data.json    # SEBI riskometer labels from AMFI
    └── tri-data.json           # TRI time-series (~14MB, all benchmark indices)
```

---

## Getting Started

### Prerequisites
- Node.js 18+

### Setup
```bash
git clone <repo-url>
cd "MF kj"
npm install
```

Create a `.env` file:
```env
PORT=3001
# Optional
ADMIN_SECRET=your_secret_here
CORS_ORIGIN=
```

### Run
```bash
# Development (with nodemon auto-reload)
npm run dev

# Production
npm start
```

Open `http://localhost:3001`. On first boot it fetches live data from AMFI and computes metrics — this takes a couple of minutes. Subsequent boots load from cache and are instant.

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/status` | Server readiness + loading progress |
| `GET /api/categories` | Fund category/sub-category counts |
| `GET /api/funds` | Paginated fund list with filtering and sorting |
| `GET /api/fund/:schemeCode` | Single fund detail with all metrics |
| `GET /api/fund/:schemeCode/nav-history` | Sampled NAV history for charting |
| `GET /api/compare?codes=a,b,c` | Side-by-side comparison for 2–4 funds |
| `GET /api/search?q=query` | Full-text search across scheme name + AMC |

---

## How the metrics work

A few things I spent a lot of time getting right:

**CAGR date alignment** — Uses binary search to find the closest previous NAV (backward-looking only). If the gap to the target date is > 7 calendar days, the period returns null ("N.A.") rather than silently using a stale price.

**Rolling returns** — 1Y uses daily stepping (standard). 3Y uses monthly stepping to avoid extreme autocorrelation. Beat-benchmark comparison requires ≤3 calendar day alignment between fund and TRI dates.

**Sharpe / Sortino** — Uses live 91-day T-bill yield from CCIL India, geometrically compounded to monthly. Falls back to the last cached rate if the API is down; never falls back to a hardcoded constant.

**Beta / Alpha / R²** — Computed against real TRI data (not NAV-of-index-fund as a proxy). This matters — using an index fund NAV introduces TER drag that biases Beta downward.

**Risk level** — Within-category percentile ranking, not static thresholds. The most volatile fund in a subcategory is "Very High", the least is "Low". SEBI riskometer overrides this when available.

**Consistency Score** — Composite 0–10 score normalised within sub-category peers. Weights: Median 3Y rolling return (30%), Rolling positive % (20%), Downside capture (20%), Sortino (20%), 3Y CAGR (10%).

---

## Data Sources

- **NAV data** — [AMFI India](https://www.amfiindia.com/spages/NAVAll.txt) (end-of-day, updated after 6 PM IST)
- **Historical NAV history** — [mfapi.in](https://api.mfapi.in) (open source MF API)
- **TRI benchmarks** — [NSE Nifty Indices API](https://niftyindices.com) + [BSE AllIndices CSV](https://www.bseindia.com)
- **AUM / Riskometer / IR** — [AMFI Fund Performance API](https://www.amfiindia.com/gateway/pollingsebi/api/amfi/fundperformance)
- **Risk-free rate** — [CCIL India](https://www.ccilindia.com/tenorwise-indicative-yields) (91-day T-bill YTM)
- **TER data** — [AMFI TER API](https://www.amfiindia.com/api/populate-te-rdata-revised) (monthly Excel)

---

## 📚 Empirical Research

The BSE benchmark substitution (Nifty TRI standing in for unavailable BSE TRI) has been subjected to a rigorous empirical evaluation. Key findings from the `research/` directory:

- **Broad-market correlation:** Over 120 months (July 2016–June 2026), Pearson $r = 0.965$–$0.975$ between BSE Price indices (Yahoo Finance) and their Nifty TRI proxies — a lower bound on the true TRI-to-TRI correlation, since Price indices exclude dividends.
- **Beta stability:** Across 13 large-cap BSE-benchmarked ETFs (SBI, ICICI, UTI, Nippon, Kotak, DSP, Mirae, Axis, BANDHAN, Aditya Birla, LIC MF), mean $\Delta\beta = +0.025$ (SD 0.014) — economically negligible for retail evaluation.
- **Alpha accounting correction:** Mean $\Delta\alpha = -1.77\%$ (SD 0.53%), consistent with the Indian equity dividend yield (~1.5–2.0% p.a.) — the proxy avoids the Price-index Alpha inflation that SEBI's 2018 TRI mandate was designed to eliminate.
- **Thematic failure mode:** Nifty CPSE substituted for BSE Select Business Groups yields $r = 0.656$ — a structural mismatch that must be excluded from automated mapping.

Full scripts, raw CSVs, and output files are in [`research/`](research/). See [`research/README.md`](research/README.md) for the reproduction guide.

> ⚠️ **Limitation:** Because BSE TRI data is unavailable, all comparisons above use BSE *Price* as a baseline, not BSE TRI. Results are a lower bound; the central question of Nifty-TRI-to-BSE-TRI fidelity requires commercial data to answer definitively.

---

## Disclaimer

This is a personal project for learning and portfolio demonstration purposes. Not investment advice. NAV data is end-of-day, not real-time. Past performance does not guarantee future returns. Always read the scheme documents before investing.

---

*Built by Kushagra Jaiswal*
