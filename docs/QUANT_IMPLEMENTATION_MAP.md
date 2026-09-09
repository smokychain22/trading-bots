# THETA Quant Implementation Map

Owner: Claude (quant research + adversarial validation lead). This maps every
quant-relevant TRD requirement to a concrete module under `bots/theta/quant/`, its
durable output, and how it gets verified. It is the working reference for Phase 6
(and the quant slice of every other phase) in `docs/PHASED_PLAN.md`.

Convention: `[MUST-ID]` references are TRD requirement IDs — grep the TRD for the exact
wording before implementing against one.

See `docs/DATA_READINESS_ASSESSMENT.md` for which feature families are actually usable
under the account's current (PAPER, entitlement tier TBD) Alpaca connection versus
blocked pending Codex's provider-capability check — that assessment, not this map,
should be updated first as entitlement answers land.

See `docs/STRATEGY_DNA.md` and `bots/theta/quant/research/data/hypotheses.json` for
the actual formalized hypotheses this map's models will eventually be built to test —
that registry, not this document, is where expert-evidence-to-hypothesis mapping,
benchmark/experiment IDs, and RETAIN/CORRECT/TEST/REJECT status live.

## 1. Feature engineering — `quant/features/`

| Feature family | TRD source | Module target | Durable output | Verification |
|---|---|---|---|---|
| Contract (DTE, moneyness, Greeks, spread) | §13, App. H | `features/contract.py` | `feature_snapshot` rows | Unit: dimensional consistency, null handling |
| Premium economics (credit/collateral, break-even) | §13 | `features/economics.py` | same | Formula fixtures vs Appendix A |
| Volatility (IV, RV, VRP proxy, skew/term/surface) | §13 | `features/volatility.py` | same | `iv_rank`/`iv_percentile` never treated as automatic entry signal (FAILDNA table) |
| Underlying (returns, trend, drawdown, gap risk) | §13 | `features/underlying.py` | same | No look-ahead in MA/RSI/ATR windows |
| Flow/context (Optionomics UOA, net premium) | §13, FEAT-002 | `features/flow.py` | same, provider-prefixed column names | Never merged into ambiguous internal columns |
| Events (earnings distance, corporate actions) | §13, §41 | `features/events.py` | same | Point-in-time revision control (no backward leakage) |
| Portfolio (concentration, capital-days) | §13 | `features/portfolio.py` | same | Reconciled against `capital_usage_snapshot` |
| Lifecycle (state, elapsed DTE, captured premium) | §13 | `features/lifecycle.py` | same | Matches `position_episode`/`episode_leg` truth |
| Expert priors (similarity/reliability score) | §14, §48 | `features/expert_priors.py` | `expert_prior_snapshot` | Shrinkage math fixtures (EXPMATH-001) |
| Regime | §42 | `features/regime.py` | `regime_snapshot` | Baseline rule model beats-or-loses vs HMM challenger, OOS only (REG-003) |

Every feature requires a `feature_definition` record (units, `as_of` semantics, null
handling, source, calculation version) before it is used in any model — FEAT-001. This
is a hard gate for Claude's own work, not just a Codex requirement.

## 2. Expert Strategy DNA — `quant/expert_priors/`

Source register: TRD §14 and §53 (Orange Cat, IWM Hold the Strike, Hendo_67, Ivan
Orehovec, Alex, Wheeling to Freedom, David Romic, Lick Neeson, SQQQ Hold-the-Strike as
failure DNA, Fearless Value). Each entry needs an evidence label —
`OBSERVED / RECONSTRUCTED / INFERRED / UNKNOWN` (EVID-001) — and a shrunk weight:

```
RawExpertWeight_e = DataQuality_e * SampleConfidence_e * RegimeFit_e
                     * Recency_e * Independence_e * Transferability_e
ShrunkWeight_e     = RawExpertWeight_e * N_e / (N_e + k_shrink)
ExpertPrior(a|X)   = sum_e ShrunkWeight_e * P_e(a|X) / sum_e ShrunkWeight_e
```

Deliverable: `quant/expert_priors/registry.py` (the evidence table) +
`quant/expert_priors/weighting.py` (the shrinkage math above). Never treated as secret
source code to copy — behavior priors and hypothesis generation only (EXP-001/002).

