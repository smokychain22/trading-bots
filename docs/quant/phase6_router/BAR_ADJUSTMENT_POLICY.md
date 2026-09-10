# Stock-Bar Adjustment Policy

Alpaca's historical stock-bars endpoint supports `adjustment` values `raw`,
`split`, `dividend`, and `all`. This document fixes which adjustment THETA
uses for which purpose, so ownership/regime feature computation never
accidentally mixes adjusted and unadjusted series, and never mixes a
historical adjusted series with a current unadjusted executable price.

## Canonical policy (v1)

- **Ownership/regime economic features computed from historical bars**
  (returns, realized volatility, drawdown, gap statistics, trend) use
  **`adjustment=split`**. Splits create a discontinuity in raw price that has
  nothing to do with economic return; failing to adjust for a split would
  read a 2:1 split as a -50% single-day return. Dividend adjustment is
  deliberately NOT used for these features in v1: a dividend-adjusted series
  restates historical closes to reflect a hypothetical reinvestment, which
  is a different (and, for THETA's assignment-aware ownership question,
  less relevant) economic question than "did this underlying's tradable
  price move sharply." Revisit if a specific feature is later shown to need
  dividend adjustment.
- **The current, decision-time executable price** (bid/ask used for
  break-even, collateral, and execution-quality assessment) is ALWAYS the
  provider's current unadjusted market quote — adjustment concepts apply
  only to historical bars, never to a live quote, and this must never be
  conflated.
- A single feature computation must draw from ONE bars series with ONE
  adjustment value — never join a `raw` fetch with a `split` fetch for the
  same underlying/timeframe.

## Enforcement

`src/theta/alpaca-provider.ts`'s `FetchStockBarsParams.adjustment` is a
required, explicit field (`'raw' | 'split' | 'dividend' | 'all'`) — there is
no default, so a caller cannot silently omit the choice. Ownership/regime
feature builders that consume `HistoricalBar[]` should assert (or otherwise
verify) that all bars for one computation came from a single fetch call
using the v1 policy's `split` adjustment, rather than trusting a mixed input
silently.

## Status

v1 policy, versioned like every other THETA policy in this repo. Revisit via
the same ablation discipline as any other quant decision if a specific
feature is shown to need a different adjustment choice.
