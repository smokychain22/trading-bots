# THETA Formula Registry

Durability artifact — persists the Phase 2 formula contract that previously existed
only as conversational output. All formulas below are drawn from TRD v1.1 FINAL
Appendix A unless marked "not in Appendix A" (a small number of composite utilities the
TRD names but does not give a closed-form for; those are marked TEST, not RETAIN, since
the exact combination is a research choice, not a frozen requirement). No formula here
has ever been evaluated against real data — this file registers definitions, never
results.

For each formula: purpose, inputs, units, output, assumptions, where usable, where
prohibited, edge cases, missing-data behavior, double-counting risk, validation method.

---

## EV_net

- **Purpose:** After-cost expected value of a candidate or episode — the primary
  economic quantity THETA ranks by, never Leg WR.
- **Inputs:** gross expected P&L path (from a calibrated outcome model or realized
  ledger), `cost_model_version`-tagged commission/fees/slippage.
- **Units:** currency (per contract or per episode, stated explicitly at each call site).
- **Output:** a single signed number, or `UNKNOWN` if the underlying probability model
  is not calibrated/available (never a fabricated placeholder — see
  `theta_q_baseline.py`'s `_economics`, which returns `ev_net=None` with an explicit
  `ev_net_unknown_reason` rather than inventing a number).
- **Assumptions:** costs are known and versioned; the probability model feeding it (if
  any) is calibrated (TRD MODEL-003) — an uncalibrated model's output must not be piped
  into `EV_net` and reported as if it were.
- **Where usable:** ranking candidates, comparing baseline vs. ablation variant,
  reporting alongside PF/DD/AvgWin/AvgLoss.
- **Where prohibited:** never as the sole metric; never computed from a backtest that
  used the final untouched OOS split to select the model/threshold producing it
  (ML-002).
- **Edge cases:** zero-quantity candidates have `EV_net` undefined/not applicable, not
  zero-by-convention.
- **Missing-data behavior:** `UNKNOWN`, propagated, never coerced to 0.
- **Double-counting risk:** costs must be applied exactly once per leg; a roll's
  close-leg and open-leg costs must not be netted into a single "roll cost" that then
  also gets subtracted again downstream.
- **Validation method:** untouched-OOS confirmation with an uncertainty interval that
  must not span zero improvement over baseline (shared_acceptance_criteria in
  `experiments.json`).

## PF_net (Profit Factor, after cost)

- **Purpose:** Sum of after-cost gains divided by sum of after-cost losses over a
  cohort — a payoff-shape metric independent of win rate.
- **Inputs:** the same after-cost per-episode P&L series `EV_net` is computed from.
- **Units:** dimensionless ratio.
- **Output:** a positive real number (or `UNKNOWN` if the underlying series is
  incomplete); values `<1` mean the cohort loses money after cost regardless of its WR.
- **Assumptions:** losses are summed as positive magnitudes in the denominator (sign
  convention must be fixed and documented at the call site to avoid a silent flip).
- **Where usable:** always reported alongside `EV_net`, WR, and DD — never as a
  standalone headline (a high PF with tiny N is not evidence).
- **Where prohibited:** never substituted for `EV_net` when ranking (PF ignores scale —
  a cohort of two trades can have an extreme PF).
- **Edge cases:** zero losses in the sample makes PF undefined (not infinite-by-default)
  — report `UNKNOWN` with the sample size that produced it.
- **Missing-data behavior:** `UNKNOWN`.
- **Double-counting risk:** same as `EV_net` — one cost application per leg.
- **Validation method:** reported alongside `EV_net`'s validation, never independently
  used to accept/reject a hypothesis.

## BreakEvenWR

- **Purpose:** The win rate at which a cohort's after-cost EV is exactly zero given its
  realized (or assumed) AvgWin/AvgLoss — used to sanity-check whether a claimed WR is
  economically meaningful, not just numerically high.
- **Inputs:** AvgWin, AvgLoss (after cost).
- **Formula:** `BreakEvenWR = AvgLoss / (AvgWin + AvgLoss)`.
- **Units:** dimensionless probability [0,1].
- **Output:** the WR threshold a strategy must clear to be EV-positive given its own
  payoff shape.
- **Assumptions:** AvgWin/AvgLoss are stable enough over the reporting window to be
  meaningful (if the payoff shape is itself drifting, this number drifts with it —
  report the window it was computed over).
