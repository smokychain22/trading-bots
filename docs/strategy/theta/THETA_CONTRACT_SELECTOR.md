# Contract selector

The selector enumerates every available underlying, expiration, and strike inside the active branch lattice. It stores identity, multiplier, strike, expiration, DTE, moneyness, BBO, spread, quote age, OI and volume where available, Greeks, volatility context, credit, secured collateral, break-even, capital days, assignment implications, events, ownership, and execution state.

The conventional research lattice is 25 to 60 DTE with delta buckets from 0.10 to 0.40. These are candidate-generation regions, not evidence of profitability. Delta does not represent realized win probability. Hold Strike is a separate 2 to 5 DTE challenger. Defined risk remains research-only.

Alpaca multiplier metadata is required. Missing multiplier or executable BBO makes the contract non-executable. Midpoint is reference data only.
