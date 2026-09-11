# THETA EV Model Specification (R6)

> 2026-09-11 correctness update: this document's original implementation
> claims below are historical and superseded by the current
> [formula catalog](THETA_FORMULA_CATALOG.md) and
> [gap matrix](THETA_GITHUB_GAP_MATRIX.md). Features are not universally
> available merely because contracts exist. The blocker includes input
> coverage, labels, costs and lifecycle reconciliation. Ledger v2 now
> returns null for unknown open-option MTM, unknown stock marks or missing
> dividend lots. A flagged numeric partial total was not a valid complete
> target. Provenance-aware option valuation, basis/premium and fee allocation,
> ex-date dividend entitlement, and capital-day joins remain prerequisites.
> No calibrated full-H model or new profitability evidence is claimed.

Per the explicit directive: this is the empirical framework spec for
`EV_net`/`ReturnPerCapitalDay`, not an invented model. It builds on
existing, frozen canonical specs rather than re-deriving them —
`docs/quant/phase2/FORMULA_REGISTRY.md` (EV_net's formula contract),
`docs/quant/phase2/DATASET_AND_LABEL_CONTRACT.md` (point-in-time row
contract, per-decision-type labels, leakage guards, walk-forward
discipline), and `docs/quant/phase2/MODEL_REGISTRY.md` (the calibrated
entry-outcome model's existing "Challenger" promotion/failure criteria)
are all pre-existing, frozen sources this document defers to rather than
contradicts. This document's job is narrower: (1) name the exact target
variable construction, (2) state honestly what is and is not
empirically ready today, and (3) fold in what the GitHub research corpus
actually offers toward closing that gap.

## 1. Status: EV_MODEL_NOT_EMPIRICALLY_READY

Per item 12's explicit instruction: do not fabricate calibration. Stated
plainly and specifically:

- **Missing datasets:** no historical, point-in-time-correct options
  chain dataset (bid/ask/Greeks/OI/volume by strike/expiration/date) is
  present anywhere in this repository or its providers' currently-wired
  history endpoints. Alpaca's option-chain endpoints (as wired in
  `alpaca-provider.ts`) return CURRENT chain state only — there is no
  historical options-chain replay source connected. Optionomics is wired
  for current-cycle features only, not a historical archive.
- **Required sample:** per `DATASET_AND_LABEL_CONTRACT.md`'s own
  discipline (§5), TRD §50 requires 300+/500+ **independent** (not raw)
  resolved episodes before the empirical work can even approach the
  headline range discussion, and this document adds no lower threshold
  of its own — an EV model promoted on fewer than that has no basis for
  trust regardless of what its point estimate says.
- **Feature availability:** contracts exist for ownership, regime,
  strike/DTE/delta, spread, OI/volume, events and AEGIS. Each decision still
  requires verified availability, freshness and provenance. A defined
  field does not prove the provider supplied it. Labels are an additional
  blocker, not the only one.
- **Target construction:** fully specified below (§2) and already
  partially implemented in code (`ledger-contract.ts`'s
  `computeWholeChainPnl`). Complete option MTM, entitlement/basis/cost
  reconciliation and durable lifecycle joins still need implementation
  before this calculation can supply a complete training target.
- **Validation protocol:** fully specified in
  `DATASET_AND_LABEL_CONTRACT.md` §5 and `THETA_WALK_FORWARD_SPEC.md`
  (this pass) — not missing, just has nothing to run against yet.
- **Minimum evidence for promotion:** already specified in
  `MODEL_REGISTRY.md`'s calibrated-entry-outcome-model entry: "untouched-
  OOS EV_net improvement over v0 with an interval excluding zero, no
  DD/ES regression, calibration acceptable, effect survives" — this
  document does not relax or restate that bar, it defers to it.

**Conclusion:** the correct action today is exactly what item 12
prescribes — report this status, keep `ev_net`/`returnPerCapitalDay`
honestly `None`/`null` everywhere (already true throughout
`theta_q_baseline.py`, `pareto_frontier.py`, and
`cross-symbol-economic-frontier.ts`'s `RESEARCH_RANKING_ONLY` disposition
added this session), and do NOT fill it with a heuristic. No code in
this repository currently violates this — it is stated here as an
explicit, checkable status rather than an implicit assumption.

## 2. The target variable: Y = net lifecycle economic P&L

Per item 6's explicit instruction: the target must be a lifecycle-aware
outcome, never premium received alone. THETA already has BOTH halves of
this specified/implemented, independently arrived at by two different
subsystems that agree with each other:

- **Formula-level definition:** `DATASET_AND_LABEL_CONTRACT.md`'s
  per-decision-type label definitions (ENTRY = "managed-episode
  after-cost outcome under the fixed strategy/model/cost version active
  at entry decision time... never simple expiry ITM/OTM"; ASSIGNMENT =
  "the assignment event plus its full post-assignment downside/recovery
  path"; ROLL = "incremental value... `RollUtility`, not
  `NetRollCredit`"; CC = "after-cost stock+call utility... `CCUtility`,
  including `CallAwayRegret`").
- **Already-implemented, already-tested computation:**
  `src/theta/ledger-contract.ts`'s `computeWholeChainPnl(legs, lots,
  dividends, fees)`:

  ```
  WholeChainPnl = RealizedStockPnl + UnrealizedStockPnl
                + RealizedOptionPnl + UnrealizedOptionPnl
                + Dividends - Fees
  # v2: unavailable open-option MTM, stock mark or dividend lot => null total
  ```

  This is not a proposal — it is real, tested code
  (`tests/ledger-contract.test.ts`, confirmed present and passing)
  computing exactly the lifecycle-aware quantity item 6 asks for: entry premium (embedded in each
  `OptionLeg.entryCreditDebit`/`realizedPnl`), close debit/credit and
  rolls (via `rolledFromOptionLegId`/`rolledToOptionLegId` linkage,
  preserving each leg's own immutable realized P&L rather than netting
  a roll into one blended number — matching the ROLL label's own
  `RollUtility`-not-`NetRollCredit` discipline), assignment stock basis
  (`StockLot.economicBasisPerShare`, `assignmentOptionLegId` linkage),
  stock mark/recovery (`currentPricePerShare` for open-lot unrealized
  MTM), covered-call premium and call-away economics (a call-away is
  itself an `OptionLeg` closure with `closeReason: 'ASSIGNED'` or
  `'EXERCISED'`, folding its premium and the stock lot's disposal into
  the same whole-chain sum), capital used (implicit in `StockLot.shares
  * economicBasisPerShare` and `OptionLeg` collateral, both already
  tracked upstream in `account-exposure.ts`), and fees.

- **What is explicitly NOT yet in this formula, named rather than
  silently assumed:** commission/modeled-slippage are not currently a
  distinct line item — `computeWholeChainPnl`'s own docstring states
  "slippage is folded into fees here... a future execution-quality
  integration may split slippage out separately." Capital-days (the
  denominator for `ReturnPerCapitalDay`) is a separate quantity, already
  computed in `new-risk-orchestrator.ts` (`capitalDays = capitalRequirement
  * dte`) but not yet joined to `computeWholeChainPnl`'s output into one
  combined per-episode row — this join is real, un-invented remaining
  work, not a conceptual gap.

**Y, precisely, per resolved (or dataset-cutoff-censored) episode:**

```
Y = WholeChainPnl(legs, lots, dividends, fees)          # already implemented
CapitalDays = sum over each capital-committed interval of
              (capital_committed_that_interval * days_in_interval)   # needs the join above
ReturnPerCapitalDay = Y / CapitalDays                    # only defined once CapitalDays > 0
```

An **open** (unresolved) episode at dataset cutoff contributes NO label
yet — per `DATASET_AND_LABEL_CONTRACT.md`'s leakage guard, it is censored,
never back-filled from information only available after cutoff.

## 3. What the GitHub corpus contributes to closing this gap

Per item 5/11: research existing implementations, extract methods, never
copy performance claims. Classified per repo (see
`GITHUB_REPO_RESEARCH_LEDGER.md` for full entries):

| Technique | Source | Classification | What it contributes |
|---|---|---|---|
| Vectorized multi-leg join + 4-model slippage (mid/spread/liquidity/per-leg) | `goldspanlabs/optopsy` (AGPL-3.0) | `ADOPT_METHOD` (architecture only, never source — license) | A concrete, testable pattern for turning a historical option-chain replay into per-episode P&L rows at scale, once real historical chain data exists. Directly informs how a future `Y` computation would be produced in bulk from raw historical quotes rather than only from THETA's own live-recorded ledger. |
| Composable engine (data provider / strategy / execution / portfolio / risk / analytics) with pluggable `FillModel`/`TransactionCostModel`/`PositionSizer`/`SignalSelector` | `lambdaclass/options_portfolio_backtester` (MIT) | `ADOPT_METHOD` | Clean separation of concerns for a future THETA backtest engine (R6) — directly parallels this repo's own contract/orchestrator separation discipline (Python model / TS contract / TS orchestrator), so adopting an analogous shape is low-friction. `HedgeFillWarning` (a named, explicit warning when a strategy's assumed strike/DTE band silently finds nothing tradeable in a given historical era) is a concrete, citable pattern for THETA's own universe-discovery point-in-time-optionability discipline — worth adding an equivalent warning/reason-code once real historical chain replay exists. |
| Rust-backed daily convexity/tail-hedge scoring (`convexity_ratio`, deep-OTM put overlay) | `lambdaclass/options_portfolio_backtester`'s `convexity/` module (MIT) | `REFERENCE_ONLY` | A different strategy family (buying tail protection, not selling premium) — not directly reusable for THETA's wheel-style Y construction, but its existence confirms tail-risk/convexity scoring at scale is a solved subproblem worth revisiting if THETA ever needs a tail-hedge overlay. |
| BSM-gamma-based GEX, sign convention, gamma flip/walls | `FlashAlpha-lab/gex-explained` (MIT) | `ADOPT_METHOD` (formula only, pending cross-check + ablation) | Not a direct input to `Y` itself, but a candidate FEATURE for a future calibrated model (see `THETA_FEATURE_TARGET_MATRIX.md`) — research-only until an ablation proves incremental EV_net improvement, per the standing Cboe-style discipline. |
| `N(d2)` used as a real win probability; raw full Kelly | `ksanjay/Kelly-Criterion-Option-Selector` (MIT) | `REJECT` | Negative-example evidence that a risk-neutral pricing quantity must never be piped into `EV_net`/a win-rate claim without a genuine calibration step — directly reinforces `FORMULA_REGISTRY.md`'s own "an uncalibrated model's output must not be piped into EV_net and reported as if it were" rule. |
| Half-Kelly-only usage, notional-cap consistency | `HasibVortex369/riskkit` (MIT) | `TEST_ONLY` (already verified this session, `test_sizing.py::CapConsistencyTests`) | Confirms THETA's non-Kelly sizing discipline is already sound; no direct EV-model contribution. |

**QuantLib and QuantConnect/LEAN (Tier-0 references, requested this
session):** not yet deep-file-inspected as of this document (see
`GITHUB_REPO_RESEARCH_LEDGER.md`'s open-items list) — both are large,
mature codebases where a narrow, targeted read (specifically: LEAN's
options-chain/security-state/portfolio-accounting/backtest-live-parity
modules, and QuantLib's calendar/day-count/American-exercise pricing
utilities) is a follow-up task rather than a fully-completed input to
this spec. Flagged honestly rather than padded with unverified claims;
see the Gap Matrix's own follow-up list.

## 4. Feature/target relationship

See the companion `THETA_FEATURE_TARGET_MATRIX.md` for the full X/Y table
(what is known at decision time, mapped against the resolved-episode
label). This document only fixes Y itself.

## 5. What promotion requires (restated, not redefined)

Exactly `MODEL_REGISTRY.md`'s existing calibrated-entry-outcome-model
entry: untouched-OOS `EV_net` improvement over the v0 (`ev_net=None`)
baseline with a confidence interval excluding zero, no drawdown/expected-
shortfall regression, acceptable calibration (Brier/log-loss/reliability
by regime/DTE/delta/ticker-family cohort per `MODEL_REGISTRY.md`'s
management-model entry, applied analogously here), and the effect
surviving clustered/regime-block resampling (per
`DATASET_AND_LABEL_CONTRACT.md` §5). This document adds no new promotion
criterion and relaxes none of the existing ones.
