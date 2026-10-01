# THETA_TODAY_PROGRESS_20261001_DEEP_AUDIT (partial, evidence-first)

Measured read-only at ~2026-10-01T18:10Z against the Production DB and the control-root worker. Items marked
NOT_AUDITED_THIS_PASS were not examined; they are not claimed as passing.

## Identity (verified)
main = origin/main = deployed = worker release = `c3d8868265426d870e50352b06d8d252c68a16c9`; exact-main CI run
36893883884 = success. Worker ONLINE, health fresh (85 s), SHA-aligned, 1 supervisor, execution gate LOCKED.
Host power: AC connected, battery 41% (earlier 75% on battery; now charging).
Command-5A health: 13,008 unresolved jobs, oldest overdue 79,679 s (pre-existing backlog), 62 maturation pending;
local research Parquet state DEFERRED_MARKET_CRITICAL (deferred, not zero). Fresh-subject priority NOT verified here.

## Session funnel (natural cycles 13:32Z-18:06Z, research.theta_runtime_behavior_diagnostic)
- Cycles: 47, all RISK_WAIT / SYSTEM_HOLD. Selected = 0. Candidate rows (sum over cycles) 52,008; feasible 4,943.
- Universe per cycle = 3 underlyings (IYM, KORU, SPY).
- Hard-gate totals: NOT_EVALUATED_SHORTLIST_BOUND 46,748 (by design: only finalists go to Q);
  AEGIS_HARD_VETO 128; Q_ACTION_INFEASIBLE 112; NOT_SENT_UPSTREAM_REJECT:CONTRACT_NOT_EXECUTABLE 77;
  VOLUME_BELOW_FLOOR 74; NO_ASSIGNMENT_CAPACITY 47; OPEN_INTEREST_BELOW_FLOOR 17;
  OWNERSHIP_ACCEPTABILITY_UNKNOWN 13; DELTA_OUTSIDE_ALL_BANDS 5; OPEN_INTEREST_UNKNOWN 3.
- Sizing binding: AEGIS_UNKNOWN 51,880 (= AEGIS not reached), UNDERLYING:UNDERLYING_SEVERELY_EXCEEDED 128
  (AEGIS reached), ROUTER_NOT_APPLICABLE 130,131 (non-Q branches).

## Reconciled contradictions
- SPY veto vs "AEGIS not run": not a contradiction. AEGIS ran candidate-specifically on Q-shortlisted SPY puts in
  all 47 cycles (e.g. cycle a0d7661f..., SPY261106P00715000; cycle a7905284..., SPY261030P00723000) and returned
  HARD_VETO via the UNDERLYING family (`bots/theta/quant/models/aegis.py` `_threshold_assessment`: ticker
  concentration >= soft cap x hard multiplier). One SPY cash-secured put (~$70k collateral) exceeds the per-ticker
  concentration cap on the paper account: a truthful capital-fit veto. The remaining 51,880 sizing rows are
  `AEGIS_UNKNOWN` = not reached; the label conflates "not reached" with "unavailable" (deferred diagnostic fix).
- KORU ownership UNKNOWN: required Q input (TRD UNIV-003; `theta_q_baseline.py` `_ownership_evaluation`, produced at
  `postgres-theta-cycle-store.ts:160`, value `orchestration.ownership.ownability`). Appears 13 times, KORU only.
  CORRECTION: it is not KORU-specific. In all 152 ownership evaluations in today's decision receipts, 4 of 5
  components are UNKNOWN (Liquidity, Structural, Recovery, EventAdjustment) and `ownability` is null for every
  underlying, including SPY. The count of 13 only reflects which candidates reached that Q reason first.

## Q diagnosis (what the data supports)
Dominant finalist-stage blockers are liquidity floors (volume 74, open interest 17+3) and contract executability (77),
not optional data. This points to a liquidity BOOTSTRAP_POLICY / market-suitability question, which is a calibration
research question. Sensitivity runs around volume/OI floors were NOT done; no Production threshold changed. Whether Q
is "too strict" is UNPROVEN either way.

