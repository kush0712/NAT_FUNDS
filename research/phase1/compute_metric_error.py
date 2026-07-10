#!/usr/bin/env python3
"""
Phase 1 — Metric-Level Error (Alpha & Beta)
compute_metric_error.py

Quantifies the error introduced into Beta and Alpha by substituting 
BSE TRI with Nifty TRI, measured against independent BSE Price data.

Methodology:
1. Identify all cached BSE-benchmarked funds (BSE 100, 200, 500, SENSEX).
2. Align 36-month monthly return series for:
     a) Fund NAV
     b) Proxy Benchmark (Nifty TRI from tri-data.json)
     c) True Benchmark (BSE Price from Yahoo Finance)
3. Compute 3Y Beta and Annualised Alpha under both regimes.
4. Calculate ΔBeta and ΔAlpha (Proxy - True).
"""

import json
import glob
import sys
import numpy as np
import pandas as pd
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
PHASE1_DIR = Path(__file__).resolve().parent
PHASE0_DATA = PHASE1_DIR.parent / 'phase0' / 'data'
OUT_DIR = PHASE1_DIR / 'outputs'
FIG_DIR = OUT_DIR / 'figures'

OUT_DIR.mkdir(parents=True, exist_ok=True)
FIG_DIR.mkdir(parents=True, exist_ok=True)

BENCHMARK_JSON = BASE_DIR / 'data' / 'benchmark-data.json'
TRI_JSON = BASE_DIR / 'data' / 'tri-data.json'
BSE_PRICE_CSV = PHASE0_DATA / 'bse_price_raw.csv'
CACHE_DIR = BASE_DIR / 'cache'

# Mapping Original BSE Benchmark to YF Name and Proxy Nifty Name
BSE_MAP = {
    'bse sensex tri': ('BSE SENSEX', 'Nifty 50 TRI'),
    'bse 100 tri':    ('BSE 100', 'Nifty 100 TRI'),
    'bse 200 tri':    ('BSE 200', 'Nifty 200 TRI'),
    'bse 500 tri':    ('BSE 500', 'Nifty 500 TRI'),
}

def to_monthly_returns(series):
    """Resample to month-end returns."""
    return series.resample('ME').last().dropna().pct_change().dropna()

def extract_nav_series(records):
    """Convert [{date, nav}] to pd.Series with DatetimeIndex."""
    dates, navs = [], []
    for r in records:
        try:
            d = pd.Timestamp(r['date'], unit='ms') if isinstance(r.get('date'), (int, float)) else pd.Timestamp(r['date'])
            navs.append(float(r['nav']))
            dates.append(d.normalize())
        except Exception:
            continue
    if not dates:
        return pd.Series(dtype=float)
    s = pd.Series(navs, index=pd.DatetimeIndex(dates))
    return s[~s.index.duplicated(keep='last')].sort_index()

def calculate_beta(fund_ret, bench_ret):
    cov = np.cov(fund_ret, bench_ret)[0, 1]
    var = np.var(bench_ret, ddof=1)
    return cov / var if var != 0 else np.nan

def calculate_alpha(fund_ret, bench_ret, beta, risk_free_annual=0.06):
    rf_monthly = (1 + risk_free_annual)**(1/12) - 1
    mean_fund = np.mean(fund_ret - rf_monthly)
    mean_bench = np.mean(bench_ret - rf_monthly)
    alpha_monthly = mean_fund - beta * mean_bench
    # Annualise alpha
    alpha_annual = (1 + alpha_monthly)**12 - 1
    return alpha_annual * 100 # In percentage