- **Where usable:** context for any reported WR (e.g. "68% realized vs. 61%
  break-even" is a very different claim than "68% realized, break-even also 68%").
- **Where prohibited:** never presented as a target to hit — the objective is `EV_net`,
  not clearing this threshold by the smallest possible margin.
- **Edge cases:** `AvgWin=AvgLoss=0` is undefined.
- **Missing-data behavior:** `UNKNOWN` if either input is unavailable.
- **Double-counting risk:** none directly, but is corrupted if AvgWin/AvgLoss
  themselves double-count costs.
- **Validation method:** recomputed per regime/cohort, not once globally.

## EdgeBuffer

- **Purpose:** The margin between a cohort's realized WR and its `BreakEvenWR` — a
  single number expressing how much cushion exists before the strategy crosses into
  negative EV territory.
- **Formula:** `EdgeBuffer = RealizedWR - BreakEvenWR`.
- **Units:** probability-point difference.
- **Output:** signed number; negative means the cohort is EV-negative despite whatever
  its raw WR looks like.
- **Assumptions:** same as `BreakEvenWR`.
- **Where usable:** early-warning signal in drift monitoring — a shrinking `EdgeBuffer`
  over time is worth flagging even before it turns negative.
- **Where prohibited:** never used alone to promote/demote a strategy — always paired
  with sample size and DD.
- **Edge cases/missing-data/double-counting:** inherits `BreakEvenWR`'s.
- **Validation method:** tracked as a time series per cohort, not a single snapshot.

## ShortOptionCapture

- **Purpose:** Fraction of maximum possible premium actually captured on a closed short
  leg (accounts for early close/roll giving back time value vs. holding to expiry).
- **Formula:** `ShortOptionCapture = (EntryCredit - ExitDebit) / EntryCredit` (per
  contract, before the roll/close transaction cost is separately applied).
- **Units:** dimensionless [can exceed 1 only if `ExitDebit` is negative, i.e. paid to
  close for a net credit beyond entry — rare, flag for review].
- **Where usable:** management-quality diagnostic, feeding `RollUtility`/`CCUtility`
  inputs.
- **Where prohibited:** never treated as WR — capturing 90% of premium on a losing
  trade is still a loss if the underlying moved against the position enough.
- **Edge cases:** assignment/exercise (no explicit `ExitDebit`) requires the whole-chain
  accounting path instead — this formula applies to close/expire/roll-out legs only.
- **Missing-data:** `UNKNOWN` if either leg's price is unavailable.
- **Double-counting:** transaction cost is applied once, at the point of close, not
  folded into this ratio itself.
- **Validation:** compared across BR-1/BR-2/hold-to-cycle variants (H-R-01/H-R-02).

## WholeChainPnL

- **Purpose:** The mandatory companion metric to any WR claim (TRD OUT-001..004) —
  full economic P&L across an entire CSP→assignment→stock→CC→called-away chain,
  including unresolved open inventory at mark, so a high leg-level WR can never hide
  unrealized stock drawdown.
- **Inputs:** every realized leg's after-cost P&L in the chain, plus current mark-to-
  market on any still-open component (stock held, open CC, open CSP).
- **Output:** currency, split into realized and open-MTM components, never merged into
  one number that hides which part is still uncertain.
- **Where usable:** always reported alongside Leg WR and Managed Episode WR — never
  optional.
- **Where prohibited:** never dropped from a report "because the position is still
  open" — open positions are exactly the case this metric exists to cover (H-H-02,
  H-A-03's whole rationale).
- **Edge cases:** a chain that never resolves within the reporting window is reported
  with its open-MTM component explicitly flagged as unresolved, not silently excluded.
- **Missing-data:** if current mark is unavailable, the open component is `UNKNOWN`, and
  the report says so rather than omitting the position from the chain entirely.
- **Double-counting risk:** a rolled leg's old realized loss must appear exactly once,
  attributed to the old leg, never re-attributed to the new leg to make the new leg
  look worse or the old leg's history disappear (the charter's roll-immutability rule).
- **Validation:** cross-checked against the broker/ledger reconciliation, not
  recomputed independently from a different source of truth.

## CSP break-even (per contract)

- **Formula:** `BreakEvenPrice = Strike - EntryPremiumPerShare`.
- **Purpose:** The underlying price below which a CSP, if assigned/exercised at
  expiration, would be underwater on a pure options-economics basis (before
  considering post-assignment stock/CC lifecycle value, which `WholeChainPnL` and the
  recovery model separately account for).
- **Implemented:** `theta_q_baseline.py::_economics`, `theta_h_baseline.py`'s
  equivalent — both computed identically, confirmed by test
  (`test_economics_formulas_match_hand_computed_values`,
  `test_economics_hand_computed`).
- **Where prohibited:** never treated as a probability-of-profit statement — it is a
  price level, not a win-rate estimate (the delta-is-not-probability rule applies here
  too: proximity to break-even is not the same quantity as delta or realized WR).

