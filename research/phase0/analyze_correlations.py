#!/usr/bin/env python3
"""
Phase 0 — Steps 0.4 to 0.7 (CORRECTED)
analyze_correlations.py

KEY FINDING from prior run:
  tri-data.json stores Nifty TRI data under BSE benchmark names as the
  wholesale substitute — i.e., "BSE SENSEX TRI" in tri-data.json contains
  the Nifty 50 TRI values, byte-for-byte identical. Comparing them gives r=1.0
  because they ARE the same series. This IS the substitution — not the error.

CORRECT APPROACH:
  To measure the actual proxy error, we need INDEPENDENT BSE data.
  We use Yahoo Finance (bse_price_raw.csv) for BSE index levels:
    ^BSESN   → BSE SENSEX (Price, not TRI)
    BSE-100.BO → BSE 100  (Price)
    BSE-200.BO → BSE 200  (Price)
    BSE-500.BO → BSE 500  (Price)

  Against the ACTUAL Nifty TRI series from tri-data.json (which is what
  NAT_FUNDS uses in place of BSE TRI for BSE-benchmarked funds).

  This is Price vs TRI — introducing a known dividend bias (~1-2%/yr).
  We document this explicitly and bound the true TRI-TRI correlation from below.

  BSE Power TRI (17 months) likely IS real BSE data fetched from BSE AllIndices
  CSV for recent months before the API was deprecated. We include it separately.

Outputs:
  research/phase0/outputs/overlap_matrix.csv
  research/phase0/outputs/correlation_results.csv
  research/phase0/outputs/bootstrap_cis.csv
  research/phase0/outputs/figures/
"""

import json, sys, warnings
from pathlib import Path

import numpy  as np
import pandas as pd
from scipy import stats
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

warnings.filterwarnings('ignore')

PHASE0_DIR = Path(__file__).resolve().parent
DATA_DIR   = PHASE0_DIR / 'data'
OUT_DIR    = PHASE0_DIR / 'outputs'
FIG_DIR    = OUT_DIR / 'figures'
TRI_JSON   = PHASE0_DIR.parent.parent / 'data' / 'tri-data.json'
BSE_PRICE_CSV = DATA_DIR / 'bse_price_raw.csv'

OUT_DIR.mkdir(parents=True, exist_ok=True)
FIG_DIR.mkdir(parents=True, exist_ok=True)

# ─── Analysis 1: Yahoo Finance BSE Price  ↔  Nifty TRI (independent, main) ───
# BSE Price from Yahoo Finance — independent of NAT_FUNDS data
# Nifty TRI from tri-data.json — the actual proxy NAT_FUNDS uses
# Note: Price vs TRI comparison (dividend bias ~1-2%/yr, documented as limitation)

YF_TO_NIFTY = {
    'BSE SENSEX': 'Nifty 50 TRI',
    'BSE 100':    'Nifty 100 TRI',
    'BSE 200':    'Nifty 200 TRI',
    'BSE 500':    'Nifty 500 TRI',
}

# ─── Analysis 2: BSE Power TRI (real BSE, short window) ↔ Nifty Energy TRI ──
# BSE Power TRI in tri-data.json has only 17 months — likely fetched from the
# now-deprecated BSE AllIndices CSV before the API was closed. These are actual
# independent BSE values and give r=0.8958 over 17 months.
# We report this separately as the only true TRI-vs-TRI independent pair.
BSE_SHORT_PAIRS = {
    'BSE Power TRI': ('Nifty Energy TRI', 'actual_bse_tri_17mo'),
    'BSE Quality TRI': ('Nifty 200 Quality 30 TRI', 'different_index_composition'),
    'BSE Select Business Groups Index TRI': ('Nifty CPSE TRI', 'different_index_composition'),
}

N_BOOTSTRAP = 10_000
SEED        = 42


