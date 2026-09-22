# THETA strategy router deep trace

Status: Directive item 7 (Wave 3). Grounded in a complete, direct read of
`bots/theta/quant/models/strategy_router.py` (259 lines, read in full) plus
the real TypeScript bridge caller (`new-risk-orchestrator.ts`).

## What the Python router actually is

`route_strategies(policy, portfolio, market) -> List[StrategyEligibilityResult]`
is genuinely Layer 1 + Layer 3 of a documented routing hierarchy: it answers
ONE question -- "given current lifecycle and market state, which strategy
families may compete this cycle?" -- and explicitly does **NOT** generate
candidates, compute economics, or decide a final action (its own docstring:
those are `theta_q_baseline.py`/`theta_q_lattice.py`/`opportunity_frontier.py`/
`management_action_value.py`'s jobs).

## All inputs

- `RouterPolicy`: `policy_version`, `theta_q_min_ownership_acceptability`, `theta_h_min_ownership_acceptability` (deliberately a STRICTER floor than THETA-Q's, over the same continuous score), `theta_d_gate_satisfied` (a boolean policy flag -- Level 3 options approval + THETA-Q/H/R/C/A graduation, per `strategy_archetypes.json`). No default values exist on this dataclass -- every field is a required constructor argument, so there is no silent/implicit policy default at this layer.
- `MarketContext`: `ownership_acceptable` (continuous `[0,1]` score, `None` = UNKNOWN, never assumed acceptable), `liquidity_acceptable` (`Optional[bool]`), `event_near` (`Optional[bool]`), `critical_data_valid` (a hard boolean gate).
- `PortfolioContext`: `lifecycle_state`, `stock_shares_held`, `open_option_exists`, `assignment_imminent`.

## All outputs

One `StrategyEligibilityResult` per family, **every cycle, for all 6 families
unconditionally** (`strategy_family`, `eligible`, `eligibility_state`,
`reasons`, `policy_version`) -- even an ineligible family gets a real result
with a real reason code, "so the shadow record can show why a branch didn't
compete, not just that it didn't" (the module's own docstring).

## Every possible branch/action -- confirmed by reading the full function body

- **LAYER 0 (hard, blanket exclusion)**: `critical_data_valid == False` makes ALL 6 families `INELIGIBLE_DATA` simultaneously -- applies identically, no exceptions.
- **THETA_R** (management): eligible (`ELIGIBLE_PRIMARY`) iff lifecycle is `CSP_OPEN`/`ROLL_PENDING`/`CC_OPEN` -- confirms THETA_R is genuinely a management ROUTE over active lifecycle, never a fresh-entry competitor, consistent with earlier findings in this engagement.
- **THETA_A** (assignment/recovery): eligible iff lifecycle is `ASSIGNMENT_RISK`/`STOCK_HELD`/`RECOVERY`, OR `assignment_imminent` is true.
- **THETA_C** (covered call): eligible iff `stock_shares_held > 0` -- confirmed stock only, never speculative.
- **THETA_Q/THETA_H/THETA_D** (fresh entries): only relevant when `lifecycle == CASH_AVAILABLE`. When not a fresh-entry state, all three are `INELIGIBLE_STATE` together.
  - **THETA_Q**: `ownership_acceptable is None` -> `ELIGIBLE_REDUCED` (kept eligible for EVIDENCE ENUMERATION ONLY -- "downstream ownership and risk gates remain binding," `theta_q_baseline` still marks such a candidate infeasible, so an unknown ownership score can never itself authorize an opening trade -- a real, deliberate anti-paralysis design, not a loophole). Below the THETA-Q floor -> `INELIGIBLE_RISK`. Liquidity unacceptable -> `INELIGIBLE_DATA`. Otherwise -> `ELIGIBLE_PRIMARY`.
  - **THETA_H**: requires a KNOWN ownership score (not `None`) AND `event_near is False` AND the score meets THETA-H's own, stricter floor -- never inherits THETA-Q's floor automatically. Otherwise `INELIGIBLE_RISK` or `INELIGIBLE_STATE`.
  - **THETA_D**: gated entirely on `policy.theta_d_gate_satisfied` -- a single external policy boolean, independent of any market/portfolio state.

## Does it rank strategies?

**NO, confirmed by reading the entire function.** There is no score comparison
between families anywhere in this module -- only a per-family binary
eligible/ineligible classification (with a secondary `EligibilityState`
nuance: `PRIMARY`/`CHALLENGER`/`REDUCED`). Ranking/economic comparison is
explicitly deferred to `opportunity_frontier.py`/`management_action_value.py`
(this module's own docstring), which this deep trace did not additionally
open this pass.

## Can Q/H/D coexist as eligible?

**YES, structurally confirmed.** All three (THETA_Q, THETA_H, THETA_D) are
evaluated in the SAME `else` branch (when `entry_relevant` is true) and their
eligibility computations are entirely independent of each other -- nothing in
this function prevents all three from being simultaneously `eligible=True`
in one real `route_strategies()` call. **This directly means the Python
router itself is NOT "THETA_Q-only"** -- the earlier hypothesis flagged as
unconfirmed in `THETA_STRATEGY_ROUTER_TRUTH_MATRIX.md` is now resolved: the
router is fully multi-family-capable.

## Is there a cross-branch economic comparison?

No -- confirmed absent from this file (see "does it rank strategies?" above),
and separately confirmed absent downstream in `canonical-strategy-frontier.ts`
(`dominates()` never compares across branch/action, per prior passes of this
audit).

## Does TypeScript consume every branch?

**NO -- this is the critical, now fully-resolved finding.** `new-risk-orchestrator.ts:363`:
`const thetaQEligible = eligibleFamilies(routerResult.data).includes('THETA_Q')`
-- this is the ONLY family eligibility the orchestrator's control flow reads.
However, **the full router response IS persisted** -- `routing: routerResult.data`
appears in the final receipt object at line 790, so the real eligibility
results for THETA_H/THETA_D/THETA_R/THETA_A/THETA_C (whatever the Python
router genuinely computed) reach the shadow evidence record, even though only
THETA_Q's result drives whether candidate generation happens.

## Which branches get real candidates? Which are persisted in shadow?

- **THETA_Q**: real candidate generation exists (`theta-shadow-cycle.ts:791-859`) and real economics/frontier/AEGIS/sizing follow, per the entry E2E graph.
- **THETA_C**: real candidate generation exists ONLY when stock is already held (`hasPotentialCoveredStock` gate in the same file).
- **THETA_H, THETA_D**: the router CAN and, given the right market conditions, DOES compute real `ELIGIBLE_CHALLENGER` results for these -- and that eligibility IS persisted in the shadow record -- but **no candidate generation exists downstream to act on that eligibility** (confirmed in the entry E2E graph: `theta-shadow-cycle.ts` never constructs a multi-leg spread or a distinct short-DTE lattice). This is the exact distinction the directive asked for: **the router is capable of representing Hold-Strike/Defined-Risk eligibility; Production does not act on that representation.**
- **THETA_R, THETA_A**: eligibility is real and persisted; whether real candidates follow depends on the management-side gaps already documented (`THETA_MANAGEMENT_END_TO_END_GRAPH.md` -- ROLL/ROLL_CC/SELL_CC blocked, everything else real).

## Not verified this pass (flagged as a follow-up, not silently assumed)

- The real value supplied for `policy.theta_d_gate_satisfied` at the actual Python bridge invocation site was not traced -- `theta_d_gate_satisfied` does not appear anywhere in the TypeScript contract file (`strategy-router-contract.ts`), meaning this policy parameter is constructed entirely on the Python side of the bridge, at a call site this pass did not locate.
- Whether `opportunity_frontier.py`/`management_action_value.py` (the modules this router explicitly defers ranking to) ever DO perform a cross-branch comparison was not independently verified this pass -- this deep trace only confirms the ROUTER itself does not rank, not that nothing downstream ever does. This is worth a dedicated follow-up read before fully closing `CROSS_STRATEGY_ECONOMIC_COMPARISON`'s status.