## NetRollCredit

- **Formula:** `NetRollCredit = (NewCredit - OldDebitToClose) - RollTransactionCosts`.
- **Purpose:** The immediate cash effect of a roll — informational, not a decision
  criterion on its own.
- **Where prohibited:** **never** treated as proof a roll was good. H-R-03's
  `failure_mode` names this exactly: "the subtle risk here is treating a positive
  `NetRollCredit` as proof of a good roll." `RollUtility` (below) is the actual decision
  quantity; `NetRollCredit` is one of its inputs, not a substitute for it.
- **Missing-data:** `UNKNOWN` if either leg's price is unavailable — never assume a
  favorable roll when the closing leg's price is stale/missing.

## ReturnPerCapitalDay

- **Formula:** `ReturnPerCapitalDay = NetPnL / max(CapitalDays, epsilon)`.
- **Units convention:** `CapitalDays` is the capital committed multiplied by its
  holding duration. The calendar-day versus trading-day convention remains an explicit
  unresolved implementation choice in `PHASE2_4_CORRECTION_AUDIT.md`; it must be
  versioned before code or a result uses this metric.
- **Purpose:** Capital-efficiency metric — the mechanism H-R-01's early-close/roll
  thesis actually claims (freeing capital sooner), distinct from raw `EV_net` which
  does not account for how long capital was tied up.
- **Where usable:** the primary metric for EXP-R-01/EXP-R-02's head-to-head comparison
  (H-R-01 explicitly names this as its `payoff_target`).
- **Where prohibited:** never compared across candidates with materially different
  collateral requirements without also reporting raw `EV_net` and DD side by side —
  optimizing capital-days alone can favor smaller, more numerous, higher-variance bets.
- **Missing-data:** `UNKNOWN` if `HoldingDays` is undefined (position still open at
  report time) — use `WholeChainPnL`'s open-MTM convention, don't force a premature
  closing date.

## THETA_CycleUtility

- **Purpose:** The actual optimization objective for the full engine (per
  `CLAUDE.md`/TRD: "full-cycle, after-cost, per unit of capital-time" — not leg-level
  WR). This is the composite quantity every archetype-specific utility below feeds
  into at the full-cycle level.
- **Status:** **TEST, not RETAIN** — the TRD names this as the objective conceptually
  but this repo has not registered one single closed-form combination of
  `WholeChainPnL`, `ReturnPerCapitalDay`, DD/ES, and inventory-duration penalties as
  canonical. Composing them into one number risks re-creating exactly the "opaque
  blended score" pattern TRD CAND-003 and this repo's archetype-separation rule both
  forbid. **Recommendation (not yet implemented):** report the components
  side-by-side per archetype rather than collapsing them into a single scalar unless
  and until a specific weighting is itself validated as adding value over reporting
  the components separately — this mirrors exactly the ownership-model's own
  `multiplicative_combination: TEST` caution in `ownership_v0.py`.

## ManagementUtility

- **Purpose:** Generalized decision-time comparison across
  HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/SELL_CC/CLOSE_STOCK/REDEPLOY at a single timestamp —
  the formal object H-R-03 and the management decision engine (`PHASE2_MASTER_SPEC.md`
  §10) require every roll/close/hold decision to be evaluated against.
- **Formula:** `ManagementUtility(action | state) = E[FutureWealthChange_after_cost |
  action,state] - lambda * TailRisk(action) - kappa * CapitalDays(action) - xi *
  ExecutionRisk(action)`.
- **Status:** TEST/SPECIFIED — the sub-penalty weightings are open research questions,
  not frozen constants. No implementation exists.
- **Where prohibited:** never approximated by "pick the action with the best
  `NetRollCredit`" or "pick the action with the highest immediate premium" — those are
  inputs, not the utility itself.

## RollUtility

- **Formula:** `RollUtility_j = EV_new,j - EV_best_alternative - lambda *
  TailRisk_j - kappa * IncrementalCapitalDays_j - xi * OpportunityCost_j`.
