# THETA economic authority deep trace

> **CORRECTION (Wave 6, 2026-09-22)**: any claim in this document that no
> code path constructs a multi-leg Defined-Risk spread or distinct
> short-DTE Hold-Strike candidate is incomplete/withdrawn --
> `canonical-strategy-frontier.ts` contains real construction logic for
> both branches. See `THETA_CANONICAL_FRONTIER_HD_RECONCILIATION.md`. The
> single-decision-authority finding (only `thetaQEligible` drives real
> control flow in `new-risk-orchestrator.ts`) is unaffected.

Status: Wave 5 item 9. Grounded in a complete direct read of
`bots/theta/quant/models/opportunity_frontier.py` (277 lines, read in full)
and targeted call-graph tracing of `management_action_value.py`,
`canonical-strategy-frontier.ts`, and `management-action-frontier.ts`
(previously read in full in earlier passes of this engagement).

## What performs eligibility

`strategy_router.py::route_strategies` (deep-traced in Wave 4). Answers
"which branches may compete," never ranks or computes economics.

## What performs structural Pareto (within-branch)

`canonical-strategy-frontier.ts`'s `dominates()`/`rankCandidates()`
(previously traced): real Pareto ranking WITHIN one `branch`/`action` pair;
never compares across branches; alphabetical `candidateId` tie-break when
`paretoRank`/`unknownEvidence.length` are equal.

## What performs deterministic economics

