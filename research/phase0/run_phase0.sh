#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_phase0.sh
# Executes all Phase 0 steps in sequence.
# Run from project root: bash research/phase0/run_phase0.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")/../.."   # project root = "MF kj"

echo ""
echo "======================================================"
echo "  NAT_FUNDS — Phase 0: Data Strengthening"
echo "======================================================"
echo ""

# Pre-flight
echo "  Checking prerequisites..."

if ! command -v python3 &>/dev/null; then
  echo "  ERROR: python3 not found."; exit 1
fi
if ! command -v node &>/dev/null; then
  echo "  ERROR: node not found. Install Node.js 18+."; exit 1
fi

echo "  Installing/verifying Python packages..."
pip3 install --quiet pandas numpy scipy matplotlib seaborn yfinance

if [ ! -f "data/tri-data.json" ]; then
  echo "  ERROR: data/tri-data.json not found."
  echo "  Run 'npm start' once to populate Nifty TRI cache, then re-run."
  exit 1
fi

echo "  Prerequisites OK"
echo ""

# Step 0.1 + 0.2 — BSE Price data via Yahoo Finance
echo "------------------------------------------------------"
echo "  Steps 0.1/0.2 — BSE Price Index (Yahoo Finance)"
echo "  NOTE: BSE TRI API is CSRF-protected / not publicly"
echo "  accessible. Collecting BSE Price Index as fallback."
echo "  This inaccessibility is a key finding of the paper."
echo "------------------------------------------------------"
python3 research/phase0/collect_bse_tri.py

# Step 0.3 — Nifty Price Index
echo "------------------------------------------------------"
echo "  Step 0.3 — Nifty Price Return Index (NSE API)"
echo "------------------------------------------------------"
node research/phase0/collect_nifty_price.js

# Steps 0.4-0.7 — Correlation analysis + bootstrap CIs
echo "------------------------------------------------------"
echo "  Steps 0.4-0.7 — Pearson / Spearman / Bootstrap CIs"
echo "------------------------------------------------------"
python3 research/phase0/analyze_correlations.py

echo ""
echo "======================================================"
echo "  Phase 0 Complete. Key outputs:"
echo "    research/phase0/data/bse_price_raw.csv"
echo "    research/phase0/data/nifty_tri_index.csv"
echo "    research/phase0/data/availability_log.txt"
echo "    research/phase0/outputs/overlap_matrix.csv"
echo "    research/phase0/outputs/correlation_results.csv"
echo "    research/phase0/outputs/bootstrap_cis.csv"
echo "    research/phase0/outputs/figures/"
echo "======================================================"
echo ""
