# THETA_BRAIN_AUTHORITY_V1

Phase 1 Zero-Unknown Reclosure Pass 3, items 12-14. One authoritative
function per concern, evidenced by exact call-graph tracing (Pass 2/3),
never inferred from a downstream object's mere existence. This document is
the artifact Codex and future sessions use to answer "which function
actually decides X" without re-deriving it.

| CONCERN | AUTHORITATIVE FUNCTION | FILE | INPUT | OUTPUT | DOWNSTREAM CONSUMER | AUTHORITY CLASS | CURRENT REALITY LEVEL |
|---|---|---|---|---|---|---|---|
| Candidate ranking / anti-paralysis disposition (Q branch, Python research layer) | `rank_candidates` / opportunity book construction | `bots/theta/quant/models/opportunity_frontier.py` | already-computed per-candidate EV_net/ownership/AEGIS/sizing outputs (does not compute these itself, by explicit module docstring) | WAIT/PASS disposition + ranked opportunity book | `strategy_router.py`, `pareto_frontier.py`, exposed to TS via `opportunity-frontier-contract.ts` | RESEARCH_ADVISORY (Python side never places or selects a broker-facing action; it feeds structural economics into the TS canonical frontier) | L6_RUNTIME_REACHABLE (wired, evaluated every real cycle; not itself broker-authorized) |
| Cross-branch structural/Pareto selection (the real "which candidate wins" decision) | `buildCanonicalStrategyFrontier`'s internal `structuralSelection` | `src/theta/canonical-strategy-frontier.ts:740` (`selectedCandidateId: structuralSelection?.candidateId ?? null`) | per-branch evaluated candidates (Q/H/D/A/C), computed unconditionally and synchronously, zero Postgres/network dependency | `CanonicalStrategyFrontier.selectedCandidateId` | `src/execution/master-paper-plan-assembly.ts:59` (reads `frontier.selectedCandidateId` directly); this is the ONLY real consumer of the selection itself | PRODUCTION_LOCKED -- the sole real selector | L6_RUNTIME_REACHABLE by default; L7 only when a real evidence manifest with matching source/worker SHA accompanies the run (see `profitability-brain-evidence-manifest.ts`) |
| Persistence-time handoff reconciliation (NOT a second selector) | `resolveCanonicalDecisionAuthority` | `src/theta/canonical-decision-authority.ts` | the frontier's own already-made `selectedCandidateId` + the subordinate/legacy new-risk receipt | a reconciled decision record for Postgres | exactly one real caller: `src/theta/postgres-theta-cycle-store.ts:598`, inside the Postgres persistence transaction only | PRODUCTION_LOCKED, but scoped to validation/handoff -- never runs inside `runThetaShadowCycle` itself, never executed during a Postgres-down cycle (confirmed: did not run on the real Sep24 episode) | L6_RUNTIME_REACHABLE only when Postgres persistence actually runs; `BLOCKED_DEPLOYMENT_CODEX`-scoped like the rest of the write path until the deployed worker's schema is compatible |
| Final broker-facing action assembly | `assembleMasterPaperPlan` (reads `frontier.selectedCandidateId`) | `src/execution/master-paper-plan-assembly.ts:59` | the frontier's `selectedCandidateId`, sizing, AEGIS state | a typed Paper action plan (never itself submits) | the Paper execution handoff seam (still gated by `PAPER_PAUSE_NEW_ORDERS`/`MASTER_PAPER_EXECUTION_ENABLED`, both `0`/`false` per the safety floor) | PRODUCTION_LOCKED consumer, not a selector | L6_RUNTIME_REACHABLE; broker submission remains globally disabled by the safety floor regardless of this module's own readiness |

## Contradictions checked and reconciled

- **`opportunity_frontier.py` does not compete with `structuralSelection`.**
  Its own docstring is explicit: it ranks and dispositions an already-scored
  book, and does not compute EV_net/ownership/AEGIS/sizing itself. No
  existing doc in this repo was found claiming otherwise; no correction to
  another file was required.
- **`canonical-decision-authority.ts`'s name is easy to misread as "the
  decision authority."** It is not -- it is a handoff-validation step,
  confirmed by exhaustive real-caller tracing (Pass 2) to have exactly one
  caller, persistence-time-only. The registry entry in
  `profitability-brain-reality.ts` was already corrected in Pass 2
  (`CANONICAL_DECISION_HANDOFF_VALIDATION`, distinct from
  `CANONICAL_ENTRY_SELECTION`); this document is the first place the full
  four-row authority table is written down in one place.

## Not yet extended to this document

The H/D/A/C per-branch candidate-enumeration authorities (each its own
`_..._CANDIDATE_ENUMERATION` methodId in `profitability-brain-reality.ts`'s
registry) are not broken out row-by-row here -- they are already
individually evidenced in that registry's `sourceEvidence` citations. This
document covers the SELECTION/HANDOFF/CONSUMPTION layer specifically named
by the Pass 3 directive (item 12), not a full re-derivation of the entire
registry.
