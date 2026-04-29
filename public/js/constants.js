/**
 * js/constants.js
 * Static lookup tables — category metadata and metric tooltip text.
 * Loaded first so all other modules can reference these objects.
 */

// Category metadata for the sidebar, cards, and breadcrumbs
const CATEGORY_META = {
  Equity:   { icon: 'trending_up',       label: 'Equity',       tag: 'High Growth',      color: 'bg-secondary-container/30 text-secondary',                  desc: 'Stocks & high-yield market assets.' },
  Debt:     { icon: 'account_balance',   label: 'Debt',         tag: 'Stable',            color: 'bg-surface-container-high text-on-surface-variant',         desc: 'Bonds, gilts & corporate deposits.' },
  Hybrid:   { icon: 'pie_chart',         label: 'Hybrid',       tag: 'Balanced',          color: 'bg-surface-container-high text-on-surface-variant',         desc: 'Mixed risk-adjusted portfolios.' },
  Index:    { icon: 'list_alt',          label: 'Index Funds',  tag: 'Passive',           color: 'bg-surface-container-high text-on-surface-variant',         desc: 'Low-cost market tracking funds.' },
  ETF:      { icon: 'currency_exchange', label: 'ETFs',         tag: 'Exchange Traded',   color: 'bg-surface-container-high text-on-surface-variant',         desc: 'Exchange-traded market instruments.' },
  Solution: { icon: 'shield',            label: 'Solution',     tag: 'Goal Based',        color: 'bg-surface-container-high text-on-surface-variant',         desc: 'Retirement & children focused.' },
  Other:    { icon: 'browse_gallery',    label: 'Other',        tag: 'Specialized',       color: 'bg-surface-container-high text-on-surface-variant',         desc: 'Fund of funds & specialized.' },
};

// Tooltip content shown next to metric labels throughout the app
const METRIC_TOOLTIPS = {
  cagr1y:             'How much your ₹100 would have grown in 1 year, expressed as annual %.',
  cagr3y:             'Average yearly growth rate over the last 3 years — shows medium-term consistency.',
  cagr5y:             'Average yearly growth rate over the last 5 years — longer period, more reliable.',
  rollingReturn1y:    'Median CAGR across ALL possible 1-year periods (daily rolling). Shows consistency, not just start-to-end. Includes benchmark-beating stats.',
  rollingReturn3y:    'Return distribution across monthly-sampled 3-year periods. Each bar shows the realistic range of outcomes for an investor starting at any month. P10–P90 = 80% of all outcomes. P25–P75 = middle half. Dot = median.',
  sharpeRatio:        'Reward per unit of risk. Higher = better. Above 1.0 is good, above 2.0 is excellent.',
  sortinoRatio:       'Like Sharpe, but only penalises downside volatility (negative months). Higher = better. More meaningful than Sharpe for equity funds with asymmetric return distributions.',
  standardDeviation:  'How much returns swing up & down. Lower = more predictable. Think of it as volatility.',
  beta:               'Sensitivity to market. Beta=1 means moves exactly with market. <1 is less risky, >1 is more volatile.',
  ter:                'Annual fee deducted from your returns. Every 0.1% saved compounds significantly over decades.',
  aum:                'Total money managed by this fund (₹ Crores). Larger AUM generally means more investor trust.',
  nav:                'Net Asset Value — the current price of one unit of this mutual fund.',
  riskLevel:          'SEBI-mandated Riskometer fetched directly from AMFI\'s Fund Performance portal (riskometerScheme field). Not calculated — this is the official regulator-assigned risk label updated daily by the fund house.',
  maxDrawdown:        'Worst peak-to-trough NAV decline in fund history, with recovery date. E.g. −38% means the fund fell 38% from its highest point before recovering. The most important risk metric for retail investors.',
  jensensAlpha:       'Excess return above what market risk (Beta) predicts. Positive = manager added value beyond market exposure. Negative on an active fund = underperformance for the risk taken. Uses CAPM: Alpha = Fund Return − [Rf + Beta × (Benchmark − Rf)].',
  upsideCapture:      '% of benchmark gains captured in up-market months. >100 means the fund outperformed the benchmark during rallies.',
  downsideCapture:    '% of benchmark losses suffered in down-market months. <100 means better crash protection than the benchmark. Ideal: Upside Capture > 100, Downside Capture < 100.',
  calmarRatio:        '3Y CAGR divided by Maximum Drawdown magnitude. Higher = better risk-adjusted returns. A fund with 12% CAGR and 20% drawdown (Calmar 0.60) is superior to 14% CAGR with 35% drawdown (Calmar 0.40).',
  informationRatio:   'Consistency of benchmark outperformance per unit of active risk (tracking error). IR > 0.5 is good; > 1.0 is exceptional. Key metric for evaluating if an active fund justifies its higher expense ratio.',
  consistencyScore:   'Composite quality score 1–10 aggregating rolling return consistency, downside protection, Sortino ratio, and expense efficiency. Scored only against funds in the same sub-category — a Liquid Fund\'s score is never compared to a Large Cap fund.',
};
