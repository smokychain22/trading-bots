# THETA system completion matrix

As of 2026-09-15. This is an implementation audit, not a profitability claim.
`COMPLETE` means the named path is wired and tested. It does not mean the
strategy has empirical edge. `BLOCKED_EXTERNAL` identifies proof that cannot be
created inside the repository.

## Canonical integration graph

```text
local always-on worker
  -> protected Production runtime
  -> resolve encrypted MASTER_THETA_PAPER credential
  -> Alpaca read-only reconciliation
  -> broker lifecycle classifier -> atomic economic writer
  -> management-first review
  -> market-session gate
  -> real universe discovery
  -> Alpaca contracts + indicative research snapshots
  -> Optionomics intelligence attempt
  -> FusionSnapshot + candidate/frontier/WAIT evidence
  -> canonical persisted decision
  -> immutable WAIT-paralysis / overtrading diagnostic
  -> bounded Paper evidence action-plan assembly
  -> durable action-plan queue
  -> fresh execution-quote qualification
  -> durable order intent + deterministic client_order_id
  -> Alpaca Paper submission
  -> reconciliation -> fill/lifecycle/accounting
```

The graph stops at execution-quote qualification today. Alpaca OPRA returned
HTTP 403 `NOT_ENTITLED` during an open session. Optionomics authenticated
developer requests returned HTTP 401. Indicative quotes remain research-only.

## Runtime and backend matrix

| Area | State | Runtime connection and evidence | Remaining gap |
|---|---|---|---|
| Master identity and encrypted credentials | COMPLETE | Role-scoped encrypted credential resolver and exact broker-identity check | None known |
| Reconciliation before decisions | COMPLETE | First scheduled jobs are position and order reconciliation | None known |
| Broker lifecycle classification | COMPLETE | Broker evidence feeds the replay-safe atomic lifecycle writer | More real Paper lifecycle observations are needed |
| Management-first ordering | COMPLETE | Open-position review precedes new-risk discovery | Empirical management utility remains UNKNOWN |
| Dynamic profit-preservation evidence | COMPLETE engineering, SHADOW only | Each open option chain records capture ratio, peak-since-capture, giveback, remaining reward, capital-days, all management alternatives, fixed/dynamic challenger dispositions, event-state change, and strategy-switch cost gaps | Forward HOLD value, tail risk, execution cost, redeployment EV, flow acceleration/reversal, and resolved labels remain empirical/provider gaps. No challenger can execute |
| Market clock and calendar | COMPLETE | Both are required before an open-session scan | None known |
| Point-in-time FusionSnapshot | COMPLETE | Immutable content hash and version lineage persisted | Optionomics families remain unavailable while auth fails |
| Optionomics temporal evidence | COMPLETE engineering, dormant on auth failure | Consecutive compatible feature snapshots produce immutable research-only deltas for volatility, skew, term structure, and exposure. Source snapshots, elapsed time, units, method/policy version, missing reason, and content hash are retained | Needs authenticated repeated market-session observations and later OOS ablation. It is never execution authority |
| Options-chain decision intelligence | COMPLETE engineering, RESEARCH only | Migration 043 stores exact chain observations, expiry and strike/delta ladders, liquidity evidence, five-branch structure comparisons plus WAIT, scoped Optionomics attachments, explanation receipts, and empty counterfactual label contracts in the atomic cycle | Needs authenticated chain intelligence, resolved labels, execution replay, and OOS ablation before any policy promotion |
| Candidate and WAIT evidence | COMPLETE engineering | THETA-Q PIT rows plus immutable relational branch/candidate evidence for all five canonical branches. Multi-leg Defined Risk structures and quantity-zero Recovery actions retain their native shapes. The deterministic research export nests both projections under each canonical frontier | Real market-session observations and resolved outcomes are still needed |
| WAIT-paralysis and overtrading diagnostics | COMPLETE | Every completed Production scan persists causal WAIT class, funnel counts, consecutive WAITs, last broker-action age, near misses, AEGIS/quantity blocks and action-plan multiplicity. The operator API exposes the latest sanitized record | Outcome-based false-reject rates and calibrated activity limits require resolved episodes |
| Canonical decision | COMPLETE | One versioned cross-branch authority is stored with receipt | Research-only structural winners intentionally cannot execute |
| Decision to action-plan handoff | COMPLETE engineering | New-risk and management authorities publish distinct typed plans. Close, stock exit, CC entry/close, and two-leg CSP/CC rolls are compiled from immutable authority. Roll-open remains blocked until the close intent is broker-confirmed FILLED | Production has no empirically promoted management-policy provider configured, so it remains passive outside exact no-order expiration outcomes |
| Action-plan restart safety | COMPLETE | Claimed plans lease, retry, quarantine, and expire durably | None known |
| Execution quote | BLOCKED_EXTERNAL | Alpaca OPRA and Optionomics qualified two-sided paths are implemented | OPRA entitlement or successful Optionomics auth and quote proof |
| Paper order intent | COMPLETE but externally gated | Durable intent precedes broker mutation, deterministic idempotency | No real submission until quote gate passes |
| Partial fills and ambiguous submission | COMPLETE | Partial state is preserved and ambiguous submission reconciles before retry | Needs real Paper evidence |
| CSP and CC rolls | COMPLETE engineering | Close-old and open-new are distinct durable plans. The open leg depends on the close plan's linked order intent reaching broker-confirmed FILLED, and its quantity cannot exceed the confirmed close plan | Needs real Paper lifecycle evidence after execution qualification |
| Assignment, expiry, call-away | COMPLETE classifier/writer | Exact broker evidence and position deltas required | Needs real Paper lifecycle evidence |
| Whole-chain accounting | COMPLETE mechanics | Multiplier-correct immutable realized loss and stock/option lineage | Needs resolved real Paper episodes |
| Copy planning | COMPLETE, submission locked | Master-fill-first follower-specific planning and skip evidence exist | R3/R4 follower submission intentionally deferred |
| Live trading | FORBIDDEN | Live hosts and authorization tiers are rejected at repeated boundaries | No change authorized |