def main():
    print("Loading benchmark mappings...")
    with open(BENCHMARK_JSON) as f:
        bm = json.load(f)
    bm_data = bm.get('data', {})
    
    print("Loading Proxy Benchmarks (Nifty TRI)...")
    with open(TRI_JSON) as f:
        tri = json.load(f)
    tri_data = tri.get('data', tri)
    
    proxy_series = {}
    for nifty_name in set(v[1] for v in BSE_MAP.values()):
        if nifty_name in tri_data:
            proxy_series[nifty_name] = to_monthly_returns(extract_nav_series(tri_data[nifty_name]))
    
    print("Loading True Benchmarks (BSE Price YF)...")
    bse_df = pd.read_csv(BSE_PRICE_CSV, parse_dates=['date'])
    bse_df = bse_df.dropna(subset=['price'])
    bse_wide = bse_df.pivot_table(index='date', columns='index_name', values='price', aggfunc='last')
    
    true_series = {}
    for yf_name in set(v[0] for v in BSE_MAP.values()):
        if yf_name in bse_wide.columns:
            true_series[yf_name] = to_monthly_returns(bse_wide[yf_name].dropna())
    
    print("Scanning cache for BSE-benchmarked funds...")
    nav_files = glob.glob(str(CACHE_DIR / 'nav_*.json'))
    
    results = []
    
    for file in nav_files:
        with open(file) as f:
            nav = json.load(f)
        
        meta = nav.get('meta', {})
        scheme_name = meta.get('scheme_name')
        if not scheme_name:
            continue
            
        fund_benchmark = bm_data.get(scheme_name.lower().strip())
        if not fund_benchmark:
            continue
            
        fund_benchmark_lower = fund_benchmark.lower()
        if fund_benchmark_lower not in BSE_MAP:
            continue
            
        yf_name, nifty_name = BSE_MAP[fund_benchmark_lower]
        
        if yf_name not in true_series or nifty_name not in proxy_series:
            continue
            
        fund_navs = extract_nav_series(nav.get('data', []))
        if len(fund_navs) < 250: # roughly 1 year
            continue
            
        fund_ret = to_monthly_returns(fund_navs)
        
        # Align over last 36 months max
        common_idx = fund_ret.index.intersection(true_series[yf_name].index).intersection(proxy_series[nifty_name].index)
        
        # Take last 36 months
        if len(common_idx) > 36:
            common_idx = common_idx[-36:]
            
        if len(common_idx) < 12: # Need at least 12 months for a valid beta
            continue
            
        f_r = fund_ret.loc[common_idx].values
        t_r = true_series[yf_name].loc[common_idx].values
        p_r = proxy_series[nifty_name].loc[common_idx].values
        
        # True Metrics
        true_beta = calculate_beta(f_r, t_r)
        true_alpha = calculate_alpha(f_r, t_r, true_beta)
        
        # Proxy Metrics
        proxy_beta = calculate_beta(f_r, p_r)
        proxy_alpha = calculate_alpha(f_r, p_r, proxy_beta)
        
        results.append({
            'scheme_name': scheme_name,
            'bse_benchmark': fund_benchmark,
            'n_months': len(common_idx),
            'true_beta': round(true_beta, 4),
            'proxy_beta': round(proxy_beta, 4),
            'delta_beta': round(proxy_beta - true_beta, 4),
            'true_alpha_pct': round(true_alpha, 4),
            'proxy_alpha_pct': round(proxy_alpha, 4),
            'delta_alpha_pct': round(proxy_alpha - true_alpha, 4)
        })

    if not results:
        print("No valid BSE funds found with sufficient data.")
        return
        
    df = pd.DataFrame(results)
    df.to_csv(OUT_DIR / 'metric_errors.csv', index=False)
    print(f"Processed {len(df)} funds.")
    print(f"Saved metric errors to {OUT_DIR / 'metric_errors.csv'}")
    
    # Summary
    print("\n═══ Error Summary (Proxy - True) ═══")
    print(f"Mean ΔBeta:  {df['delta_beta'].mean():.4f}")
    print(f"Mean ΔAlpha: {df['delta_alpha_pct'].mean():.4f}%")
    print(f"Max  |ΔBeta|: {df['delta_beta'].abs().max():.4f}")
    print(f"Max  |ΔAlpha|: {df['delta_alpha_pct'].abs().max():.4f}%")
    
    # Plot Beta Distribution
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.hist(df['delta_beta'], bins=20, color='#2563EB', edgecolor='white')
    ax.axvline(0, color='red', linestyle='dashed', linewidth=1.5)
    ax.set_title('Distribution of Beta Error (Proxy Beta - True Beta)')
    ax.set_xlabel('ΔBeta')
    ax.set_ylabel('Number of Funds')
    fig.savefig(FIG_DIR / 'delta_beta_hist.png', dpi=150)
    
    # Plot Alpha Distribution
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.hist(df['delta_alpha_pct'], bins=20, color='#10B981', edgecolor='white')
    ax.axvline(0, color='red', linestyle='dashed', linewidth=1.5)
    ax.set_title('Distribution of Alpha Error (Proxy Alpha - True Alpha)')
    ax.set_xlabel('ΔAlpha (Annualised %)')
    ax.set_ylabel('Number of Funds')
    fig.savefig(FIG_DIR / 'delta_alpha_hist.png', dpi=150)
    
if __name__ == '__main__':
    main()
