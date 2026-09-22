# THETA strategy router truth matrix

> **CORRECTION (Wave 6, 2026-09-22)**: this document's claim that no code
> path constructs a multi-leg Defined-Risk spread or a distinct short-DTE
> Hold-Strike lattice was incomplete. `canonical-strategy-frontier.ts`
> contains real construction logic for both. See
> `THETA_CANONICAL_FRONTIER_HD_RECONCILIATION.md` for the full correction.
> The narrower finding below -- that only `thetaQEligible` drives real
> control flow, and H/D runtime reachability is unproven -- still stands.

Status: Slice 4 of the pre-VPS master continuation directive. Grounded in
direct source reads (this pass, via a dedicated research fork) of
`strategy-timing-router.ts`, `new-risk-orchestrator.ts`,
`canonical-strategy-frontier.ts`, `strategy-package.ts`, `theta-shadow-cycle.ts`,
and `master-paper-plan-assembly.ts`.

## Correction to a plausible-sounding assumption

`src/theta/strategy-timing-router.ts` (`routeStrategyTiming`) is **NOT** the
real Production strategy router, despite its name. Confirmed via its only
real caller: `p2e-evidence-store.ts:55`, itself only invoked from
`autonomous-runtime.ts:437` as
`new PostgresP2EEvidenceStore(pool).persistManagementEvidence(states, frontiers)`
-- a diagnostic/evidence-recording path, not a decision gate. It also
hardcodes `executionAuthorized: false` and only produces
`APPLICABLE`/`NOT_APPLICABLE`/`UNKNOWN` timing labels, never an economic
comparison.

The **real router** is a Python-bridge call:
`new-risk-orchestrator.ts:344-357` (`invokeAndValidate(bridge, 'strategyRouter', ...)`),
backed by `strategy-router-contract.ts` and (by naming convention, not
independently opened this pass) `bots/theta/quant/models/strategy_router.py`.

## Critical structural finding

The real orchestrator only ever checks
`thetaQEligible = eligibleFamilies(routerResult.data).includes('THETA_Q')`
(`new-risk-orchestrator.ts:363`) and gates the entire rest of the function on
it (`:389`: `if (!thetaQEligible || request.candidates.length === 0)`). **No
`THETA_H`/`THETA_D`/`THETA_A` family eligibility check exists anywhere in
this file.**

This is explained upstream by candidate construction itself:
`theta-shadow-cycle.ts:791-859` sets
`optionTypes = hasPotentialCoveredStock ? ['put','call'] : ['put']` (`:802`)
-- puts (feeding THETA_Q/CSP) are always fetched; calls (feeding THETA_CC)
only when stock is already held. **There is no code path anywhere in the
live pipeline that constructs a multi-leg Defined-Risk spread candidate or a
distinct short-DTE Hold-Strike lattice.** Their `RESEARCH_ONLY` registry
status is not merely a downstream Paper-gate label -- it is structurally
enforced by a complete absence of entry-candidate generation for those two
branches.

## Lifecycle state matrix

