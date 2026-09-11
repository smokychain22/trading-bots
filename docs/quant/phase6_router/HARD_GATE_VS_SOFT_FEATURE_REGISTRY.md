# Hard-Gate vs. Soft-Feature Registry

Durability artifact. Names, explicitly, which conditions are allowed to be hard
gates (rare, binary, block everything) versus soft features (influence ranking/size/
structure/confidence, never an automatic veto). This is the registry the task's
"do not turn every imperfect condition into a veto" principle needs to be checkable
against, rather than re-litigated ad hoc at every review.

## Hard gates (rare, justified, already implemented where noted)

| Gate | Where enforced today |
|---|---|
| Invalid/UNKNOWN critical data (quotes, contracts, timestamps, broker state) | `strategy_router.py`'s Layer-0 check; `theta_q_baseline.py`'s `SPREAD_UNKNOWN`/`QUOTE_AGE_UNKNOWN` hard vetoes |
| Market closed for an action that requires it open | Not yet implemented — flagged as a required addition to the scheduler/decision-assembly layer |
| Insufficient buying power | `sizing.py`'s `UNKNOWN_INPUT` path (buying power unknown → qty 0); an explicit "known but insufficient" hard gate is implicit in the sizing cap arithmetic but not a named gate yet |
| Broker not authorized / provider INVALID | `aegis.py`'s `_provider` family (`HARD_VETO` on `provider_state == "INVALID"`) |
| Missing confirmed stock for a covered call | `strategy_router.py`'s THETA-C eligibility check (`stock_shares_held > 0`) |
| Unacceptably illiquid contract | `theta_q_baseline.py`'s `OPEN_INTEREST_UNKNOWN`/`OPEN_INTEREST_BELOW_FLOOR`/`VOLUME_UNKNOWN`/`VOLUME_BELOW_FLOOR`; `option-contract.ts`'s `executable=false` on wide spread |
| AEGIS HARD_VETO | `aegis.py`'s aggregation (strictest family wins) |

## Soft features (influence ranking/size/structure, never an automatic veto)

| Feature | Effect | Where enforced today |
|---|---|---|
| Moderately elevated model uncertainty | Reduces size (`OPEN_REDUCED`), never rejects outright | `opportunity_frontier.py`'s `reduced_size_uncertainty_threshold` check |
| Moderate model disagreement | Classified (`UNCERTAIN_EDGE` etc.), influences size/structure | `ModelDisagreementState` in `strategy_router.py`; full wiring into a disagreement-to-size mapping is a future refinement, not yet built |
| Slightly weaker ownership score (above floor, below "strong") | Currently binary (floor pass/fail) in `ownership_v0.py`/`strategy_router.py` — **a genuine gap**: there is no graded "weaker but acceptable" size adjustment yet, only a hard floor. Flagged for a future session rather than silently implying it already exists. |
| Moderately wider but still executable spread | Feeds `execution_quality.py`'s heuristic fill-probability/slippage estimate continuously, not a binary cutoff (the binary cutoff — `max_acceptable_spread_pct` — is itself a hard gate; below that cutoff, spread still continuously affects the estimate) |
| Moderate regime uncertainty (`RegimeSnapshot.confidence < 1`) | Currently informational only — `regime_v0.py`'s `confidence` field is surfaced but no downstream model yet consumes it to adjust size/structure. Flagged as a gap. |

## Discipline

A new condition should default to **soft** unless it meets the hard-gate bar: the
condition makes the decision *unsafe to evaluate at all* (not merely less attractive).
"Slightly worse" is definitionally soft; "cannot be trusted / cannot be executed /
violates a risk limit" is hard. When in doubt, this registry — not an ad hoc judgment
at implementation time — is the reference.

## Status

Registry reflecting actual current implementation state, with two explicit gaps
flagged (graded ownership scoring, regime-confidence-to-size wiring) rather than
silently assumed to exist.

## Flagged tension requiring an explicit decision (2026-09-10)

A real-data proof this session (real Alpaca 25-60 DTE SPY puts, real bid/ask,
real Greeks) had every candidate rejected by `theta_q_baseline.py`'s
`OPEN_INTEREST_UNKNOWN`/`VOLUME_UNKNOWN` (as of this session, the previously-conflated `OPEN_INTEREST_INSUFFICIENT`/`VOLUME_INSUFFICIENT` codes were split into UNKNOWN vs BELOW_FLOOR variants) hard vetoes, because Alpaca's
own option-chain snapshot endpoint does not reliably supply open interest, and
this proof did not yet wire Optionomics as an OI/volume fallback. A subsequent
product-direction message explicitly asked that "OI/volume should initially be
evidence/confidence features unless the canonical policy explicitly requires
them... do not let missing OI accidentally make every real contract PASS
forever."

