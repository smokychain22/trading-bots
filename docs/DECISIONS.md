# Engineering decisions

## 2026-09-11: research references and incomplete valuation

Review the owner's fifteen GitHub repositories plus QuantLib and LEAN at
commit-pinned file scope. Preserve previous research under research/archive,
correct sign/units/license and implementation-readiness errors in the active
documents, and do not import external code or unvalidated strategy thresholds.

Version the pure ledger calculation as theta-ledger-runtime-v2. Unknown open
option valuation, stock mark or dividend entitlement reference makes the
corresponding aggregate and total null. Known realized components stay visible.
The only current consumers found are its tests, so no customer API, migration
or UI contract changes are required. This does not complete option valuation,
basis/premium reconciliation or full-H model calibration.

## 2026-09-09: standalone customer platform

The owner's latest instruction makes trading-bots a complete standalone website for the current development period. TradePilot integration is deferred. UI components and versioned public projections remain separate from the trading engine.

## 2026-09-09: preserve the working stack

Keep Node/TypeScript, Express and Vercel. Use static HTML, CSS and native ES modules for this small read-oriented interface. No new frontend framework or strategy rewrite is justified. Playwright and axe are development-only dependencies for browser, viewport and accessibility verification.

## 2026-09-09: honest data before customer claims

The published dataset contains truthful unavailable states. Illustrative performance is opt-in, deterministic and labeled DEMO DATA. No customer performance publisher, calibrated risk classification or minimum viable capital is invented. RESEARCH provenance is added for future bots without a backtest.

## 2026-09-09: simulation scope

Implement an educational cash-secured-put capital scenario, not an execution engine or historical simulator. Preferences prepare a future copy UX but remain unenforced and visibly unavailable for activation. Quantity zero is valid. The scenario has no broker calls.

## 2026-09-09: private owner surface

Reuse the existing operator credential for short-lived secure read-only sessions. Do not introduce a new secret or expose operational responses publicly. Full IAM, MFA, durable sessions and account-scoped copy controls are separate release work.

## 2026-09-09: deployment and coordination

Work in codex/standalone-platform from main b495436, preserve Claude's quant modules and the separate worktrees. The baseline production root already returns 200. An earlier missing-public-output failure was historical, so no unchanged broken redeploy is attempted. Explicit rewrites and CSP support the new standalone pages.

The owner's later authority permits tested main pushes, superseding earlier no-push language. Fetch and inspect overlap before integration. Never force-push.

## 2026-09-10: Phase 1.5 customer reconstruction

Keep every financial and provenance contract intact while simplifying the customer surface. Primary navigation is Overview, Bots, My Bots and Activity. Compare becomes contextual, while owner access remains a direct authenticated operator route. THETA receives a decision-first overview, an explicit available-for-exploration hierarchy, compact detail navigation and a progressive-disclosure simulation. Research bot cards remain available as a quiet roadmap only.

## 2026-09-10: automatic follower-copy authority boundary

THETA owns strategy and lifecycle decisions. Customers control account connection,
paper-capital allocation, stopping new entries, and disconnection. There are no
per-trade approvals or customer strategy overrides. Stop New Copies blocks new
entries while existing copied positions remain under THETA management. Disconnect
stops management and does not liquidate positions automatically.

The first copy-engine milestone is deterministic and non-executing. Stable copy
event and client order identifiers, follower-specific sizing, valid quantity zero,
partial-fill handling, and reconciliation-before-retry are implemented as contracts
and persistence constraints. Broker submission stays disabled until customer IAM,
OAuth state ownership, encrypted token references, runtime adapters, and PAPER chaos
tests are complete.

## 2026-09-10: split customer and owner information architecture

Customer navigation is Home, Bots, My Bots, Activity, and Account. THETA distinguishes
master strategy Performance from follower My Results. Customer position and history
views are read-only. The private owner surface uses five protected routes: Overview,
THETA, Trading, Copy, and System. The temporary shared operator token remains a
short-lived session bridge, not production IAM.

