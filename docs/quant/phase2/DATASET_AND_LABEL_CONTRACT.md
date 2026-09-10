# THETA Dataset and Label Contract

Durability artifact (see `PHASE2_MASTER_SPEC.md`). Persists the point-in-time
research-row contract and per-archetype label definitions that previously existed only
as conversational Phase 2 output. SPECIFIED throughout — no backtester exists yet
(Phase 6 gate, `docs/PHASED_PLAN.md`), so nothing here has been run.

## 1. Point-in-time research row contract

Every research row (a candidate evaluation, a management decision, a rejection, or a
WAIT) must carry:

- `as_of <= decision_timestamp` — every feature value used must have been genuinely
  available at or before the decision timestamp, never a value only knowable in
  hindsight. This is the single load-bearing invariant of the entire contract; every
  other field below exists to make this checkable, not just assumed.
- Explicit `UNKNOWN != 0` for every optional field — consistent with the non-negotiable
  rule already enforced throughout `bots/theta/quant/models/*.py` (every `Optional`
  field defaults to `None`, never a numeric placeholder).
- Immutable `strategy_version`, `model_version` (per model family in
  `MODEL_REGISTRY.md`), `cost_model_version`, `execution_model_version` — a replayed
  decision must reconstruct using the exact versions active at decision time, never the
  versions active at replay time.
- The full candidate set considered, including rejected candidates (with their reason
  codes, per `ReasonCode` in `models/common.py`) and the WAIT/SKIP outcome when no
  candidate was acted on — CAND-002's "retain rejected alternatives" requirement.
- Portfolio state at decision time (open positions, capital committed, concentration by
  ticker/sector) — required for any sizing-cap or concentration-cap reasoning to be
  reconstructable.
- AEGIS state at decision time (`ALLOW_FULL`/`ALLOW_REDUCED`/`DEFINED_RISK_ONLY`/
  `HOLD_ONLY`/`HARD_VETO` plus reason codes — see
  `AEGIS_SIZING_EXECUTION_CONTRACT.md`) — a decision cannot be replayed correctly
  without knowing what the risk gate allowed at that moment.
- Model version identifiers for every model that contributed a feature or score to the
  row (ownership, regime, severe-drawdown, recovery, entry-outcome, etc.) — not just
  the strategy version as a whole.
- A hash/provenance chain: each row references the exact upstream data snapshot
  (Optionomics/Alpaca fetch identity and retrieval time, per FEAT-001/ALP-006) it was
  computed from, so a replay can verify it is reconstructing from the same inputs, not
  merely "similar" ones.

## 2. Per-decision-type label definitions and leakage guards

### ENTRY (`entry_label`)

- **Definition:** managed-episode after-cost outcome under the fixed
  strategy/model/cost version active at entry decision time (TRD §46) — never simple
  expiry ITM/OTM, which discards the whole managed-episode discipline this repo's
  metrics hierarchy (Leg WR / Managed Episode WR / Whole-Chain WR / Open MTM) exists to
  preserve.
- **Leakage guard:** the label is only assignable once the managed episode has fully
  resolved (closed, expired, assigned-and-exited, or explicitly censored at dataset
  cutoff) — an in-progress episode contributes no entry label yet, and must not be
  back-filled using information only available after the fact when training a model
  that will run at entry time.

### ASSIGNMENT (`assignment_label`)

- **Definition:** the assignment event plus its full post-assignment downside/recovery
  path — assignment itself is never automatically a win or loss (TRD §46, H-A-01).
- **Leakage guard:** the label cannot be finalized until the post-assignment path
  resolves (recovery, called-away, or censored) — same discipline as ENTRY, applied to
  the longer assignment→recovery→exit chain specifically.

### MANAGEMENT (`management_label`)

- **Definition:** the action-value comparison at decision time across
  HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/etc. (TRD §46) — not simply whether the position was
  eventually profitable, which conflates the decision's quality with its realized
  outcome (a good decision can still have a bad realized outcome, and vice versa).
- **Leakage guard:** the label must be computed as the actual best-alternative
  comparison at that timestamp using only information available then — never
  retroactively relabeling a HOLD as "correct" because the position later worked out,
  which is a distinct discipline from ENTRY/ASSIGNMENT's resolution-based labels.

### ROLL (`roll_label`)

- **Definition:** incremental value of the new exposure versus the best feasible
  alternative computed at the same decision timestamp (TRD §46) — `RollUtility`, not
  `NetRollCredit`.
- **Leakage guard:** `EV_best_alternative` must be computed using only pre-roll-time
  information; the eventual realized outcome of the alternative not taken is never
  substituted in.

### CC (`cc_label`)

