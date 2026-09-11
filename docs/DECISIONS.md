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
