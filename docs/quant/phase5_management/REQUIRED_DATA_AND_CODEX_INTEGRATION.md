# Required Historical Data/Features and Codex Integration Requirements (Phase 5)

## Required historical features/data (item 11)

All required feature families are already registered in `research/data/
feature_families.json` — this pass introduces no new feature family, since every
input named in this task's management-hypothesis set (premium capture, remaining
premium, DTE, delta/moneyness, underlying drawdown, IV/RV change, skew/term changes,
earnings/event proximity, liquidity, spread, assignment likelihood, ownership
acceptability, severe-DD probability, recovery distribution, portfolio concentration,
capital-days, execution utility) maps directly onto an existing entry:
`premium_capture`, `dte`, `delta`/`log_moneyness`, `drawdown`, `rv10`/`rv20`/`rv60`,
`skew_slope`/`term_slope`, `earnings_distance`/`ex_div_distance`, `open_interest`/
`volume`, `spread_pct`, `ownership_acceptability`, `p_severe_drawdown`,
`recovery_median`, `portfolio_concentration`, `capital_days`, `fill_probability`. One
addition worth naming: **IV change and RV change as first-differenced series** (not
just level values) are not separately registered — `contract_iv`/`rv10`/`rv20`/`rv60`
exist as levels; a management model conditioning on *change* in vol (e.g. a vol spike
since entry) would need a derived first-difference feature not yet in the registry.
**Recommendation:** add `iv_change_since_entry`/`rv_change_since_entry` derived feature
IDs to `feature_families.json` before the management competing-risk model is actually
built — not added in this pass, to avoid modifying that canonical file beyond what's
strictly needed for this specification pass.

Data-availability status for all of the above is unchanged from `feature_families.json`
— most are `UNCERTAIN_PENDING_ALPACA_ENTITLEMENT` (contract-level greeks/IV) or
`USABLE_NOW_ALPACA_HISTORICAL` (underlying price-derived series), consistent with
`docs/DATA_READINESS_ASSESSMENT.md`.

## Codex future integration requirements (item 12)

None of this Phase 5 pass's specifications require any Codex action right now — it is
pure quant-side specification, consistent with `docs/OWNERSHIP.md`'s split. For
visibility into what a *future* implementation phase would need from Codex, once
Phase 6 (backtester) exists and any of these models graduate past specification:

- The management competing-risk/hazard model and roll evaluator would need to consume
  the same point-in-time snapshot contract already specified in
  `../phase2/DATASET_AND_LABEL_CONTRACT.md` — no new contract shape is introduced.
- If `iv_change_since_entry`/`rv_change_since_entry` are added to
  `feature_families.json` (recommended above), Codex's Optionomics/Alpaca feature
  pipeline would need to persist entry-time snapshots of `contract_iv`/`rv*` alongside
  current values so the first-difference can be computed without look-ahead — this is
  a data-retention requirement, not a new provider capability.
- No change to provider ownership (Alpaca/Optionomics only), lifecycle states, risk
  semantics, or any frozen architecture is proposed anywhere in this Phase 5 package.

## Status

No Codex action requested or required by this pass. One recommended (not yet made)
addition to `feature_families.json`, flagged for a future session.
