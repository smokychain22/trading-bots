# THETA R7 risk-evidence audit, 2026-09-20

## Boundary

This audit covers the remaining new-risk evidence required before a natural
Alpaca Paper canary. It does not authorize an order, change strategy
thresholds, promote a model, unlock followers, or enable live money.

## Severe-drawdown policy result

`SEVERE_DRAWDOWN_LABEL_POLICY_MISSING`

The repository contains one canonical label contract in
`bots/theta/quant/models/severe_drawdown_spec.py`. It requires an explicit
`spec_version`, `horizon_days`, `threshold_family`, and `threshold_value`.
Only `PERCENT_FROM_ENTRY` is implemented. The registry describes the target
and the required validation path, but it does not approve a Paper or
Production horizon and threshold.

The repository search covered:

- `docs/quant/phase2/MODEL_REGISTRY.md`
- `docs/quant/phase2/FORMULA_REGISTRY.md`
- `bots/theta/quant/models/severe_drawdown_spec.py`
- quant hypotheses, experiments, risk policy, tests, and runtime callers

The 20-day and 10-percent values in synthetic unit tests are fixtures, not
an approved policy. They cannot be reused as runtime authority. Therefore no
dataset labels were generated, no model was trained, no artifact was
promoted, and `severeDrawdownProbability` remains UNKNOWN in real candidate
construction.

## Truth defects corrected

- Missing one-day return evidence now yields `stressGapDetected = null`.
  Python AEGIS preserves this and holds new risk through its SYSTEM family.
- Missing spread-widening evidence now also holds the LIQUIDITY family rather
  than reporting `LIQUIDITY_OK`.
- Missing or malformed broker position quantity remains UNKNOWN. It cannot be
  converted to zero during assignment, expiration, recovery, or covered-call
  evaluation.
- A broker stock row with unknown quantity keeps Recovery and Covered Call
  branches visible for evidence collection, but both stay blocked. It cannot
  establish covered shares or authorize a covered call.
- Covered-call `wholeChainPnlAtCallAway` stays UNKNOWN when premium is UNKNOWN.

## Producer status

| Evidence family | Status | Exact blocker or bounded result |
| --- | --- | --- |
| Severe drawdown | BLOCKED_POLICY_MISSING | Approved label horizon and threshold do not exist |
| Stress gap | REAL_PIT_DERIVATION | Uses known `ret1d`; missing history is UNKNOWN |
| Correlation | PARTIAL | The single-risky-underlying case is mathematically derived. Multi-underlying clustering still needs a versioned lookback and clustering policy |
| Sector | BLOCKED_SOURCE_AND_POLICY | No authoritative versioned taxonomy is wired for multi-underlying portfolios |
| Events | PARTIAL_PROVIDER_OBSERVATION | Optionomics event context is persisted with provenance, but verified event/no-event semantics are not yet a canonical AEGIS producer |
| IV shock | UNKNOWN_INSUFFICIENT_BASELINE | Current IV alone cannot prove a shock. A versioned PIT baseline is absent |
| Spread widening | UNKNOWN_INSUFFICIENT_BASELINE | Current spread quality exists, but a versioned historical BBO baseline is absent |

## Consequences

- September 18 model-dependent replay is not valid until the label policy and
  a reviewed model artifact exist.
- A real-provider no-order trace can continue to collect evidence, but it must
  report severe drawdown, IV-shock, spread-widening, and multi-underlying
  sector/correlation evidence as UNKNOWN where applicable.
- The current worker remains fail-closed for new risk. Management and exit
  authority remain available.

## Required external decision

Quantitative review must approve and version the severe-drawdown label horizon
and threshold before training begins. That review must precede any model
promotion or use as Paper risk authority.

## Safety state

- `MASTER_PAPER_ORDERS = 0`
- `FOLLOWER_PAPER_ORDERS = 0`
- `LIVE_ORDERS = 0`
- `FOLLOWER_EXECUTION = LOCKED`
- `LIVE_MONEY_AUTHORIZED = NO`
- `FORCED_TRADE = NO`