def load_tri_json():
    with open(TRI_JSON) as f:
        raw = json.load(f)
    index_data = raw['data'] if 'data' in raw else raw
    out = {}
    for name, records in index_data.items():
        if not isinstance(records, list): continue
        dates, navs = [], []
        for r in records:
            try:
                d = pd.Timestamp(r['date'], unit='ms') if isinstance(r.get('date'), (int, float)) \
                    else pd.Timestamp(r['date'])
                navs.append(float(r['nav']))
                dates.append(d.normalize())
            except: continue
        if dates:
            s = pd.Series(navs, index=pd.DatetimeIndex(dates), name=name)
            out[name] = s[~s.index.duplicated(keep='last')].sort_index()
    return out


def load_bse_price():
    if not BSE_PRICE_CSV.exists():
        print(f"  ERROR: {BSE_PRICE_CSV} not found. Run collect_bse_tri.py first.")
        sys.exit(1)
    df = pd.read_csv(BSE_PRICE_CSV, parse_dates=['date'])
    df = df.dropna(subset=['price'])
    wide = df.pivot_table(index='date', columns='index_name', values='price', aggfunc='last')
    return wide.sort_index()


def to_monthly_returns(series):
    return series.resample('ME').last().dropna().pct_change().dropna()


def bootstrap_ci(x, y, stat_fn, n=N_BOOTSTRAP, seed=SEED):
    rng = np.random.default_rng(seed)
    idx = np.arange(len(x))
    boot = []
    for _ in range(n):
        s = rng.choice(idx, len(idx), replace=True)
        try:
            boot.append(stat_fn(x[s], y[s]))
        except:
            boot.append(np.nan)
    boot = np.array(boot)
    boot = boot[np.isfinite(boot)]
    return np.percentile(boot, 2.5), np.percentile(boot, 97.5), boot