| Lifecycle state | Router input | Eligible branches (real) | Generated actions | Real candidate source | Economic comparator | AEGIS invoked | Sizing | Final authority | Paper eligible | Broker authority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CASH_AVAILABLE | Account has no open position | THETA_Q only (confirmed real); THETA_CC/THETA_H/THETA_D have no real candidate path | OPEN_CSP | `theta-shadow-cycle.ts:791-859` (puts only) | `canonical-strategy-frontier.ts` within-THETA_Q Pareto only | Yes, Python bridge (`new-risk-orchestrator.ts:344`) | Yes, Python bridge (`sizing-contract.ts`) | `canonical-strategy-frontier.ts` | THETA_CONVENTIONAL: yes (`status:'SHADOW'`) | Codex-owned |
| CSP_PENDING / CSP_OPEN / CSP_PROFIT / CSP_LOSS / CSP_OTM_NEAR_EXPIRY / CSP_ITM_NEAR_EXPIRY | Real chain lifecycle state | Management-side (roll/close/hold) | HOLD / CLOSE_FULL / ROLL / LET_EXPIRE | **Confirmed broken for ROLL**: the real roll valuator never receives a non-null candidate (Unknown Ledger item 1) | N/A (blocked upstream for ROLL; real for HOLD/CLOSE) | N/A | N/A | `PaperBootstrapManagementPolicyProvider`, crippled for ROLL specifically | Yes (SHADOW), but roll candidates always null | Codex |
| ASSIGNMENT_RISK / ASSIGNED_STOCK / STOCK_RECOVERY / STOCK_RECOVERED / CC_PENDING / CC_OPEN / CC_ITM / CC_OTM / CALL_AWAY_RISK | Real | THETA_RECOVERY / THETA_CC (`status:'SHADOW'`, real Paper-eligible) | Various | See `THETA_MANAGEMENT_END_TO_END_GRAPH.md` for the grounded per-state trace | -- | -- | -- | -- | Yes (SHADOW) | Codex |
| PARTIAL_FILL / UNKNOWN_SUBMISSION / BROKER_AMBIGUOUS | Broker-side order-lifecycle states | N/A -- these are broker reconciliation states, not strategy-branch states | N/A | Not traced this pass -- belongs to broker reconciliation, not the frontier/router | -- | -- | -- | -- | -- | Codex |

## Verdicts

- **STRATEGY_ROUTER_REAL = PARTIAL -- now fully resolved, see `THETA_STRATEGY_ROUTER_DEEP_TRACE.md`.**
  A real router exists (Python bridge, `strategyRouter` operation) and is
  really invoked. A full read of `strategy_router.py` (259 lines) confirms the
  router itself genuinely evaluates ALL 6 families every cycle (THETA_Q,
  THETA_H, THETA_D can all be simultaneously eligible; THETA_R/THETA_A/THETA_C
  are lifecycle-gated) and its full result IS persisted in the shadow
  evidence record (`routing: routerResult.data`, `new-risk-orchestrator.ts:790`).
  The gap is entirely downstream: the TS control flow only ACTS on
  `THETA_Q` eligibility (`:363`), and no candidate-generation code exists for
  THETA_H/THETA_D regardless of what the router says. "Router capable of
  representing a branch" and "runtime actually executing that branch" are
  now cleanly distinguished, per the deep trace.
- **STRATEGY_SWITCHING_STRUCTURAL = YES, confirmed.** The registry
  (`strategy-package.ts`'s `allowedActions`/`lattice`) genuinely differs per
  branch, and `dominates()` does structurally separate branches when
  candidates from more than one exist (though see below -- this rarely
  matters in practice today).
- **STRATEGY_SWITCHING_ECONOMIC = NO, for cross-branch selection.** (a) The
  live orchestrator only ever generates THETA_Q (and conditionally THETA_CC)
  candidates simultaneously -- no real multi-branch candidate set has ever
  existed to economically compare; (b) even if it did, `dominates()` never
  compares across branches (`canonical-strategy-frontier.ts:428`, unchanged),
  so a tie would fall to `candidateId.localeCompare()` (`:452`, unchanged) --
  alphabetical, not economic. **Within** THETA_Q alone, ranking among CSP
  candidates at different strikes/DTEs IS real economic Pareto ranking.
- **No deterministic test found** proving different lifecycle states produce
  materially different candidate/action sets ACROSS branches (not
  exhaustively searched -- flagged as a real, unconfirmed test gap rather
  than a confirmed absence).

## Codex-relevant implication

The cross-branch `dominates()` gap is currently **latent, not actively
triggering** in practice, because only one branch's candidates ever coexist
today (THETA_Q always; THETA_CC only when stock is held, which is a
different lifecycle phase, not a simultaneous competitor). It becomes live
the moment real candidate generation for a second entry branch (Hold-Strike
or Defined-Risk) is ever built -- it should be fixed proactively before that
happens, not discovered reactively once two branches' candidates first
coexist.
