#!/usr/bin/env python3
"""
Phase 0 — Steps 0.1 & 0.2 (REWRITE)
collect_bse_tri.py

Replaces the Node.js version which failed because BSE's IndexArchiveData API
is CSRF-protected and requires live browser session cookies.

Strategy (in order of preference):
  1. Yahoo Finance (yfinance) — reliable, public, no auth required
     Gives us Price Index (Close) for BSE indices.
     Note: Yahoo Finance does NOT carry BSE TRI (dividend-adjusted). It gives Price only.
     We use Price for correlation analysis and clearly document this in the paper.

  2. NSE's TRI endpoint (already proven to work in triService.js) — for Nifty side.

  3. Manual BSE TRI note:
     BSE TRI is available on the BSE India website interactively but is NOT
     accessible via any public API. This inaccessibility is documented as a
     core finding of the paper (the data access problem we are studying).

Yahoo Finance tickers for BSE indices:
  ^BSESN       = BSE SENSEX (Price)
  ^BSEMIDCAP   = BSE MIDCAP (Price)  [may not be available]
  BSE-500.BO   = BSE 500 via .BO suffix [limited availability]

Empirical strategy:
  We will collect BSE SENSEX price (^BSESN) — the only reliably available
  long-run BSE series on Yahoo Finance — and pair it with NIFTY 50 TRI from
  tri-data.json. For the paper, we note this is Price-vs-TRI, which introduces
  a known dividend-reinvestment bias we quantify separately.

Output:
  research/phase0/data/bse_price_raw.csv    — BSE Price Index (Yahoo Finance)
  research/phase0/data/availability_log.txt  — documents what was/wasn't available

Usage:
  python3 research/phase0/collect_bse_tri.py
"""

import sys
import json
from pathlib import Path
from datetime import datetime, timedelta

try:
    import yfinance as yf
    import pandas as pd
    import numpy as np
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'yfinance', 'pandas', 'numpy', '-q'])
    import yfinance as yf
    import pandas as pd
    import numpy as np

# ─── Paths ────────────────────────────────────────────────────────────────────
PHASE0_DIR   = Path(__file__).resolve().parent
DATA_DIR     = PHASE0_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)

PROJECT_ROOT = PHASE0_DIR.parent.parent
TRI_JSON     = PROJECT_ROOT / 'data' / 'tri-data.json'

START_DATE   = '2014-01-01'
END_DATE     = datetime.today().strftime('%Y-%m-%d')

# ─── Yahoo Finance Ticker Map ─────────────────────────────────────────────────
# Maps our BSE index name → Yahoo Finance ticker.
# Note: Yahoo Finance gives Price Index (Close), NOT TRI.
# Availability is confirmed empirically; many BSE sub-indices are not on YF.

YF_TICKER_MAP = {
    'BSE SENSEX':           '^BSESN',        # Best data — goes back to 1997
    'BSE 100':              'BSE-100.BO',     # May have limited history
    'BSE 200':              'BSE-200.BO',     # May have limited history
    'BSE 500':              'BSE-500.BO',     # May have limited history
    'BSE Midcap':           '^BSEMIDCAP',     # Available on YF
    'BSE Smallcap':         '^BSESML',        # May not be available
    'BSE BANKEX':           'BANKEX.BO',      # Limited availability
    'BSE Healthcare':       '^BSEHLTH',       # May not be available
    'BSE IT (Teck)':        '^BSEIT',         # May not be available
}

# Nifty proxies from tri-data.json (our primary analysis series)
NIFTY_PROXY_MAP = {
    'BSE SENSEX':   'NIFTY 50',
    'BSE 100':      'NIFTY 100',
    'BSE 200':      'NIFTY 200',
    'BSE 500':      'NIFTY 500',
    'BSE Midcap':   'NIFTY MIDCAP 150',
    'BSE Smallcap': 'NIFTY SMALLCAP 250',
    'BSE BANKEX':   'NIFTY BANK',
    'BSE Healthcare': 'NIFTY HEALTHCARE',
    'BSE IT (Teck)': 'NIFTY IT',
}


def fetch_yf_price(ticker: str, name: str) -> pd.DataFrame | None:
    """Download price history from Yahoo Finance. Returns DataFrame or None."""
    try:
        df = yf.download(
            ticker,
            start=START_DATE,
            end=END_DATE,
            progress=False,
            auto_adjust=True,
        )
        if df.empty:
            return None

        # Flatten MultiIndex columns if present
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        close = df[['Close']].copy()
        close.index = pd.to_datetime(close.index).normalize()
        close.columns = ['price']
        close['index_name'] = name
        close['ticker']     = ticker
        close['source']     = 'Yahoo Finance (Price Index, NOT TRI)'
        return close.dropna()
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return None


