# THETA profitability and closure review

## Scope and evidence

Baseline: `f8a3c118b97732f67a32935f23cbc0cc12a58986`. The new 70-page
A-to-Z master handoff was read completely, alongside the current pasted directive,
team charter, phased plan, and relevant implementation. This is not a claim that
every historical attachment was reread in this pass. Repository code and observed
runtime evidence take precedence over old completion statements.

The current Optionomics API reference, https://optionomics.ai/docs/api, describes
recorded/derived ingestion, session chain updates, and research rather than a
real-time execution feed. Broad field coverage does not prove executable freshness.
Keep the provider-neutral trusted quote interface, but do not qualify current
session-recorded responses for execution. No additional provider is introduced.

## Implemented correctness repairs

- Quote freshness checks provider, ingestion, and as-of timestamps. A refreshed
  wrapper cannot make an old quote eligible. Invalid age policies, empty contract
  identity, and provider timestamps after ingestion fail closed.
- Optionomics numeric parsing accepts finite numbers and decimal numeric strings.
  Blanks, booleans, objects, arrays, hexadecimal strings, and infinity remain null.
  Genuine zero and signed Greeks survive.
- The prospective management frontier no longer calls marked whole-chain P&L
  certain liquidation proceeds. Fill price and final costs are not known yet.

These repairs do not activate any execution gate or change strategy thresholds.

## Economic interpretation

Premium received is cashflow, not complete profit. For example, an old put opened
for $200 and closed for $350 realizes a $150 loss before costs. Opening the new put
for $180 with $15 total costs yields $15 cumulative net cashflow, but the new short
option liability remains. The handoff's roll example must not become a $15 profit
label before that liability is marked or resolved.

Economic P&L includes realized and unrealized options, realized and unrealized
stock, dividends, and actual costs. Do not count a prior stock mark again after
realizing the same gain/loss. Slippage already reflected in actual fill prices must
not be subtracted twice. Research simulations must declare how costs enter.

Forward management compares actions from the same current state and horizon.
Historical losses remain in the ledger but are not a reason to prefer a worse
future action. Expected action value requires defensible probabilities, outcomes,
costs, and uncertainty. UNKNOWN continuation EV is not zero utility.

Win rate alone cannot establish profitability. A 75% win rate with average win
$100 and average loss $400 has expectancy -$25 before costs. Effective independent
sample, tail losses, assignment burden, capital-days, calibration, and after-cost
OOS results remain required. Neither a professional trader nor THETA can know the
next market outcome with certainty.

## Six remaining workstreams

| Workstream | Completion evidence still required |
| --- | --- |
| R3 account foundations | Reverify master identity and independent follower credentials, tenant isolation and role safety in deployed use. |
| R4 follower completion | Real follower eligibility, sizing, skips, partial fills, reconciliation and follower-specific accounting. Master never waits for follower enrollment. |
| R6 empirical validation | Real PIT datasets, defensible labels, baseline/challenger ablations, independent OOS economics and calibration. |
| R7 autonomous Paper closure | Fresh executable quotes, qualified decision inputs, bounded repricing/TCA, full management integration and healthy reconciled worker. |
| R8 Paper lifecycle evidence | Actual fills, expiry/assignment/recovery/CC/roll outcomes, incident/restart evidence and whole-chain accounting. |
| R9 graduation | Economic, tail-risk, operational and cohort-stability proof. No live authorization is implied. |

R5 UI foundations are not the present bottleneck. No stack rewrite or new hosting
phase is justified by this review. Existing TypeScript/Node, PostgreSQL, Redis,
Python research interfaces and standalone frontend remain the architecture.

## Engineering gaps must not be labelled data-only

The management frontier enumerates actions but returns unknown utilities. Its
current feasibility checks are incomplete, including capacity semantics and full
execution/risk propagation. Action enumeration does not prove executable management.
The quote qualifier is a contract, not proof that all order paths consume a fresh
authenticated quote. Adaptive limit repricing and full transaction-cost capture
need end-to-end verification and missing implementation, not a global COMPLETE flag.

Further review is needed for management numeric coercion/default-zero behavior,
expiration session/DST semantics, and common-horizon utility integration. Do not
silently substitute generic thresholds or untrained predictions to close these gaps.

Priority: complete the management/execution data path, gather real shadow evidence,
validate simple baselines, then qualify Paper activation. Follower interfaces stay
preserved, but master research and operation must be independently runnable.

## Strictness and opportunity capture

Safety checks for identity, valid data, collateral, permissions, stale quotes,
unresolved broker drift and idempotency remain hard. RSI, IV, flow, trend and gamma
context are hypotheses or conditional features, not a requirement that all agree.
Persist evaluated universe, candidate counts, each rejection stage, best feasible
and best rejected candidates, alternatives, and unknown inputs. Assess gate regret
with defensible fill assumptions. A rejected candidate later rising is not proof
of a missed executable profit.

QuantWheel and Alertsify remain mechanism benchmarks. Their ratings, displayed
returns, or positive roll credits do not supply THETA probabilities. Reuse the
existing GitHub method ledger and experiment registry rather than duplicating them.

## Verification for this repair milestone

46 focused tests passed. Full Node: 698 tests, 694 passed, 4 local database skips,
0 failed. Python: 452 passed. TypeScript, ESLint, build and security scan passed,
with zero scan findings. No UI was changed, so Reticle/browser QA is not required
for these backend repairs. No migration or broker operation is part of this patch.
CI/deployment status must be reported separately after pushing.

ENGINEERING_COMPLETE = NO

BLOCKED_ONLY_ON_OPRA = NO

BLOCKED_ON_EMPIRICAL_EVIDENCE = YES

BLOCKED_ON_REAL_FOLLOWER = YES for follower validation, not master operation

READY_FOR_FIRST_PAPER_ORDER = NO

Orders submitted by this repair run: master Paper 0, follower Paper 0, live 0.
This is not a fresh audit of lifetime broker order counts.