## 2026-09-10: separate master and follower Alpaca trust domains

The THETA master PAPER account continues to use deployment-managed Alpaca key and
secret references. Customer accounts use Alpaca Connect authorization-code OAuth with
env=paper. Customer raw keys are never accepted. OAuth state is random, hashed,
customer-bound, single-use, and expires after ten minutes. Access tokens use
AES-256-GCM with customer identity as authenticated data and remain server-side.

Customer identity uses a stable PostgreSQL UUID, salted scrypt password verification,
opaque hashed sessions, server-side tenant filters, and revocable HttpOnly cookies.
This first-party beta identity layer still needs rate limiting, verified email,
recovery, MFA, and security operations before a broad public release.

Saving a follower allocation creates a durable policy and READY participation record.
It does not mean COPYING or ACTIVE. The existing copy-event and follower-order-intent
contracts remain non-executing, and execution_authorized stays false.

## 2026-09-10: integrate Claude R1 without false runtime claims

Selected Claude R1 runtime contracts, provider input adapters, opportunity assembly,
hard gates, and decision assembly were integrated without replacing the current
customer UI or copy persistence. THETA remains
R1_INTEGRATED_INPUT_ASSEMBLY_BLOCKED. A production scheduler, real ownership, regime,
and event input assembly, plus persisted shadow decision receipts are required before
the owner UI may show SHADOW RUNNING.

The standalone Alpaca provider adapter, pagination, universe policy, point-in-time
features, and freshness gates passed integration review and were kept. The proposed
one-shot shadow runner was not merged because it still contains synthetic operational
defaults, converts a missing entry bid to zero, lacks live Optionomics and event-state
inputs, and does not persist receipts. Those are correctness blockers, not reasons to
label a partial cycle as running.

## 2026-09-10: Alpaca Connect policy and PAPER beta boundary

Use deployment-managed key authentication only for the platform's own master PAPER
account. Customer or follower accounts use Alpaca Connect OAuth. The exact requested
scope is `trading`. The `data` scope is omitted until a customer-specific Data API need
is proven. The current public Connect documentation requires OAuth 2.0 for API clients,
so follower raw-key input is prohibited. Migration 007 encodes the only accepted
connection method as `ALPACA_OAUTH`.

THETA's core cash-secured-put and covered-call operations require Alpaca options level
1. Level 0 is blocked. Levels 1 through 3 pass this capability gate. Approval and
trading levels are retained separately rather than collapsed into one value.

## 2026-09-10: database connection roles

Use `DATABASE_URL` for transaction-pooled serverless runtime access. Use
`DATABASE_MIGRATION_URL` for a direct or session-pooled migration connection. Do not
run DDL that depends on session semantics through transaction pooling. Production
readiness remains `MISSING` or `MIGRATION_REQUIRED` until the real database is reachable
and migration `007_connection_readiness` is present.

## 2026-09-11: canonical PAPER broker and order-intent boundary

Use one `PaperBrokerAdapter` contract for the master API-key account and follower OAuth
accounts. Authentication differs, while order construction, state transitions,
reconciliation, and lifecycle accounting remain shared. The adapter rejects every host
except `paper-api.alpaca.markets`.

Every order is a DAY limit order with a caller-supplied deterministic
`client_order_id`. A roll is two separately persisted intents, close old and open new.
Each reprice also receives a new intent and client identity, preserving the current
order-to-broker-order cardinality and the old economic result. Covered calls require
confirmed share coverage before payload construction.

`MASTER_PAPER_EXECUTION_ENABLED` and `FOLLOWER_PAPER_EXECUTION_ENABLED` default false.
`PAPER_PAUSE_NEW_ORDERS` defaults true. A missing or blank variable stays fail-closed.
The customer cannot change these controls. Network ambiguity transitions to
`UNKNOWN_SUBMISSION`, then broker lookup by `client_order_id`. Absence at lookup remains
`RECONCILING` and never causes an automatic resubmit.