def run_pair(bse_series, nifty_series, bse_label, nifty_label, data_note):
    result = dict(
        bse_index=bse_label, nifty_proxy=nifty_label,
        data_note=data_note,
        overlap_start=None, overlap_end=None, overlap_months=None,
        pearson_r=None, pearson_r2=None, pearson_p=None,
        pearson_ci_lo=None, pearson_ci_hi=None,
        spearman_rho=None, spearman_p=None,
        spearman_ci_lo=None, spearman_ci_hi=None,
        mean_bse_return=None, mean_nifty_return=None,
        std_bse_return=None, std_nifty_return=None,
        mean_abs_diff=None, max_abs_diff=None,
        notes='',
    )

    br = to_monthly_returns(bse_series)
    nr = to_monthly_returns(nifty_series)
    common = br.index.intersection(nr.index)
    if len(common) < 12:
        result['notes'] = f'Overlap too short ({len(common)} months)'
        return result

    b = br.loc[common].values
    n = nr.loc[common].values
    mask = np.isfinite(b) & np.isfinite(n)
    b, n = b[mask], n[mask]
    if len(b) < 12:
        result['notes'] = f'Only {len(b)} valid months'
        return result

    dates = common[mask]
    result['overlap_start']  = str(dates[0].date())
    result['overlap_end']    = str(dates[-1].date())
    result['overlap_months'] = len(b)

    r, p_r = stats.pearsonr(b, n)
    result.update(pearson_r=round(r,4), pearson_r2=round(r**2,4), pearson_p=round(p_r,6))

    r_lo, r_hi, _ = bootstrap_ci(b, n, lambda x,y: stats.pearsonr(x,y)[0])
    result.update(pearson_ci_lo=round(r_lo,4), pearson_ci_hi=round(r_hi,4))

    rho, p_rho = stats.spearmanr(b, n)
    result.update(spearman_rho=round(rho,4), spearman_p=round(p_rho,6))
    rho_lo, rho_hi, _ = bootstrap_ci(b, n, lambda x,y: stats.spearmanr(x,y)[0])
    result.update(spearman_ci_lo=round(rho_lo,4), spearman_ci_hi=round(rho_hi,4))

    diff = np.abs(b - n)
    result.update(
        mean_bse_return=round(np.mean(b)*100,4),
        mean_nifty_return=round(np.mean(n)*100,4),
        std_bse_return=round(np.std(b)*100,4),
        std_nifty_return=round(np.std(n)*100,4),
        mean_abs_diff=round(np.mean(diff)*100,4),
        max_abs_diff=round(np.max(diff)*100,4),
    )

    # Scatter plot
    safe = bse_label.replace(' ','_').replace('/','_')
    fig, ax = plt.subplots(figsize=(7,6))
    ax.scatter(n*100, b*100, alpha=0.55, s=28, color='#2563EB',
               edgecolors='white', linewidths=0.4)
    sl, ic = np.polyfit(n, b, 1)
    xl = np.linspace(n.min(), n.max(), 200)
    ax.plot(xl*100, (sl*xl+ic)*100, color='#DC2626', lw=1.6, ls='--', label='OLS fit')
    lims = [min(n.min(),b.min())*100, max(n.max(),b.max())*100]
    ax.plot(lims, lims, color='#6B7280', lw=1, ls=':', label='y=x (perfect proxy)')
    ax.set_xlabel(f'Nifty TRI Monthly Return (%)\n{nifty_label}', fontsize=11)
    bse_type = 'Price (Yahoo Finance)' if 'yf_price' in data_note else 'TRI'
    ax.set_ylabel(f'BSE {bse_type} Monthly Return (%)\n{bse_label}', fontsize=10)
    ax.set_title(
        f'BSE {bse_type} vs Nifty TRI — Monthly Returns\n'
        f'r={r:.3f} [95% CI: {r_lo:.3f}, {r_hi:.3f}]  rho={rho:.3f}  n={len(b)} months',
        fontsize=10, pad=12)
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.25)
    note = '* BSE side = Price Index (not TRI). Dividend bias ~1-2%/yr.' if 'yf_price' in data_note else ''
    if note:
        fig.text(0.5, -0.02, note, ha='center', fontsize=8, color='#6B7280',
                 style='italic')
    plt.tight_layout()
    fig.savefig(FIG_DIR / f'scatter_{safe}.png', dpi=150, bbox_inches='tight')
    plt.close(fig)

    return result