## 3. Decision models — `quant/models/`

| Model | Purpose | Initial form | Promotion rule |
|---|---|---|---|
| Entry outcome | P(net-positive managed episode) | Logistic → LightGBM/XGBoost challenger | Calibrated OOS + beats baseline (ENS table) |
| Assignment | P(assignment), post-assignment downside | Empirical/logistic + scenario sim | Calibration + lifecycle value |
| Management | HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/SELL_CC/CLOSE_STOCK value | Competing-risk/hazard + GBM | Must beat fixed 25/50/75% and time-exit baselines |
| Regime | Trend×vol×event×liquidity×stress state | Rule/cluster baseline; HMM challenger | HMM must beat interpretable baseline OOS |
| Cycle value | Expected full-chain wealth/capital-days | Scenario/Monte Carlo + empirical conditional | — |
| Ownership/recovery | `OwnershipAcceptability`, `P_SevereDrawdown`, `S_recovery(t)` | Logistic/LightGBM + survival model | §43 |
| Covered-call ranker | Strike/expiry utility | Transparent utility + GBM challenger | Must improve stock+call lifecycle economics |
| Roll evaluator | Incremental action utility | Scenario EV + learned policy-value challenger | Must beat close/hold/assignment alternatives OOS |
| Fill probability | P(fill \| BBO, size, time, state) | Logistic baseline | Calibrated from Alpaca paper/live TCA (FILL-001) |

MODEL-001: deep learning is not required for v1 and enters only after demonstrated
incremental untouched-OOS value. MODEL-002: models predict managed-trade outcomes —
delta is never used as a win-rate label.

## 4. Calibration — `quant/calibration/`

- Platt or isotonic, chosen by data volume/shape per bucket.
- Track Brier score, log-loss, reliability plots by **regime, DTE, delta, ticker
  family, strategy branch** (MODEL-003) — never a single global calibration number.
- `model_calibration_snapshot` is the durable output; drift beyond a versioned
  threshold raises a `model_drift_event` and de-rates the model's weight rather than
  silently continuing (ENS-003).

## 5. Backtesting, OOS, and graduation — `quant/backtest/`

| Stage | Purpose | Required evidence |
|---|---|---|
| 0. Mechanics | Payoff/accounting/lifecycle/order semantics | Fixtures pass |
| 1. Historical research | Feature/strategy hypothesis | Point-in-time replay, realistic cost model |
| 2. Purged walk-forward | Model/threshold selection | Embargo/purging; failed variants preserved |
| 3. Untouched OOS | Final research proof | Positive `EV_net`, calibration, tail/DD, benchmark/null survival |

Untouched OOS is never used for threshold or feature selection (ML-002) — that's the
single most common way a quant team quietly fools itself, and it's the first thing to
check adversarially in any Codex or Claude-authored backtest change.

Backtests use **quote-aware causal fills** — never assume all midpoint orders fill
(VAL-001, FILL-002). Historical fill uncertainty must be modeled conservatively or
excluded with a stated reason.

### Benchmark and ablation matrix (§49)

| ID | Benchmark/ablation | Tests |
|---|---|---|
| B0 | No-trade / cash reference | Opportunity-cost sanity |
| B1 | Mechanical CSP, fixed grid | Simple premium-selling baseline |
| B2 | Basic Wheel (CSP → assignment → simple CC) | Lifecycle baseline |
| B3 | Fixed 25/50/75% profit-take | Management benchmark |
| B4 | Fixed time-exit / 21-DTE | Time-management benchmark |
| B5 | Random-entry, matched by ticker/DTE/structure/size | Does timing/selection add value? |
| B6 | Buy-and-hold assigned underlying | Does Wheel management add value post-assignment? |
| A1–A6 | Incremental: +ownership, +vol/surface, +regime, +expert priors, +dynamic mgmt, +execution/fill model | Ablated EV/PF/WR/DD/ES/calibration/opportunity-capture delta per layer |

A layer that doesn't add stable OOS economic value is removed or kept research-only
(ABL-002) — this is a standing instruction, not a one-time cleanup.