The first real PAPER order remains outside this milestone. It requires a genuine
provider-backed decision preview, durable production PostgreSQL, real account
verification, an active reconciliation worker, rotated credentials, and separate owner
authorization.

## 2026-09-11: owner-authorized private team Paper credential bridge

The owner explicitly authorized a temporary private-team connection method while the
public product continues toward Alpaca OAuth. Authenticated testers may connect their
own Alpaca Paper API key through `PAPER_API_KEY_PRIVATE_BETA`. The server pins every
request to `https://paper-api.alpaca.markets`, verifies account, options, positions,
open orders, and clock through read-only calls, and stores only customer-bound
AES-256-GCM ciphertext. The browser receives no secret or full key. OAuth remains
`ALPACA_OAUTH`, and both resolve through one `BrokerCredentialProvider` boundary.

This decision does not change execution authority. Customer order submission remains
locked. Public production should use OAuth after Alpaca Connect approval, and the
private bridge can then be disabled without changing THETA or copy-engine contracts.

## 2026-09-11: provider provenance and runtime-defer separation

Provider observation origin and data quality are independent facts. A successful
provider response with required truth absent is `REAL_PROVIDER_UNKNOWN`. A failed
real call is `REAL_PROVIDER_ERROR`, which can never count toward `FULL_REAL`.
Deterministic features computed exclusively from real observations may use
`DERIVED_FROM_REAL`. Fixtures, caller input, and paths not executed remain distinct.

Transport failures such as timeouts, HTTP 5xx, and exhausted rate limits map to a
transient capability state and `SYSTEM_HOLD`. They are not economic `PASS`, strategy
`WAIT`, or risk `HARD_VETO` outcomes. Invalid authentication, malformed required
truth, and required missing entitlement remain genuine fail-closed `HARD_VETO`
conditions. This preserves clean provider reliability, opportunity, and risk-veto
statistics while keeping quantity zero and execution authorization false.

## 2026-09-11: Neon migration authority and private-beta production boundary

Use Neon `DATABASE_URL` for pooled serverless runtime requests. Migration tooling must
prefer `DATABASE_MIGRATION_URL`, `DATABASE_URL_UNPOOLED`, or
`POSTGRES_URL_NON_POOLING`, in that order. Migrations run under a PostgreSQL advisory
lock and remain idempotent. Vercel's local environment pull masks connected-integration
Sensitive values, so a masked local placeholder must never be diagnosed as a bad Neon
credential or passed to a migration.

The Production schema is now at migrations 001 through 009 and passed all repository SQL
invariants. Identity, session, encrypted credential, follower, participation, immutable
decision, lifecycle, order-intent, and reconciliation structures are present. Broker
order count remains zero.

The platform master Alpaca deployment credential remains a separate trust domain from a
customer private-beta credential. It may verify the master account read-only, but it must
not be copied into a customer record to manufacture an end-to-end tester result. A real
tester must enter their own Paper API key and secret through the HTTPS account form.
Customer order submission remains locked independently of successful account connection.

## 2026-09-11: tester identity return paths and connection-health semantics

Customer authentication and Alpaca authorization remain separate steps. The server
accepts only a small allowlist of internal post-authentication paths and returns
`/account` for every external, protocol-relative, query-bearing, or unknown value.
This lets Copy THETA resume at `/bots/theta/copy` without creating an open redirect.

A transient Alpaca network, rate-limit, or provider failure does not invalidate or
replace a previously verified encrypted credential. Only a confirmed authentication
rejection marks that connection as needing attention. Replacement credentials are
still verified before the encrypted record is changed. All Paper order submission
gates remain locked.

## 2026-09-11: clock plus calendar required for an open-session shadow scan

One captured decision timestamp anchors a complete shadow cycle and its FusionSnapshot.
The Alpaca clock and calendar are separate evidence sources. When the clock reports an
open market, the cycle must also find the dated exchange session with known open and
close times. Missing, malformed, or unavailable calendar truth returns
`SYSTEM_HOLD/MARKET_SESSION_UNCONFIRMED`. A confirmed closed clock still returns
`SYSTEM_HOLD/MARKET_CLOSED`. Neither state can authorize execution.