This is a genuine tension, not a simple bug fix: `_hard_veto_reasons`'s own
docstring in `theta_q_baseline.py` states these checks are "binary, per TRD
section 18's hard-veto table" — i.e. this hard-gate behavior implements the
FROZEN build authority (`docs/specs/THETA_v1_1_FINAL_TRD_...`), not a
discretionary v0 default this module chose on its own. Per `CLAUDE.md`'s
explicit instruction ("Do not silently redesign THETA's frozen architecture...
lifecycle, provider ownership, outcome definitions, cost treatment, risk
semantics... any of these needs a versioned TRD revision — raise it to the
user, don't just implement a different design"), this hard gate was
**deliberately left unchanged** rather than silently softened to a confidence
feature.

**Decision (product/TRD owner, 2026-09-10):** option (a). TRD section 18's
OI/volume floors stand as hard gates, unchanged, for now. The fix is upstream:
wire Optionomics as a real OI/volume source before evaluating a real candidate
(`src/theta/option-chain-ingestion.ts`, already built) so the existing hard
gate is satisfied by real data rather than tripped by a missing Alpaca-only
fallback. Separately, the previously-conflated `OPEN_INTEREST_INSUFFICIENT`/
`VOLUME_INSUFFICIENT` reason codes (which could not distinguish "OI/volume is
UNKNOWN" from "OI/volume is known and genuinely below the floor") were split
into `OPEN_INTEREST_UNKNOWN`/`OPEN_INTEREST_BELOW_FLOOR` and
`VOLUME_UNKNOWN`/`VOLUME_BELOW_FLOOR` across `theta_q_baseline.py`,
`theta_h_baseline.py`, and `theta_q_lattice.py` -- this does NOT change
whether the gate is hard, only what a rejected candidate's reason correctly
says, so R6 can later tell a genuine liquidity rejection apart from a
data-availability gap. R6 will empirically test the current floor, a weaker
floor, a stronger floor, and soft/confidence use against untouched-OOS
after-cost economics and opportunity regret; a versioned TRD revision remains
the only path to actually changing the gate.

## Full-H cross-symbol frontier: mandatory vs. research-enhancing economic dimensions (2026-09-11)

A distinct question from candidate-eligibility hard gates above: once
`cross-symbol-economic-frontier.ts` (item H, Stage 2) has a set of Pareto-
non-dominated survivors, which of THOSE candidates' economic dimensions
must be known before that candidate can ever become an **executable**
selection, versus which merely refine its research ranking? Conflating
these two produced a genuine safety gap this session: a candidate could
survive Pareto dominance and win a capital-efficiency tie-break purely
because it had the LOWEST capital lockup, with no economic evidence it
was actually profitable — "shorter capital lockup" is not the same claim
as "positive expected value."

**Mandatory for EXECUTABLE_SELECTION** (a missing/UNKNOWN value here
means the candidate can be at most a `FRONTIER_RESEARCH_SURVIVOR`, never
an executable pick):

| Dimension | Enforced by |
|---|---|
| Contract identity (real, resolvable OCC symbol) | `option-contract.ts` normalization (already required, non-nullable) |
| Multiplier (contract-derived, never assumed 100) | `option-chain-ingestion.ts`'s `mergeOptionChain` (fixed this same session — prefers the contract's own real multiplier over any caller default) |
| Quote freshness | `data-freshness.ts` / `theta-shadow-cycle.ts`'s freshness gate (already a hard gate upstream of candidate economics) |
| Execution-quality truth | `execution-quality-contract.ts`, already gates `winningAction` in `new-risk-orchestrator.ts` before a candidate can reach `OPEN_FULL`/`OPEN_REDUCED` |
| Collateral / required capital | `theta_q_baseline.py`'s `secured_collateral_per_contract` (already required, non-nullable once a candidate is feasible) |
| Assignment capacity | `account-exposure.ts`'s `deriveAssignmentCapacity`, consumed by AEGIS |
| Event-state requirements | `event-state.ts` (UNKNOWN event state does not by itself veto, but is never silently treated as "no event") |
| AEGIS requirements | `aegis.py`'s aggregation, already a hard gate |
| **Minimum expectancy evidence (ReturnPerCapitalDay / ev_net known)** | **NEW this session** — `cross-symbol-economic-frontier.ts`'s `computeFrontierDisposition`: this is the dimension that was previously missing an explicit mandatory-gate, and is now the sole criterion that may ever produce `disposition='EXECUTABLE_SELECTION'` |
| The winning candidate's own underlying pipeline actually confirmed it (not just its bare economics) | **NEW this session** — `confirmWinnerAgainstOwnPipeline`: candidateEconomics is computed BEFORE that underlying's own AEGIS/sizing/execution-quality stages run, so economics-only agreement is never sufficient; the underlying's own receipt must have selected the exact same candidate with quantity > 0 |

**Research-enhancing (an UNKNOWN value here may still leave a candidate
on the Pareto frontier as a `FRONTIER_RESEARCH_SURVIVOR`, with increased
uncertainty, but never by itself prevents that status)**:

- `ownershipQuality`, `eventRiskPenalty`, `concentrationImpact`,
  `capitalOpportunityCost` (all added to `pareto_frontier.py`'s
  `CandidateEconomics` this session — Pareto dominance already correctly
  skips an unknown value on either side of a pairwise comparison rather
  than treating it as favorable or unfavorable; see
  `test_pareto_frontier.py`'s `FullHDimensionTests` for the pinned-down
  behavior, including the exact "EV=100/ownership=UNKNOWN vs. EV=80/
  ownership=known" scenario from the R1 safety directive).
- Research-only Cboe features (`cboe-regime.ts`) — explicitly never wired
  into any dominance dimension or executability gate; remains
  research-only until an ablation promotes a specific feature.
- Any future unvalidated challenger signal (e.g. a prospective GEX
  signal, per `docs/research/THETA_GITHUB_GAP_MATRIX.md`) — the same
  research-only discipline applies before it may ever influence
  `disposition`.

**Distinguishing the two runtime states**: `FrontierDisposition` is
`'EXECUTABLE_SELECTION' | 'RESEARCH_RANKING_ONLY' | 'NO_SURVIVORS'`. Only
the first sets `executable: true`. `RESEARCH_RANKING_ONLY`'s pick
(`selectedUnderlying`/`selectedCandidateId`) is preserved on the result
specifically so shadow/regret analysis retains the whole comparison —
it is simply never promoted to a confirmed selection by
`strategy-route-receipt.ts`, which checks `economicFrontier.executable`
before ever treating the frontier's pick as the receipt's own
`selectedStrategy`/`selectedCandidateId`.