## 6. Point-in-time datasets and labels — `quant/research/`

- Entry, assignment, management, roll, CC, recovery, and execution labels as defined in
  TRD §46 — each traceable to a `FusionSnapshot` and an immutable strategy/policy
  version (LABEL-001).
- No feature or label may reference a quote, event revision, position state, or
  management decision timestamped after the prediction time (LABEL-002) — this is the
  leakage check Claude runs adversarially on every dataset construction change.
- Overlapping same-ticker/same-day Wheel episodes are clustered, not treated as
  independent rows.
- Open/unresolved episodes at the training cutoff are censored, never counted as wins
  or losses by default.

## 7. Statistical claim standard for 70–80% WR (§50)

Any report claiming the 70–80% target must state, together:

- Explicit cohort definition (strategy branch, regime, DTE/delta region, management
  version, data/model/risk version, date range).
- Raw N and independent-cluster N — target ~300+ independent OOS episodes, preferably
  500+ across regimes.
- A binomial interval (Wilson for simple proportions; cluster/bootstrap where
  dependence exists).
- AvgWin, AvgLoss, PF, EV, DD, ES/CVaR, and open MTM inventory alongside WR.
- Confirmation that the final untouched OOS was not used to select the threshold that
  produced the reported number.

`quant/research/statistical_claims.py` is the single place this check is implemented —
any report generator elsewhere calls into it rather than reimplementing the standard.

## 8. Drift and model governance — `quant/models/` + `research.*` schema

- Champion models are immutable in production; new models run as challengers/shadow
  before promotion (ENS-001).
- Automatic retraining may create a challenger artifact but never auto-promotes
  (ENS-002).
- Every model artifact is identified by `model_version + feature_version + training
  cutoff + config hash` (ML-001).

## 9. Adversarial review checklist (run against Codex's `app/` changes)

- Does any formula in `app/src/theta` or `app/src/execution` match Appendix A exactly,
  including sign conventions (§40.1)?
- Does any code path coerce a missing Optionomics feature to zero instead of `UNKNOWN`?
- Does any sizing path allow `max(1, qty)` instead of a true zero?
- Does a roll implementation ever let the old leg's realized P&L be absorbed into the
  new leg (ROLL-001)?
- Does any reported win rate omit Leg WR / Whole-Chain WR / open MTM alongside it
  (OUT-002)?
- Does anything let Optionomics-derived data submit or block an order directly instead
  of only informing risk/policy (ARCH-002, OPT-004)?

### 9.1 Break-it scenarios to run against Codex's execution/lifecycle code

Per `docs/TEAM_CHARTER.md`, don't just read the code — try to break it with realistic
trading scenarios before signing off. This list is a starting checklist, not
exhaustive; add to it as new failure modes are found:

- Assignment happens overnight, before the scheduler's pre-open reconciliation runs.
- A partial fill leaves a remaining-order state that strategy logic then ignores.
- Alpaca times out on submit — does the reconcile-before-retry path actually run, or
  does something resubmit blindly?
- A stock split or merger lands mid-chain — does the affected symbol correctly
  quarantine new risk rather than silently trading an ambiguous deliverable?
- Ex-dividend date arrives on a covered call that's deep ITM with low extrinsic value —
  is early-assignment risk actually flagged, not just theoretically modeled?
- A quote used for a decision is stale by the time of order submission.
- The spread on the selected contract is wide enough that crossing it should cancel
  the order, not force a fill.
- Two positions are highly correlated (same sector, same earnings date) — does sizing
  actually account for that, or does each position get sized as if independent?
- Two management actions could both fire on the same state (e.g. a roll trigger and an
  assignment-recovery trigger) — which wins, and is that arbitration explicit or
  accidental?
- The service restarts while a position is mid-lifecycle (e.g. between order
  submission and fill confirmation) — does it resume from durable state or lose track?
- Optionomics is missing a feature the candidate scorer expects — does the candidate
  get scored with a silent default, or does the missing feature propagate as `UNKNOWN`?
- The broker position drifts from the internally tracked state because of a manual
  intervention or an out-of-band account action — is that drift detected and does it
  block new risk until reconciled?