## 2026-09-11: selective R1 temporal and AEGIS integration

Provider reads in one THETA cycle share a canonical decision timestamp, while each
read also records its own local request timestamp. This preserves deterministic
snapshot and receipt identity without hiding a slow acquisition sequence from the
temporal-consistency policy.

AEGIS evidence remains three-valued. An empty required-capability set is unknown,
not healthy. A contract with missing bid, ask, timestamp, or quality evidence is also
unknown for execution quality. `false` is reserved for a fully observed failure.

Pending-order collateral and assignment capacity must consume explicit position
intents. They cannot infer `SELL_TO_OPEN` from order side and current holdings. Cross-
symbol routing must use after-cost economics and risk constraints, not raw premium or
an incorrectly scaled premium-to-collateral proxy.

## 2026-09-11: autonomous PAPER runtime starts with broker truth

The first deployed THETA worker slice is a short-lived, authenticated serverless cycle,
not a resident process. Each invocation and job writes durable lease, heartbeat,
attempt, result, version, and correlation evidence to PostgreSQL. The fixed priority is
broker reconciliation, ambiguous-order recovery, existing-position management,
assignment/expiration reconciliation, pending-order management, WAIT rechecks, then new
risk. Failed jobs become eligible for bounded retry at their persisted next-eligible
time. An expired lease is reconciled before any retry.

The worker uses only the designated encrypted `MASTER_THETA_PAPER` credential and the
exact `paper-api.alpaca.markets` host. It reads account, positions, orders, activities,
clock, and calendar. Facts that cannot be matched to THETA intent are stored as
`EXTERNAL_OR_UNKNOWN` and excluded from strategy evidence until resolved. Order
submission, replacement, cancellation, follower fan-out, and live trading remain
locked. The worker must report a degraded state while production quant input assembly
is unavailable instead of fabricating an opportunity.

Historical replay inputs and outcome labels are stored in separate append-only tables.
Provider timestamps cannot exceed the observation as-of time, and an outcome label
cannot predate its observation. The historical-data audit does not approve a new
provider. Alpaca remains executable truth and Optionomics remains research
intelligence until coverage and entitlement tests prove a specific gap.

The canonical Vercel project rejected a per-minute cron at deployment and linked the
failure to its cron plan limits. The unsupported schedule was removed immediately so
the customer site can deploy. A once-daily Hobby cron is not an acceptable substitute
for time-sensitive reconciliation or management. The authenticated worker endpoint
remains deployable but disabled. Timely autonomous invocation requires an owner-approved
Vercel Pro upgrade or a separately approved worker host, plus a strong `CRON_SECRET`.

Claude R6 commits `4c8fe61`, `4ea86c5`, `b277ca0`, `424a54b`, `0a4efb4`, and
`f182aa0` were reviewed independently and were not integrated in this milestone.
Material blockers include a variance-versus-standard-deviation error in the DSR hurdle,
unpaired ablation statistics for a paired baseline comparison, a midpoint-based
structural fill price, a zero-correlation lookup bug, drawdown recovery requiring a new
high instead of recovery to the prior peak, and a walk-forward contract that lacks both
decision time and label-availability time. The production baseline is preserved until
those issues are corrected and retested.

Claude commit `7f3f610` was integrated as a research-only GEX definition matrix. It
does not enable GEX, choose a zero-gamma definition, alter AEGIS, or create a trading
signal. Its reference to the rejected ablation implementation was replaced with the
canonical pre-registered baseline-versus-feature promotion requirement.

## 2026-09-11: execution quality is position-intent aware

The execution-quality boundary is versioned to v2 and requires one of the four explicit
option intents. Buy intents measure the remaining concession toward the ask and become
more fillable as their limit approaches the ask. Sell intents measure the remaining
concession toward the bid and become more fillable as their limit approaches the bid.
Midpoint remains context only and is never executable truth. THETA-Q CSP entry supplies
`SELL_TO_OPEN` explicitly rather than relying on a side default.