## Previously disconnected code found and corrected

1. `trade.master_paper_action_plan` had a complete durable consumer but no
   production producer. The Production evidence scan now assembles a plan only
   from its own canonical persisted decision and exact selected contract.
2. Canonical THETA Conventional IDs and THETA-Q candidate IDs used different
   names for the same contract. Persistence now records the canonical alias so
   a selected executable branch cannot silently lose its candidate foreign key.
3. Expired plans could remain retryable and repeatedly win oldest-first claims.
   Claiming now quarantines expired decisions and records an immutable event.
4. Paper evidence economics now preserve empirical EV as `null`. A transparent
   multiplier-correct modeled-cost floor is used only as a structural minimum
   credit boundary. It is never reported as expected profitability.
5. Cycle-level WAIT and activity behavior was previously reconstructable only
   by joining several tables. The runtime now writes one immutable causal
   diagnostic after every scan. No arbitrary trade-frequency threshold is
   embedded. Multiple plans from one scan are surfaced explicitly instead of
   being hidden as ordinary activity.
6. Cross-branch candidates were previously available only inside the canonical
   frontier JSON, while the older relational PIT projection covered the
   Conventional path. Migration 039 adds immutable branch and candidate
   projections for Hold-Strike, Defined Risk, Recovery, and Covered Call
   without coercing multi-leg or stock actions into a single-option row.

## R1 through R9 state

| Phase | State | Evidence required to close |
|---|---|---|
| R1 provider and broker truth | PARTIAL | Optionomics Production authentication and quote semantics |
| R2 lifecycle, persistence and accounting | PARTIAL | Real Paper lifecycle observations and empirically validated active management decisions |
| R3 follower account foundation | COMPLETE engineering | Real multi-tenant beta validation |
| R4 follower copy execution | LOCKED | Master strategy proof and explicit later activation |
| R5 customer product | FUNCTIONAL, not current bottleneck | Real evidence must replace unavailable metrics over time |
| R6 empirical research | DATA CONTRACT READY, evidence insufficient | Dataset v3 exports exact options-chain decisions. Sufficient independent point-in-time candidates and resolved labels are still required |
| R7 Paper autonomy | BLOCKED_EXTERNAL | Fresh trusted two-sided execution quote |
| R8 Paper validation | NOT STARTED | First genuine Paper lifecycle |
| R9 graduation | NOT READY | OOS economics, risk, execution, reliability and effective N |

## Current evidence verdict

```text
EV_MODEL_NOT_EMPIRICALLY_READY = YES
PRODUCTION_ACTIVE_MANAGEMENT_POLICY = NOT_EMPIRICALLY_PROMOTED
OPTIONOMICS_PRODUCTION_AUTH = FAIL_401_UNAUTHORIZED
ALPACA_OPRA = NOT_ENTITLED_HTTP_403
INDICATIVE_OPTION_DATA = RESEARCH_ONLY
READY_FOR_FIRST_PAPER_ORDER = NO
FOLLOWER_SUBMISSION = LOCKED
LIVE_TRADING = FORBIDDEN
```

No code change, competitor claim, structural premium, win rate, or historical
backtest can turn those external and empirical gaps into a passing receipt.