- **Definition:** after-cost stock+call utility and call-away outcome conditional on
  stock state (TRD §46) — `CCUtility`, including `CallAwayRegret` from the actual
  post-call-away path.
- **Leakage guard:** same retrospective-label-but-not-retrospective-input discipline
  as the covered-call ranker entry in `MODEL_REGISTRY.md` — the label is necessarily
  computed after the fact for training, but the model must never be given access to
  post-decision information at serving time.

### RECOVERY (`recovery_label`)

- **Definition:** time-to-approved-recovery, or explicit censoring if unresolved at
  dataset cutoff (TRD §46) — open recovery episodes are censored, never scored as wins
  or losses while still open.
- **Leakage guard:** identical to `severe_drawdown_spec.py`'s implemented guard —
  `entry_date <= as_of <= min(horizon_end, dataset_cutoff)` — applied to recovery
  curves via `recovery_spec.py`'s `_survival_at`/`_first_crossing`.

### EXECUTION (`execution_label`)

- **Definition:** realized fill price/slippage relative to the reference quote at
  order time — never a midpoint-fill assumption.
- **Leakage guard:** the label uses only the quote state at or before order submission
  as the reference; the realized fill (necessarily known only after the fact) is the
  label being predicted, not an input available at serving time.

## 3. Universe and survivorship discipline

- The candidate universe at any historical point-in-time must be reconstructed as it
  actually existed then — later delistings, ticker changes, or index membership
  changes must not silently remove a name from the historical universe it was actually
  eligible in at the time (survivorship bias, named explicitly as a failure mode in
  H-Q-01).
- Corporate actions (splits, mergers, spinoffs) must be applied consistently to price
  history so that strike/premium/P&L reconstruction is not corrupted by an
  unadjusted or double-adjusted series — this is the same concern the proposed
  `CORPORATE_ACTION_AMBIGUOUS` severe-drawdown status exists to flag rather than
  silently misclassify.

## 4. WAIT/SKIP retention

Per OBS-001/§39: every decision, including a WAIT or SKIP outcome with zero candidates
acted on, must remain reconstructable from immutable point-in-time inputs. A dataset
that only records rows where a trade was taken cannot support any of the benchmark
comparisons in `BENCHMARK_AND_EXPERIMENT_REGISTRY.md` that require knowing what was
available but not taken (e.g. `OpportunityCaptureRate`, and every "eligible but
rejected" comparison in the benchmark matrix).

## 5. Backtest/replay, walk-forward, and OOS discipline

- **Deterministic replay:** a frozen decision must replay identically without
  re-fetching mutable live data (DATA-003) — this is the entire purpose of the version
  pinning in §1 above.
- **Purged walk-forward:** training windows exclude a purge/embargo period immediately
  before each test window, sized to exceed the longest label-resolution horizon in use
  (e.g. a recovery label that can take many weeks to resolve requires a longer embargo
  than an entry label that resolves at next expiration) — the exact embargo length is
  SPECIFIED per label type, not a single global constant, since resolution horizons
  differ by an order of magnitude across `entry_label` vs. `recovery_label`.
- **Untouched OOS:** a final holdout split is never used for threshold selection,
  feature selection, or model comparison during development (ML-002) — used exactly
  once, for confirmation, per hypothesis's acceptance/rejection criteria.
- **Clustered/regime resampling:** effects must survive clustered-bootstrap or
  regime-block resampling, not just an i.i.d. bootstrap that would overstate
  confidence given how correlated same-regime episodes are with each other.
- **Raw N vs. effective/independent N:** reported together always (shared across every
  hypothesis in `experiments.json`) — the 300+/500+ independent-episode threshold for
  approaching the 70-80% headline range (TRD §50) is stated in terms of independent
  N, not raw row count, since raw rows from overlapping/correlated episodes
  systematically overstate genuine sample size.
- **Selection-bias diagnostics (DSR/PBO or equivalent):** required before any finding
  is accepted as general, given however many variants were actually tried — this is
  why failed experiments are retained in `experiments.json` rather than discarded (a
  DSR/PBO-style correction needs to know the full search breadth, not just the winning
  variant).

## 6. What this contract explicitly does not do

It does not specify a physical schema (that is Codex's `research.*` Postgres schema,
per `docs/OWNERSHIP.md` — "Claude specifies the shape... Codex implements the
migration"). It does not run any experiment — every criterion above is checked against
real data only once a backtester exists (Phase 6 gate) and real historical data access
is confirmed (see `docs/DATA_READINESS_ASSESSMENT.md`). Running experiments against
this contract before that infrastructure exists would be exactly the "pretend empirical
experiment without the required historical data" this durabilization pass is
instructed not to produce — any such attempt must be marked `BLOCKED_BY_DATA`, not
worked around with synthetic-data results presented as real findings.