Provider analytics are isolated by contract at ingestion. A non-finite IV becomes
UNKNOWN for that contract while valid sibling contracts remain usable. A contract at
T=0 or earlier is non-executable, while later expiries in the same batch are evaluated
independently. THETA does not currently solve IV internally, so impossible-price and
solver-convergence cases do not exist in the Production path and must not be presented
as tested capabilities.

## 2026-09-12: defer hosting and finish the host-independent THETA boundary

`EXTERNAL_WORKER_HOST_DEFERRED_UNTIL_PAPER_READINESS` is intentional. Vercel remains
the customer control plane. No permanent scheduler host, paid plan, or cloud-specific
worker API is selected in this phase.

The resident worker is a generic Docker target with Node, Python, health/readiness,
graceful termination, database/Python startup checks, non-overlapping cycles, and
PostgreSQL lease-based restart recovery. It refuses to start unless every broker
submission control is locked. A separate image target preserves the web control plane.

The first Paper order boundary now has a deterministic receipt. Every required value
carries an evidence state and source. UNKNOWN, STALE, INVALID, or NOT_ENTITLED creates
a named blocker. The receipt checks the exact Paper host and master role, CSP intent,
provider multiplier, collateral identity, Alpaca BBO, quote age, empirically ready
positive after-cost economics, tail evidence, AEGIS quantity, durable IDs, idempotency,
persistence, scheduler, reconciliation, and the final pre-POST lock. A valid receipt
still submits zero orders.

## 2026-09-12: management decisions use frontiers, not indicator unanimity

New-risk and management evidence is split into mechanical hard gates and soft evidence.
Technical indicators, volatility context, flow, ownership, and regime normally change
rank, uncertainty, size, or branch choice. They do not independently veto a candidate.
A global WAIT is valid only after all currently eligible underlyings and validated
branches, existing management, recovery, covered-call, and redeployment surfaces were
evaluated.

Open-chain management inputs are projected from persisted broker, account, quote,
FusionSnapshot, and economic-ledger facts. Missing values remain explicit. The action
frontier is complete for CSP, stock recovery, and covered-call states, while action EV,
tail estimates, capital-days, and utilities remain null until empirical models qualify.
No fixed take-profit percentage becomes production policy by default.

Broker-confirmed lifecycle applications use one PostgreSQL transaction and one hashed
evidence key. Assignment, expiry, close, roll, covered-call open/close, call-away, and
stock disposal cannot leave a partially updated chain. Option-leg realized losses remain
immutable and every roll opens a separate linked leg.

Broker reconciliation now persists a complete immutable position set for each read and
hashed activity facts for lifecycle evidence. Assignment, expiration, and call-away
classification requires matching broker activity and consistent position movement.
Moneyness or a missing option position alone cannot mutate a chain.

## 2026-09-12: one strategy package, five business branches, zero executable branches

The existing Q/H/R/A/C/D Python router remains the only applicability engine. The
customer and strategy package use five business branches. Q maps to conventional, H to
Hold Strike, A to recovery, C to covered call, and D to defined risk. R remains a
management route over the active lifecycle branch, so it does not create a duplicate
sixth strategy.

Resolved strategy configs are strict, immutable, and SHA-256 identified. Research-only
or unpromoted configs cannot enable execution. The current conventional 25 to 60 DTE
and 0.10 to 0.40 delta lattice is a research enumeration range, not a profitability
claim or universal rule. All five branches remain non-executable because after-cost EV
and action-value distributions have not been empirically calibrated.

Underlying ranking uses a Pareto contract across versioned normalized inputs. It does
not hide arbitrary weights. Missing soft inputs stay UNKNOWN. New-risk assembly now
requires known positive EV and return per capital day, and an absent Alpaca bid can no
longer cross the Node-to-Python boundary as zero.