def main():
    print('\n╔══════════════════════════════════════════════════════════════╗')
    print('║  Phase 0.4–0.7 — True Independent BSE vs Nifty Comparison    ║')
    print('╚══════════════════════════════════════════════════════════════╝\n')

    print('  Loading tri-data.json ...')
    tri_map = load_tri_json()
    print(f'  Loaded {len(tri_map)} series\n')

    print('  Loading BSE Price data (Yahoo Finance) ...')
    bse_yf = load_bse_price()
    print(f'  Loaded: {list(bse_yf.columns)}\n')

    all_results = []

    # ── Analysis 1: Yahoo Finance BSE Price vs Nifty TRI ─────────────────────
    print('  ═══ Part A: Yahoo Finance BSE Price vs Nifty TRI ═══')
    print('  (Independent data — true proxy error measurement)')
    print('  Note: BSE side is Price Index (not TRI). Dividend bias ~1-2%/yr.\n')

    for bse_name, nifty_name in YF_TO_NIFTY.items():
        print(f'  ▸ {bse_name} (YF Price)  ↔  {nifty_name} (Nifty TRI)')
        if bse_name not in bse_yf.columns:
            print(f'    ⚠  Not in Yahoo Finance data')
            continue
        if nifty_name not in tri_map:
            print(f'    ⚠  {nifty_name} not in tri-data.json')
            continue

        result = run_pair(
            bse_yf[bse_name].dropna(),
            tri_map[nifty_name],
            bse_name, nifty_name,
            'yf_price_vs_nifty_tri'
        )
        if result.get('notes'):
            print(f'    ⚠  {result["notes"]}')
        else:
            print(f'    ✓  n={result["overlap_months"]} mo  '
                  f'r={result["pearson_r"]} [CI: {result["pearson_ci_lo"]}, {result["pearson_ci_hi"]}]  '
                  f'rho={result["spearman_rho"]}')
        all_results.append(result)

    # ── Analysis 2: BSE Power TRI (real BSE data, short window) ──────────────
    print('\n  ═══ Part B: Non-Equivalent / Short-Window Pairs ═══')
    print('  (BSE Power = likely real BSE data, 17 months only)\n')

    for bse_name, (nifty_name, note) in BSE_SHORT_PAIRS.items():
        print(f'  ▸ {bse_name}  ↔  {nifty_name}  [{note}]')
        if bse_name not in tri_map or nifty_name not in tri_map:
            print(f'    ⚠  Series not found in tri-data.json')
            continue
        result = run_pair(tri_map[bse_name], tri_map[nifty_name],
                          bse_name, nifty_name, note)
        if result.get('notes'):
            print(f'    ⚠  {result["notes"]}')
        else:
            print(f'    ✓  n={result["overlap_months"]} mo  '
                  f'r={result["pearson_r"]} [CI: {result["pearson_ci_lo"]}, {result["pearson_ci_hi"]}]  '
                  f'rho={result["spearman_rho"]}')
        all_results.append(result)

    # ── Write outputs ─────────────────────────────────────────────────────────
    df = pd.DataFrame(all_results)
    df.to_csv(OUT_DIR / 'correlation_results.csv', index=False)
    print(f'\n  ✅ Written: {OUT_DIR}/correlation_results.csv')

    overlap_cols = ['bse_index','nifty_proxy','data_note','overlap_start',
                    'overlap_end','overlap_months','notes']
    df[overlap_cols].to_csv(OUT_DIR / 'overlap_matrix.csv', index=False)
    print(f'  ✅ Written: {OUT_DIR}/overlap_matrix.csv')

    boot_cols = ['bse_index','nifty_proxy','data_note','overlap_months',
                 'pearson_r','pearson_ci_lo','pearson_ci_hi',
                 'spearman_rho','spearman_ci_lo','spearman_ci_hi']
    valid = df.dropna(subset=['pearson_r'])
    valid[boot_cols].to_csv(OUT_DIR / 'bootstrap_cis.csv', index=False)
    print(f'  ✅ Written: {OUT_DIR}/bootstrap_cis.csv')

    # ── Summary ───────────────────────────────────────────────────────────────
    if len(valid) > 0:
        print(f'\n  ══ Results Summary ══════════════════════════════════════')
        print(f'  Valid pairs   : {len(valid)} / {len(df)}')
        for _, row in valid.iterrows():
            print(f'  {row["bse_index"]:<38} r={row["pearson_r"]:.3f}'
                  f' [CI:{row["pearson_ci_lo"]:.3f},{row["pearson_ci_hi"]:.3f}]'
                  f'  rho={row["spearman_rho"]:.3f}'
                  f'  n={row["overlap_months"]}mo')
        yf = valid[valid['data_note'] == 'yf_price_vs_nifty_tri']
        if len(yf) > 0:
            print(f'\n  [Part A — Independent BSE Price vs Nifty TRI]')
            print(f'  Pearson r   range: {yf["pearson_r"].min():.3f} – {yf["pearson_r"].max():.3f}')
            print(f'  Spearman rho range: {yf["spearman_rho"].min():.3f} – {yf["spearman_rho"].max():.3f}')
            print(f'  Mean |monthly return diff|: {yf["mean_abs_diff"].median():.3f}%')
        print(f'\n  Figures: {FIG_DIR}/')

    print('\n  Phase 0.4–0.7 complete.\n')


if __name__ == '__main__':
    main()