def load_nifty_tri_from_json() -> dict:
    """Load tri-data.json → { indexName: pd.Series(date→nav) }"""
    if not TRI_JSON.exists():
        print(f"  WARNING: {TRI_JSON} not found. Run npm start on NAT_FUNDS first.")
        return {}

    with open(TRI_JSON, 'r') as f:
        raw = json.load(f)

    series_map = {}
    for name, records in raw.items():
        if not isinstance(records, list) or len(records) == 0:
            continue
        dates, navs = [], []
        for r in records:
            try:
                if isinstance(r.get('date'), (int, float)):
                    d = pd.Timestamp(r['date'], unit='ms')
                else:
                    d = pd.Timestamp(r['date'])
                navs.append(float(r['nav']))
                dates.append(d.normalize())
            except Exception:
                continue
        if dates:
            s = pd.Series(navs, index=pd.DatetimeIndex(dates), name=name)
            s = s[~s.index.duplicated(keep='last')].sort_index()
            series_map[name] = s
    return series_map


def main():
    print('\n╔══════════════════════════════════════════════════════════════╗')
    print('║  Phase 0.1/0.2 — BSE Data Collection via Yahoo Finance       ║')
    print('╚══════════════════════════════════════════════════════════════╝\n')
    print(f'  Period: {START_DATE} → {END_DATE}\n')

    all_frames = []
    availability_log = []
    availability_log.append('BSE Data Availability Log')
    availability_log.append('=' * 60)
    availability_log.append(f'Run date: {END_DATE}')
    availability_log.append('')
    availability_log.append('FINDING: BSE India public APIs are NOT programmatically accessible.')
    availability_log.append('  - api.bseindia.com: deprecated (returns 404 HTML)')
    availability_log.append('  - www.bseindia.com/Indices/IndexArchiveData.aspx/GetChartData:')
    availability_log.append('    requires live browser session (CSRF-protected, blocks bots)')
    availability_log.append('')
    availability_log.append('IMPLICATION FOR PAPER: The inaccessibility of BSE TRI data through')
    availability_log.append('any public API is itself a key finding — it directly motivates the')
    availability_log.append('open-proxy approach studied in this paper.')
    availability_log.append('')
    availability_log.append('FALLBACK: Yahoo Finance (yfinance) — provides BSE Price Index (Close).')
    availability_log.append('NOTE: Yahoo Finance gives PRICE index, NOT TRI (dividend-adjusted).')
    availability_log.append('This introduces a known dividend-reinvestment bias documented below.')
    availability_log.append('')
    availability_log.append('Per-Index Availability:')
    availability_log.append('-' * 60)

    for bse_name, ticker in YF_TICKER_MAP.items():
        nifty_proxy = NIFTY_PROXY_MAP.get(bse_name, 'N/A')
        print(f'  ▸ {bse_name} ({ticker}) ↔ {nifty_proxy}')

        df = fetch_yf_price(ticker, bse_name)
        if df is not None and len(df) > 0:
            earliest = df.index.min().date()
            latest   = df.index.max().date()
            n_rows   = len(df)
            print(f'    ✓ {n_rows} rows  [{earliest} → {latest}]  (Price Index)')
            availability_log.append(
                f'  {bse_name:<25} {ticker:<15} OK  {n_rows:>5} rows  '
                f'[{earliest} → {latest}]  TYPE: Price (not TRI)'
            )
            all_frames.append(df.reset_index().rename(columns={'Date': 'date', 'index': 'date'}))
        else:
            print(f'    ✗ Not available on Yahoo Finance')
            availability_log.append(
                f'  {bse_name:<25} {ticker:<15} NOT AVAILABLE on Yahoo Finance'
            )

    # ── Write bse_price_raw.csv ───────────────────────────────────────────────
    if all_frames:
        combined = pd.concat(all_frames, ignore_index=True)
        # Ensure date column is correct
        if 'Date' in combined.columns:
            combined = combined.rename(columns={'Date': 'date'})
        combined['date'] = pd.to_datetime(combined['date']).dt.strftime('%Y-%m-%d')
        combined = combined.sort_values(['index_name', 'date'])

        out_path = DATA_DIR / 'bse_price_raw.csv'
        combined.to_csv(out_path, index=False)
        print(f'\n  ✅ Written: {out_path}  ({len(combined)} rows)')
    else:
        print('\n  ⚠ No BSE data collected at all.')

    # ── Write availability_log.txt ────────────────────────────────────────────
    log_path = DATA_DIR / 'availability_log.txt'
    with open(log_path, 'w') as f:
        f.write('\n'.join(availability_log))
    print(f'  ✅ Written: {log_path}')

    # ── Also dump Nifty TRI series list from tri-data.json ───────────────────
    print('\n  ── Nifty TRI data in tri-data.json ────────────────────────────')
    nifty_map = load_nifty_tri_from_json()
    nifty_rows = []
    for name, s in sorted(nifty_map.items()):
        if len(s) > 0:
            nifty_rows.append({
                'index_name': name,
                'n_days': len(s),
                'start': str(s.index.min().date()),
                'end':   str(s.index.max().date()),
                'source': 'NAT_FUNDS tri-data.json (NSE Nifty TRI API)',
            })
            print(f'  {name:<45} {len(s):>5} days  [{s.index.min().date()} → {s.index.max().date()}]')

    nifty_df = pd.DataFrame(nifty_rows)
    nifty_path = DATA_DIR / 'nifty_tri_index.csv'
    nifty_df.to_csv(nifty_path, index=False)
    print(f'\n  ✅ Written: {nifty_path}  ({len(nifty_df)} Nifty series)')
    print('\n  Phase 0.1/0.2 complete.\n')


if __name__ == '__main__':
    main()