- **Purpose:** The decision quantity for ROLL specifically — a special case of
  `ManagementUtility` scoped to the roll action, matching H-R-03's `payoff_target`
  exactly ("`EV_new - EV_best_alternative - tail/capital-day/opportunity-cost
  penalties`").
- **Where prohibited:** rolling based on `NetRollCredit` alone, without this
  comparison, is the exact naive policy EXP-R-03 is registered to beat.
- **Missing-data:** if `EV_best_alternative` cannot be computed (e.g. no ownership
  score for the ASSIGN alternative), the roll decision cannot be validated as positive
  `RollUtility` — treat as `UNKNOWN`, do not default to "roll is fine."

## CCUtility

- **Formula:** `CCUtility = EV_premium + EV_stock_retained - CallAwayRegret -
  EventRiskPenalty - ExecutionCost - TailPenalty` (TRD §23, as already recorded
  verbatim in `hypotheses.json`'s H-C-01 `payoff_target`).
- **Purpose:** The decision quantity for covered-call strike/expiry selection —
  explicitly not "maximize annualized yield," which is BC-1, the counterfactual this
  formula must beat.
- **`CallAwayRegret` must be computed from the actual post-call-away stock path**, per
  H-C-01's `failure_mode` — a backtest that only scores realized premium and omits
  forfeited upside will structurally favor the yield-maximizing policy regardless of
  the truth. This is the single most important edge case in this formula's
  implementation.
- **Missing-data:** if `CallAwayRegret` cannot be estimated (no post-call-away price
  path available, e.g. name delisted), report `UNKNOWN` for `CCUtility` rather than
  computing it with the term silently zeroed — a silent zero here is equivalent to
  assuming no regret, which biases toward the yield-maximizing policy this formula
  exists to correct for.

## Brier score

- **Purpose:** Calibration diagnostic for any probabilistic model output (never for a
  hand-built deterministic score, which has no probability to calibrate).
- **Formula:** `Brier = mean((p_predicted - outcome)^2)` over a cohort, `outcome ∈
  {0,1}`.
- **Where usable:** required for any model feeding a hypothesis under
  `shared_calibration_requirement` in `hypotheses.json`/`experiments.json` — tracked
  by regime/DTE/delta/ticker-family cohort, never one global number (MODEL-003).
- **Where prohibited:** never substituted for `EV_net` as an acceptance criterion — a
  well-calibrated model can still be EV-negative after cost.

## LogLoss

- **Formula:** `LogLoss = -mean(outcome*log(p) + (1-outcome)*log(1-p))`.
- **Purpose:** Companion calibration diagnostic to Brier, more sensitive to confident
  wrong predictions — reported alongside Brier, not instead of it.
- **Edge cases:** `p=0` or `p=1` exactly makes this undefined/infinite for a wrong
  case — clip `p` to a documented `[epsilon, 1-epsilon]` range before computing, and
  record the epsilon used.

## OpportunityCaptureRate

- **Purpose:** What fraction of viable, eligible candidates the policy actually acted
  on vs. returned WAIT/SKIP — a check against both overtrading (too high, acting on
  marginal candidates) and excess caution (too low, leaving positive-EV opportunities
  on the table).
- **Formula:** `OpportunityCaptureRate = PositiveEVOpportunitiesTaken /
  PositiveEVOpportunitiesDetected` per period. This remains `UNKNOWN` until the
  required after-cost EV estimate is available and calibrated; merely passing hard
  vetoes is not equivalent to a positive-EV opportunity.
- **Where usable:** monitoring/drift context, alongside `EV_net` — a rate near 0 or
  near 1 both warrant investigation, not assumed to mean the policy is working well.
- **Where prohibited:** never itself a target to optimize — it is diagnostic, not an
  objective.

## Assignment / recovery / capital-day / inventory / execution economics (composite note)

These are not single named formulas but combinations of the above plus the
`recovery_spec.py`/`severe_drawdown_spec.py` label definitions:

- **Assignment economics** = `WholeChainPnL` computed from the CSP's original economics
  through the stock-holding period to eventual exit, using
  `RecoveryBasis.ASSIGNMENT_ECONOMIC_BASIS` (not the original strike) as the reference
  cost basis once assigned (per `recovery_spec.py`'s taxonomy).
- **Recovery economics** = `S_recovery(t)` (survival curve, `recovery_spec.py`) combined
  with `ReturnPerCapitalDay` over the recovery-wait period, to weigh "keep waiting"
  against "redeploy elsewhere" (H-A-04's exact comparison).
- **Capital-day economics** = `ReturnPerCapitalDay`, defined above.
- **Inventory economics** = the open-MTM component of `WholeChainPnL`, tracked
  separately from realized P&L at every reporting snapshot.
- **Execution economics** = realized slippage vs. a documented reference price (mid,
  or a conservative fill assumption — never assumed to fill at midpoint, per the
  charter's non-negotiable rule), feeding `ExecutionCost` in `CCUtility` and the
  transaction-cost terms in `RollUtility`/`ManagementUtility`.

None of these composite formulas has a single canonical closed form registered yet
beyond what's stated above — flagged TEST/SPECIFIED, not RETAIN, consistent with
`THETA_CycleUtility`'s status.