Broker assignment and expiration classification can now call the atomic lifecycle
writer through a confirmed-evidence-only bridge. UNKNOWN or INVALID evidence cannot
reach persistence, and the writer still validates stored multiplier, quantity, P&L,
chain state, and replay identity. Other management actions remain behind their existing
explicit atomic application APIs until an empirical policy and always-on worker exist.

Vercel's exact downloaded redaction marker `[SENSITIVE]` is ignored by the dotenv file
loader. It cannot override a real process value or pass validation as a credential or
boolean flag. Standard dotenv parsing still owns quote removal, and arbitrary secret
values are never modified.

## 2026-09-12: Production shadow capture is a broker-read-only runtime

`THETA_RUNTIME_MODE` has one accepted value, `THETA_SHADOW_ONLY`. The autonomous
runtime receives a frozen broker interface that exposes account, positions, open orders,
activities, clock, calendar, assets, contracts, bars, and snapshots. Submit, replace,
cancel, exercise, and do-not-exercise operations do not exist on that interface.

The SHADOW bot context is resolved from exactly one database-designated
`MASTER_THETA_PAPER` account and an exact broker-account identity match. Its strategy,
feature, risk, execution, and cost records are immutable, hash-checked, unvalidated
research versions. A semantic-version/hash mismatch fails closed. The credential column
contains only a reference to the existing encrypted token row.

Replay observations use the option type stored on the exact contract. Their IDs derive
from the observation job, making provider retries idempotent. Missing observations become
explicit missed evidence and never implied fills. A closed economic chain with no option,
stock, or fee facts cannot produce a zero-PnL outcome label.

## 2026-09-12: empirical evidence is a separate immutable production concern

Candidate features, resolved outcomes, quote replay observations, and dataset identities
live in separate tables. A recursive boundary check rejects outcome-label names from
feature payloads. Each candidate records exact contract identity, decision BBO, provider
and ingestion times, null-preserving feature families, blockers, rank, selection state,
and all strategy, risk, feature, cost, regime, and execution versions.

The current single-underlying shadow cycle cannot earn a global WAIT when other eligible
underlyings, management actions, recovery, covered-call, or redeployment surfaces remain
unevaluated. The evidence row records those omissions and marks the WAIT unearned. No
soft RSI, IV, flow, trend, or momentum observation can stand in for exhaustive search.

Dataset exports are bounded, deterministically ordered, schema-versioned, and SHA-256
identified. Outcome labels remain in their own export section. Counterfactual records
remain `BLOCKED_ON_DATA` until a defensible fill and outcome method exists.

Runtime priority is reconciliation, broker lifecycle application, open-position review,
portfolio risk, then new-risk discovery. Existing breaches require `MANAGEMENT_FIRST`.
Unknown pre-existing risk produces a system hold. Broker FILL activities are persisted
idempotently as immutable fill facts. Assignment and expiration reach the atomic writer
only when consecutive position snapshots and broker activity agree.

## 2026-09-12: local shadow supervision keeps Production secrets in Vercel

The Windows laptop runs one pinned Task Scheduler supervisor that calls the authenticated
Production shadow endpoint once per minute. The laptop stores only an ignored random
trigger token. Alpaca, Optionomics, encryption, and Neon credentials stay in Vercel.
Neon owns the singleton lease, heartbeat, cycle state, resume gaps, and immutable runtime
events. A current local lease blocks competing manual Production cycles. The supervisor
is pinned to a clean `origin/main` SHA and all execution gates remain locked.

## 2026-09-12: follower plans require confirmed master evidence

The disabled copy planner accepts only a real master fill or broker-confirmed lifecycle
activity. Order-producing master actions require a fill. Rolls must arrive as explicit
close-old and open-new events, with lineage, rather than one opaque roll event. Every
follower is checked against its own active account, policy, capital, assignment capacity,
concentration, BBO, and freshness evidence. Quantity zero remains valid. Persisted
follower order intents are `PLANNED` with `execution_authorized=false`, and no broker
submission surface is called.

## 2026-09-12: disabled copy-engine closure and Paper preflight boundary

