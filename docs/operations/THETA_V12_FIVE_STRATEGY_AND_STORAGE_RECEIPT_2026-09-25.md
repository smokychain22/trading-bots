# THETA V12 five-strategy and storage receipt

Date: 2026-09-25

Starting canonical SHA: `b53fc3042fde0882ea371339b793c41afe2008dd`

This receipt records engineering maturity. It does not claim profitability,
empirical validation, Paper authorization, or live-money authorization.

## Five-strategy reality

| Branch | Role | Engineering reality | Authority | Remaining dependency |
| --- | --- | --- | --- | --- |
| Q, Conventional | New risk | Real lattice, feasibility, AEGIS, sizing, canonical selection, locked single-leg plan, management and whole-chain linkage are runtime-reachable | Production-facing but execution locked | Current-release open-session proof and resolved empirical outcomes |
| H, Hold-Strike | New-risk challenger | Real 2-5 DTE candidate and shadow comparison path is runtime-reachable | Research-only | Independent real sessions, outcomes, OOS validation and promotion |
| D, Defined Risk | New-risk challenger | Real pair enumeration, two-leg Alpaca evidence, deterministic economics, bounded locked plan, persistence, and all 17 management replay challengers | Research-only, plan non-submittable | Live spread episodes, policy evidence, OOS validation, explicit promotion, and any future mutation adapter |
| A, Recovery | Inventory lifecycle | Broker-confirmed stock state can reach RECOVERY_WAIT, SELL_STOCK and SELL_CC through the canonical management authority | Lifecycle-only, locked | Broker-confirmed assigned inventory and forward outcomes |
| C, Covered Call | Inventory lifecycle | Broker-confirmed covered shares can reach HOLD_CC, CLOSE_CC, ROLL_CC and ALLOW_CALL_AWAY through the canonical management authority | Lifecycle-only, locked | Broker-confirmed covered inventory and forward outcomes |

`THETA_R` remains the one management route. It is not counted as a sixth
product strategy.

## Defined-risk closure

The D locked-plan producer retains exact leg identity and direction:

- short put: `SELL_TO_OPEN`
- lower-strike long put: `BUY_TO_OPEN`
- same expiry and multiplier
- exact BBO and provider/receipt timestamps for both legs
- conservative net-limit economics
- width, max profit, max loss, breakeven and capital requirement
- cycle, snapshot, AEGIS, sizing and provider lineage

The authenticated Alpaca Paper account reports options approval/trading level
3. Alpaca documents Level 3 as supporting atomic multi-leg `mleg` orders.
THETA records `ATOMIC_MULTI_LEG_SUPPORTED` for that account state. The plan
still records `runtimeMutationAdapter=NOT_IMPLEMENTED_RESEARCH_ONLY`,
`brokerAuthority=false`, and `submissionAllowed=false`. No order path was
added.

D management replay closes source-only gaps without inventing profitability.
It uses buy-short-at-ask and sell-long-at-bid close economics, explicit costs,
and all 17 canonical challenger policies. Missing, malformed, stale, or
unqualified leg evidence censors the replay. Expiration assessment preserves
assignment, long-leg protection, pin risk, max-loss state, and unknown input.

## Storage correction

Production PostgreSQL remains authoritative for the canonical frontier,
selected decision, broker state, lifecycle state, whole-chain accounting, and
audit receipts. Production no longer writes a second per-candidate relational
projection after persisting the same candidates inside the canonical frontier.

The Windows owner archives the frontier as follows:

```text
read-only canonical PostgreSQL frontier
-> immutable hash-verified local SQLite WAL
-> verified ZSTD Parquet
-> DuckDB read-back
```

The exporter rejects content-hash mismatches and secret-shaped payloads. New
frontiers require a hash reproducible from their persisted JSON. Historical
frontiers whose old hash included properties omitted by JSONB are accepted only
when the row hash equals the embedded immutable hash and are labeled
`LEGACY_EMBEDDED_HASH_MATCH`. Bounded exports report
`PARTIAL_LIMIT_REACHED` instead of pretending coverage is complete.

A real read-only Aiven proof archived one frontier containing 1,096 projected
candidate rows. SQLite verification passed. ZSTD Parquet creation, row-count
parity, payload hashes, and DuckDB read-back passed. The first compaction
attempt with a Python environment lacking DuckDB failed without changing the
pending SQLite batches, which proved fail-safe behavior. The verified retry
used the installed DuckDB runtime.

No existing Production row was deleted or pruned. The earlier verified 25,125
row archive remains preserved. Retention cleanup still requires exact archive
coverage and separate owner authorization.

## Verification

- TypeScript check: PASS
- Node tests: PASS, 2,264 passed, 14 skipped, 0 failed
- Python tests: PASS, 674 passed
- ESLint: PASS after final verification
- Production build: PASS
- Security scan: PASS, zero findings
- Python compactor syntax: PASS
- Authenticated Alpaca Paper reads: PASS, active account, level 3 options,
  zero positions, zero open orders, market closed
- Authenticated Optionomics readiness: PASS for the qualified research surface
- Broker mutations: 0
- Order submissions: 0

## Honest remaining states

- Current-worker proof of this release is required after exact CI and a safe
  locked single-worker cutover.
- Q/H/D/A/C outcome quality remains forward-data-dependent.
- Expected after-cost EV, calibrated POP, tail distributions, assignment
  probability, recovery time, and adaptive economic strategy switching remain
  empirically unproven.
- H and D need independent OOS evidence and explicit promotion before gaining
  Paper authority.
- A and C need real inventory lifecycle episodes.
- R8G first Paper canary remains owner-permission-required.
- Live money remains forbidden.

## Safety receipt

```text
ORDER_SUBMISSIONS = 0
BROKER_MUTATIONS = 0
MASTER_PAPER_EXECUTION_ENABLED = false
FOLLOWER_PAPER_EXECUTION_ENABLED = false
PAPER_PAUSE_NEW_ORDERS = true
FOLLOWERS = LOCKED
LIVE_MONEY = NOT_AUTHORIZED
PROFITABILITY = EMPIRICALLY_UNPROVEN
```