## Maturity scorecard (current-release evidence only)
| Subsystem | Status |
|---|---|
| Database / schema / worker / supervisor | WORKING_CURRENT_RELEASE |
| Alpaca reconciliation / execution gate lock | WORKING_CURRENT_RELEASE |
| Contract enumeration, features, router, Q, AEGIS | PARTIALLY_REACHED (AEGIS only on shortlisted candidates) |
| H / D | RESEARCH_ONLY (not re-audited) |
| A / C | NOT_APPLICABLE on flat account (CC route reason NO_CONFIRMED_STOCK) |
| Sizing | PARTIALLY_REACHED (only where AEGIS ran; all qty 0) |
| Entry selection, execution, idempotency, profit/loss/roll/assignment/recovery management | WORKING_SOURCE_ONLY (no live position yet) |
| Paper autonomy transition | WORKING_SOURCE_ONLY (unit + real-DB test + CI; never exercised live) |
| Whole-chain accounting, replay, WAIT T0/archive, counterfactual learning | NOT_AUDITED_THIS_PASS |
| Command-5A | PARTIALLY_REACHED (large old backlog; fresh-subject priority unverified live) |
| Models, profitability, copy-trading, security sweep | EMPIRICALLY_UNPROVEN / NOT_AUDITED_THIS_PASS |

## Not done in this pass (explicit)
WAIT T0 capture and provider-free replay with tamper test; per-cycle latency/memory percentiles; 32-method/21-layer
and 20-feature-family recount; single-authority symbol census; old-incident regression matrix (41 items);
Q sensitivity runs; UNKNOWN taxonomy counts; FALSE_ZERO/FALSE_FALSE/FALSE_CLEAR source sweep; security sweep of
today's diffs. Counts for these are NOT reported (not zero).

## Paper canary
No Q-qualifying candidate in 47 natural cycles; canary not armed; ORDER_SUBMISSIONS=0; BROKER_MUTATIONS=0.
Live not ready. Profitability: INSUFFICIENT_EVIDENCE (0 Paper trades).

## ROOT CAUSE FINDING: Q is structurally unable to trade under the current Paper policy (evidence below)
1. Paper bootstrap (`src/theta/paper-entry-bootstrap.ts`, v3) accepts only EventAdjustment and RecoveryQuality as
   UNKNOWN ownership components. Any other unknown component -> `BOOTSTRAP_UNKNOWN_COMPONENT_SET_NOT_ALLOWED`.
2. StructuralQuality needs `relativeStrength`. `theta-shadow-cycle.ts:1969` supplies it (value 0, identity vs SPY)
   ONLY for instruments in the owner-approved manifest `paperInstrumentClassificationManifest`
   (`paper-entry-safety-policy.ts:27`), which contains exactly ONE entry: SPY. Every other underlying (IYM, KORU,
   ZSL...) gets `relativeStrength=null` -> StructuralQuality UNKNOWN -> bootstrap-ineligible.
3. SPY itself is the only bootstrap-eligible name, and AEGIS vetoes its minimum executable unit (one CSP ~ $70k
   collateral) on ticker concentration (state STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE semantics,
   `strategy-account-policy-compatibility.ts`: minimum unit >= soft cap x hardCapMultiplier).
Conclusion: with the current manifest + account size + concentration policy, NO policy-compliant CSP can reach
sizing > 0 on any approved underlying. This is a policy/config/account-fit fact, not a code defect and not a market
verdict. It cannot be changed autonomously: widening the manifest needs owner-approved issuer evidence for each
instrument, and changing concentration caps or account capital is a risk-policy change. Not changed.
Owner decision needed: (a) approve additional lower-priced optionable instruments with authority refs, and/or
(b) change paper account capital / concentration policy. Neither was done.

## Universe (why 3 underlyings)
Discovery funnel (latest cycle): 101 assets (`CLIENT_ASSET_BOUND_REACHED`, assetsTruncatedByBound=true) -> 100 after
exchange filter -> 72 with usable bars -> 10 optionability checks -> 9 optionable. Scan champions SPY, KORU, one
challenger (ZSL) with maximumAdditionalFullScans=1. Narrow by design (bounded scan); the 101-asset client bound is a
possible truncation risk for universe breadth and is queued for review (not changed today).