The disabled R4 engine records master events only after a broker-confirmed fill or
lifecycle activity. Roll close and open legs are separate events with explicit
lineage. Every follower plan is tenant-bound, uses the follower's own current BBO
and capacity, and remains `EXECUTION_DISABLED`. A persistent chain-participation
ledger prevents a follower that skipped entry from receiving later lifecycle actions.
Assignment, expiration, and call-away require that follower's own broker activity.

Follower price deterioration is cashflow-direction aware. Less credit is adverse
for credit orders, while more debit is adverse for debit orders. Missing capacity,
multiplier, execution economics, or fresh quote evidence blocks the plan instead of
increasing size. Zero remains a valid result.

R7 now has a deterministic dry-run preflight that constructs the exact Alpaca limit
request and request hash but has no broker adapter and cannot submit a network call.
The current empirical values remain UNKNOWN, owner authorization remains not granted,
and `READY_FOR_FIRST_PAPER_ORDER` remains NO.

## 2026-09-12: first-session proof reports evidence, including a valid empty result

A bounded cross-symbol scan is complete when every in-scope symbol finishes contract,
quote, and strategy evaluation. Candidate count does not determine completeness. A
complete zero-candidate scan is valid evidence and can support an explained global WAIT.

R6 readiness now reports separate engineering and evidence states for execution replay
and outcome resolution. The first-session watchdog derives one of the canonical proof
states from immutable scan members and the latest worker health. Closed-market cycles do
not become scans. Historical option bars, trades, and public analytics documentation do
not establish this account's BBO entitlement, so no historical execution adapter is
enabled before an exact secure entitlement test succeeds.

## 2026-09-12: historical R6 evidence stays live-shadow-first

The encrypted Production master credential now drives a one-shot, authenticated,
read-only entitlement audit. Actual checks proved historical stock bars, historical
option bars, historical option trades, current indicative snapshots/Greeks, contracts,
and corporate actions. OPRA returned 403 `NOT_ENTITLED`. Alpaca's documented options
inventory has no historical quote/BBO or historical Greeks REST operation.

Historical bars and prints are not enough to reconstruct an executable decision-time
BBO or point-in-time Greeks. No historical option adapter will be built from them. The
existing live-shadow evidence path remains primary. Optionomics current metrics, chain,
history, flow, and events authenticated successfully, but undocumented date-aware option
analytics and three-horizon crowd trajectories remain `UNVERIFIED`.

The capability audit writes only sanitized metadata to the existing provider capability
and operation registries. It does not create an order surface. R6 remains
`BLOCKED_ON_DATA` until real open-session candidate sets, follow-up quotes, and outcomes
exist.

## 2026-09-12: Optionomics context is captured without becoming a trading rule

Authenticated read-only checks proved the documented dated metrics, option chain, flow,
and event contracts. THETA will use them only as historical or live research context.
Historical execution remains blocked because no tested provider contract supplies a
decision-time historical option BBO and Greeks together.

The existing Optionomics adapter now captures 8h, 24h, and 48h net-flow windows during a
shadow decision cycle. The immutable FusionSnapshot retains the provider points and exact
query bounds. Candidate evidence retains a compact view and the snapshot link. The runtime
does not infer bullishness, bearishness, aggressor side, opening or closing intent, or
trader profitability. Any crowd-direction feature must pass the empirical champion versus
challenger pipeline before it can influence policy.

The existing Windows supervisor runs the empirical pipeline once per new deterministic
dataset hash. Research output cannot mutate Production strategy, unlock execution, or
submit an order.
# 2026-09-12: Virtual shadow execution is separate from broker truth

Real-market shadow intents, inferred fills, positions, and account snapshots live under `research.theta_shadow_*`. They do not enter `trade.broker_order`, `trade.fill`, or broker-confirmed economic-chain tables. A virtual fill requires a later observed price-through and displayed size. A simple touch and midpoint are insufficient. Unknown costs keep after-cost account economics null. This preserves provenance while the strategy remains non-executable.