`theta_q_baseline.py`/`theta_q_lattice.py` (not re-opened this pass;
confirmed real in earlier passes via their real TS callers and the real
2026-09-21 forensic's contract-lattice evidence) compute `evNet`/
`returnPerCapitalDay` per candidate. `opportunity_frontier.py` consumes
these as inputs -- it explicitly does NOT compute them itself (its own
docstring: "This module does NOT compute EV_net, ownership, AEGIS, or
sizing itself").

## NEW THIS PASS: `opportunity_frontier.py` is a real, ADDITIONAL ranking authority -- structurally branch-agnostic, unlike `canonical-strategy-frontier.ts`

This is the most important finding of this trace. `opportunity_frontier.py`'s
`build_opportunity_book()` ranks actionable candidates by
`_rank_key(candidate) = (1, candidate.return_per_capital_day)` (or `(0, 0.0)`
when RPCD is unknown) via a real Python stable sort, descending. **Its
`CandidateSnapshot` dataclass carries NO `branch`/`action`/`strategy` field
at all** -- unlike `canonical-strategy-frontier.ts`'s `dominates()`, which is
explicitly gated on `left.branch === right.branch`. This means
`opportunity_frontier.py`'s ranking mechanism would genuinely rank
candidates from DIFFERENT branches together by real economic value
(`return_per_capital_day`) the moment it is ever fed a multi-branch
candidate list -- it is not architecturally blocked from cross-strategy
ranking the way the frontier is.

**Confirmed this is real and wired**: `new-risk-orchestrator.ts:645-676`
calls the real Python bridge (`opportunityFrontier` operation) with the
real Pareto-survivor candidate set (`survivors`), and its response
(`OPEN_FULL`/`OPEN_REDUCED`/`OPEN_ALTERNATE_*`/`WAIT`/`PASS` per candidate)
is what actually determines each candidate's real disposition in the live
pipeline -- this is a genuine additional layer of authority downstream of
`canonical-strategy-frontier.ts`'s within-branch Pareto ranking, not a
duplicate or competing one.

**Why this doesn't currently produce real cross-strategy ranking in
practice**: `survivors` (the input to `opportunityFrontier`) is itself
derived entirely from `new-risk-orchestrator.ts`'s THETA_Q-only candidate
path (confirmed in the Wave 4 strategy router deep trace: no real candidate
generation exists for THETA_H/THETA_D). So this module's real cross-branch
ranking CAPABILITY is currently unexercised, for the same root cause
already documented (`THETA_STRATEGY_ROUTER_TRUTH_MATRIX.md`) -- **not**
because this module itself has a branch-blindness defect.

**Practical implication for the "cross-branch dominates() gap" finding from
earlier passes**: that finding (alphabetical tie-break in
`canonical-strategy-frontier.ts` when candidates from different branches
tie) may be LESS consequential than previously framed, IF
`opportunity_frontier.py`'s real RPCD-based ranking is what actually
determines final OPEN-vs-WAIT-vs-PASS disposition for real Production
candidates (which this trace confirms it is), and `canonical-strategy-frontier.ts`'s
own frontier is primarily a DIAGNOSTIC/shadow-export artifact rather than
the live decision mechanism (see next section). This does not mean the
`dominates()` gap should be un-flagged -- it is still real and should still
be fixed before it could matter -- but it means the REAL live ranking
authority for candidates that reach this stage is `opportunity_frontier.py`'s
real, branch-agnostic RPCD sort, not `canonical-strategy-frontier.ts`'s
`dominates()`.

## `canonical-strategy-frontier.ts`'s real role: downstream diagnostic/export artifact, not the live decision mechanism

Confirmed via direct trace of `theta-shadow-cycle.ts`: `buildCanonicalStrategyFrontier`
is called via `strategyFrontierFor(...)` **AFTER** `runNewRiskOrchestration`
(which already includes the real `opportunity_frontier.py` call and its
real disposition decision) has completed, using `orchestration.routing`/
`orchestration.aegis`/`orchestration.aegisByCandidateId` as its own inputs.
Its result (`strategyFrontier`) feeds `strategyQualityDiagnostics` in the
cycle's result object -- consistent with a diagnostic/shadow-export role,
not a second live decision authority competing with the real orchestration
result. **This means `canonical-strategy-frontier.ts`'s cross-branch gap,
while real and worth fixing, does NOT currently create an active "two
brains disagreeing" risk** -- it produces a diagnostic frontier shape
downstream of, not in competition with, the real decision already made.

**Caveat, not fully resolved this pass**: whether ANY consumer (e.g.
`canonical-decision-authority.ts`, confirmed to import
`canonical-strategy-frontier.ts` but not traced in depth this pass) treats
`strategyFrontier`'s own ranking as authoritative for something beyond
diagnostics was not exhaustively checked. Flagged as a precise follow-up:
open `canonical-decision-authority.ts` and confirm it never re-derives a
DIFFERENT final action from the frontier's own ranking after the real
orchestration result already decided one.

**NEW finding worth flagging to Codex**: `strategyFrontierFor`'s call
(`theta-shadow-cycle.ts:988-996`) builds `brokerAllowedQtyByCandidateId`
keyed under BOTH `THETA_CONVENTIONAL:<symbol>` AND
`THETA_HOLD_STRIKE:<symbol>` prefixes, from the SAME underlying
`RawCandidateInput[]` set. Since that candidate set is confirmed (per the
Wave 4 strategy router trace) to contain only 25-60 DTE THETA_Q-shaped
contracts, **any `THETA_HOLD_STRIKE`-prefixed entries this diagnostic
frontier produces are relabeled Conventional-DTE candidates, not real
2-5 DTE Hold-Strike candidates** -- a real mislabeling risk in a
DIAGNOSTIC artifact (not the live decision), but one that could mislead a
future reader of the shadow/export record into believing Hold-Strike was
genuinely evaluated. Recommend Codex either stop populating the
`THETA_HOLD_STRIKE:` keys until real Hold-Strike candidates exist, or
label them explicitly as a relabeled-proxy, never as real Hold-Strike
evidence.

## What performs empirical utility

Nothing, confirmed unchanged: `empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED'`
remains honestly hardcoded; `opportunity_frontier.py`'s ranking key
(`return_per_capital_day`) is a real STRUCTURAL/deterministic economic
figure, not a learned/calibrated one.

## `management_action_value.py`: confirmed part of the QUARANTINED architecture, not a competing management authority

Call-graph trace confirms `management_action_value.py`'s only real
importers are `management-assembly.ts`, which is itself only imported by
`covered-call-management-orchestrator.ts`/`management-cycle.ts`/
`management-orchestrator.ts` -- the SAME array-based management
architecture already confirmed `QUARANTINED_NO_CALLERS` in prior passes of
this engagement (zero real Production callers, via `autonomous-runtime.ts`).
**This resolves a real "two management brains" concern cleanly**: there is
no live ambiguity, because `management_action_value.py` is entirely inert.
The real, reachable management authority remains
`paper-bootstrap-management-policy.ts` (TypeScript), which does not call
into any Python module for its roll/CC/close/assignment economics.

## Where tie-breaking exists

- `canonical-strategy-frontier.ts`: alphabetical `candidateId.localeCompare()` when `paretoRank`/`unknownEvidence.length` tie (diagnostic frontier, not the live decision, per above).
- `opportunity_frontier.py`: Python's stable sort preserves INPUT ORDER for RPCD ties (not an explicit ID-based tie-break) -- worth noting as a DIFFERENT tie-break mechanism from the diagnostic frontier's; if the input candidate order itself has a systematic bias (e.g. always symbol-alphabetical from upstream universe ranking), that would be an indirect, not explicit, ordering bias. Not independently verified this pass whether `survivors`' order carries such a bias.

## STRUCTURAL vs. BOOTSTRAP vs. EMPIRICAL, applied to `opportunity_frontier.py`

- **STRUCTURAL**: the disposition classification logic itself (`_classify`) -- unresolved-input handling, structural disqualifiers (ownership/EV), transient WAIT reasons, AEGIS gating, alternate-fallback logic. All real, deterministic, based on already-computed upstream values.
- **BOOTSTRAP**: `OpportunityFrontierPolicy.reduced_size_uncertainty_threshold` -- a real, versioned, required policy parameter (no invented default in the dataclass), governing when elevated model uncertainty triggers `OPEN_REDUCED` rather than blocking. A real bootstrap threshold, not yet empirically validated.
- **EMPIRICAL**: none -- `model_uncertainty` itself is an UPSTREAM input this module consumes, not something it computes or learns.
