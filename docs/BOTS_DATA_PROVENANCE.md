# Performance evidence and economic truth

## Evidence classes

LIVE_BROKER_DATA, LIVE_SMALL, PAPER, SHADOW, UNTOUCHED_OOS, BACKTEST, HISTORICAL_SIMULATION, DEMO_DATA and RESEARCH are explicit labels. RESEARCH means there is no performance record. A successful broker authentication proves connectivity at a point in time, not returns or strategy validation.

Every populated performance section must identify source, environment, as_of, strategy version and quality. The Track Record & Data panel also identifies the sample and accounting inclusions. We do not use a generic VERIFIED badge.

## Current publication

No customer performance feed exists. Published THETA metrics, capital minimum, risk rating, provider freshness, regime, model calibration and independent N are unavailable. PAPER identifies the configured environment, not an assertion of a running bot or a paper track record.

Demo mode requires an explicit URL selection and displays a persistent banner. Scenario calculation output is always labeled DEMO DATA. No demo data is silently used as an API fallback. Network failure shows an error rather than replacing missing records with an illustration.

## Economic convention

Whole-chain economic P&L equals option realized plus option unrealized plus stock realized plus stock unrealized plus dividends minus economic costs. Slippage already embedded in actual fill prices must not be subtracted a second time. Illustrations use explicitly supplied total modeled costs.

Rolls retain old realized losses. Assigned stock remains unresolved exposure. A high option-leg win rate is not the primary economic measure. Economic breakeven is labeled separately from broker acquisition or tax basis.

## Deterministic illustration reconciliation

Starting equity is $100,000. Five synthetic resolved episodes have three wins totaling $16,500 and two losses totaling $10,630, so resolved after-cost P&L is $5,870, Managed Episode WR is 60% and profit factor is 16,500 / 10,630.

The illustrated open chain contributes $580 in realized premium less costs and -$2,500 in stock MTM. Total realized P&L is $6,450, total economic P&L is $3,950 and final equity is $103,950. The single visible AAPL chain itself is negative $1,920.

The example does not show a complete event ledger for the five resolved episodes. Their aggregate is a deterministic illustration, not an imported historical record. Dated equity points demonstrate charts, but do not support rolling episode statistics or independent samples. Those statistics remain unavailable.

The open chain's capital-days label explicitly covers the 24-day stock holding interval, August 7 to August 31. It is $18,000 times 24, or $432,000-days. It does not claim to include the prior CSP collateral interval.

Unit tests reconcile equity and attribution, preserve stock losses and verify the drawdown calculation. None of these examples is evidence of expected profitability.
