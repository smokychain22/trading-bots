# Engineering decisions

## 2026-09-17: Paper indicative pricing and control locks have distinct semantics

- Use fresh exact-contract Alpaca Basic `feed=indicative` bid and ask observations as `PAPER_INDICATIVE_REFERENCE` for the dedicated master Paper account.
- Never label that feed OPRA, consolidated, or NBBO. It is forbidden for live execution and cannot unlock followers.
- Refresh the sanitized qualification receipt once per open market session. Provider timestamps, exact OCC identity, uncrossed two-sided prices, sizes, and quote age remain mandatory.
- Report `EXTERNAL_QUOTE_BLOCKER` only when no qualified Paper pricing authority exists. Report `LOCKED` when pricing exists but owner, runtime, emergency, empirical, or single-canary controls prevent new risk.
- Allow at most one first-canary broker order. Once any broker order is persisted, new-risk submission locks automatically while reconciliation and management keep running.

## 2026-09-17: split first-canary bootstrap management from empirical promotion

- Use `PAPER_BOOTSTRAP_MANAGEMENT_POLICY` for bounded first-canary lifecycle safety.
- Keep `EMPIRICALLY_PROMOTED_MANAGEMENT_POLICY` as a separate authority that still requires PIT, OOS, calibration, and governance evidence.
- The bootstrap policy may hold, defer to broker-confirmed expiration transitions, and close current exposure when AEGIS issues a hard veto and executable state is complete.
- The bootstrap policy cannot roll, redeploy, sell a covered call, increase size, claim positive EV, or claim empirical profitability.
- Require a provider observation timestamp for execution-price freshness. HTTP receipt time cannot refresh an old or untimestamped quote.
- Keep Alpaca Basic option quotes in the explicit `INDICATIVE` semantic class.

## 2026-09-15: P2C uses a separate immutable outcome side

- Preserve P2B snapshots byte-for-byte and resolve future observations into separate subjects, observations, receipts, and labels.
- Advance the deterministic research export to `theta-r6-dataset-v4` because resolved label-side relations are new research row families.
- Treat midpoint as a market mark only. Modeled execution identifies its fill model and cannot claim broker-actual provenance.
- Keep the Production management policy provider unavailable unless a complete empirical receipt and an explicit, hash-verified governance promotion both exist.
- Every P2C relation is immutable. Resolved labels, challenger evaluations, and the provider adapter cannot authorize execution or self-promote.

## 2026-09-15: Preserve every canonical strategy candidate as relational PIT evidence

- The canonical frontier remains the decision authority and immutable JSON source.
- Migration 039 adds queryable branch and candidate projections for all five strategy branches.
- Multi-leg Defined Risk candidates keep both legs. Recovery WAIT and stock actions keep zero option legs and quantity zero where appropriate.
- The projection cannot authorize execution and expected after-cost EV remains UNKNOWN.
- Research exports include these rows beneath their source frontier so R6 can measure strictness and branch regret without a second strategy brain.

## 2026-09-15: sanitized Optionomics qualification evidence

Keep Optionomics credentials and provider response bodies server-side. The
protected Production qualification response may expose only the documented
operation alias, HTTP status, normalized failure class, retry timing, attempt
count, and observation counts for each sampled symbol. A 2xx response proves
authentication even when its schema cannot produce a normalized chain. HTTP
401 maps to `FAIL` plus `401_UNAUTHORIZED`. Closed sessions and other failures
remain `UNKNOWN` rather than being misreported as bad credentials.

This diagnostic evidence does not promote Optionomics to executable-price
authority. Quote freshness, exact-contract identity, two-sided BBO, and
documented order-pricing semantics remain independent requirements.

Optionomics documents its email and API key as single-line HTTP header values.
The typed environment boundary trims accidental leading and trailing
whitespace on those two fields and rejects embedded line breaks. It does not
strip quotes, auth prefixes, or arbitrary characters. Other credentials remain
untouched.

## 2026-09-14: provider-neutral execution quotes, bounded limits, and TCA

Keep broker mutation in Alpaca, while representing execution-price evidence through
the provider-neutral `ExecutionOptionQuote` contract. Qualification requires exact
contract identity, positive uncrossed bid/ask, a fresh provider observation timestamp,
stable connection, active subscription, authenticated provenance, documented
order-pricing semantics, market-open state, and monotonic sequencing where supplied.
Receipt time records THETA ingestion and can never substitute for provider freshness.
Recorded Optionomics research data cannot satisfy this contract.

Adaptive pricing is deterministic and direction-aware. A sell begins at the ask and
concedes toward the bid only through a versioned bounded schedule. A buy-to-close
begins at the bid and reverses the concession direction. The economic credit floor
or debit ceiling is never crossed. Exhausted attempts, invalid markets, or vanished
economics produce CANCEL, never a market order.

TCA uses decision-mid implementation shortfall with side, quantity, and multiplier.
Fees, impact, fills, and markouts stay null with reasons when unavailable. Immutable
price events and one immutable TCA row per order intent land in migration 025. These
contracts remain disabled evidence infrastructure until the runtime integration and
external quote gates pass.

Migration 026 replaces provider-name coupling in option order lineage with qualified
source semantics. Stock mutation remains explicitly Alpaca SIP/IEX. Alpaca remains
the broker for every mutation. Legacy evidence names remain accepted by the generic
gate only for compatibility, while canonical option commands emit
`QUALIFIED_OPTION_BBO`.

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

## 2026-09-13: Paper mutation engineering stays separate from the shadow worker

The Production shadow worker remains structurally read-only and keeps no broker mutation
surface. A separate master-Paper execution orchestrator owns submit, get, cancel, replace,
restart recovery, and two-leg roll sequencing. It accepts only a fully assembled command
whose decision, account, contract, chain, quote, AEGIS, and deterministic client-order
identity have already been persisted.

Every mutation receives an unforgeable in-process permit from the execution gate. The
permit is bound to operation, quantity, and client order ID. Option orders require a fresh
Alpaca OPRA BBO. Stock disposal requires an Alpaca stock BBO. Optionomics and Alpaca
indicative quotes cannot satisfy either gate. Cancellation remains available for risk
reduction after a decision expires or new entries pause, while exact Paper host, account,
identity, persistence, and quantity checks continue to apply.

A broker response can arrive before local acknowledgement. Persistence failures after an
accepted POST leave the intent restart-recoverable in `SUBMITTING`. Ambiguous network or
5xx mutation results move through reconciliation by deterministic client order ID and are
never blindly retried. Replacement is a distinct intent, cannot increase exposure, and
cannot reduce total order quantity to or below an already-filled amount. Rolls close the
old leg to a broker-confirmed full fill before the new leg can submit.

Point-in-time candidate evidence records `proposedLimit` as null until a real pricing
policy produces a numeric value from fresh executable BBO evidence. Execution-quality
actions such as `SUBMIT` or `SKIP` are retained separately and never stored as prices.

The master command assembler is the typed boundary between strategy or management output
and execution. It derives deterministic order and client identities from decision,
candidate, strategy, action, chain, account, and attempt lineage. It validates current
BBO, limit bounds, freshness, multiplier, quantity, contract identity, covered shares,
account verification, options capability, and AEGIS state before producing a command.
It cannot accept indicative option data.

## 2026-09-13: Provider-neutral trusted quote gate and embedded benchmark workstreams

The remaining R3/R4/R6/R7/R8/R9 roadmap permanently includes Optionomics,
QuantWheel, and Alertsify workstreams. This is an architecture evolution from
the earlier blanket statement that only Alpaca can supply an executable option
price. Alpaca remains broker, order, fill, account, contract-tradability, and
lifecycle truth. Optionomics remains the primary options-intelligence authority.

The canonical option price prerequisite is now
`FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_READY`. Alpaca satisfies it only through
proven OPRA consolidated BBO evidence. Optionomics may satisfy the narrower
trusted-two-sided-quote authority only after a documented authenticated
operation and actual response prove exact contract identity, bid, ask, provider
timestamp, freshness, units, schema version, and documented order-pricing use.
THETA will not call it raw OPRA or NBBO without explicit provenance.

The provider-neutral validator is deliberately not wired into the Paper broker
mutation path yet. Current evidence proves Optionomics research context, not the
required quote contract. The deployed Alpaca account is not OPRA-entitled.
Therefore the present result remains
`FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_READY = NO`, execution stays locked, and
no order is authorized by this decision.

QuantWheel and Alertsify remain benchmark and hypothesis sources. They are not
added as runtime providers. QuantWheel mechanisms must pass THETA's formula and
empirical review. Alertsify mechanisms inform master-fill-first copying,
follower-specific controls, durable duplicate prevention, skip evidence, and
broker-derived performance. THETA additionally requires whole-chain open
inventory and MTM truth.

## 2026-09-13: Optionomics recorded quotes cannot authorize orders

The official Optionomics option-chain contract exposes bid, ask, bid size, ask
size, Greeks, DTE, theoretical value, and exposure fields. THETA retains those
fields for evidence, research, and provider comparison. The provider also states
that the data follows completed ingestion cadence and is not a real-time quote or
execution feed. The execution decision follows the documented semantics, not
the presence of price-shaped fields.

Every normalized Optionomics chain entry is therefore labeled
`SESSION_RECORDED_RESEARCH` with `executionEligible = false`. A credential-free
proof records shape counts and the fixed blocker
`PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED`. It cannot unlock the
Paper broker adapter. Alpaca OPRA also remains `NOT_ENTITLED`, so the first Paper
order stays blocked pending a separately approved execution-quote solution.

## 2026-09-14: PAPER_ACTIVE_BASELINE is explicit evidence, never empirical alpha

THETA may select one structurally feasible CSP for shadow and Paper-evidence rehearsal while the calibrated EV model remains unavailable. The versioned `theta-paper-active-baseline-v2` policy uses only point-in-time contract identity, quantity, ownership, fresh two-sided quote quality, structural premium return per collateral-day, and spread. It first removes mechanically unsafe candidates, computes a Pareto frontier without arbitrary scalar weights, and uses a deterministic tie break inside that frontier.

The resulting receipt states `empirical_ev_ready=false` and `execution_authorized=false`. It contains no win probability, expected profit, fill probability, or fabricated EV. It cannot unlock the broker adapter. Near-miss alternatives are recorded as append-only reevaluation events so the scheduler can perform another complete scan when the market session is confirmed. A follower is never needed for this master research path.

Global WAIT remains unearned whenever universe, branch, management, recovery, covered-call, or redeployment coverage is incomplete. The Paper baseline receipt provides a separate why-not-wait proof for its bounded structural frontier and does not relabel incomplete global search as complete.
## 2026-09-14: Optionomics evidence is layered before interpretation

Authenticated Optionomics chain payloads are now retained as immutable raw observations and transformed into a versioned feature snapshot. Contract identity, two-sided recorded quote fields, Greeks, IV, market-structure fields, liquidity, structural economics, skew, term structure, surface points and flow remain separate. Each unavailable value is explicit `UNKNOWN`; zero remains a valid observed value. Multiplier-dependent cash economics are produced only when broker contract metadata supplies the multiplier. `empiricalEvReady` remains false.

Repeated SPY, QQQ and AAPL quote-shape evidence is measured by a separate qualification harness. The harness cannot promote the current documented `SESSION_RECORDED_RESEARCH` semantics. A fresh-looking response remains blocked until authenticated provider documentation and observed timestamps prove order-pricing use. The database also prevents a `READY` qualification row without `ORDER_PRICING_DOCUMENTED` authority.

## 2026-09-14: documented provider requests and method intake are pinned

Optionomics operation requests may include only parameters present in the
current discovered public contract. The chain adapter previously sent five
extra filters that weren't in the current documentation. They are removed.
Filtering happens locally, while the raw observation records the safe request,
response status, rate-limit metadata, contract version, session date and a
one-way credential identity reference.

External finance repositories are pinned at exact SHAs and reviewed through
implementation and test files. They provide method and test references, not
market data or profitability evidence. AGPL, GPL and no-license code isn't
copied into Production. Equivalent THETA engines aren't duplicated. Advanced
pricing, surface and hedging methods remain research challengers until they add
incremental PIT/OOS value over simple baselines.

## 2026-09-14: Optionomics context observations use bounded typed adapters

Authenticated schema evidence now supports dedicated read-only adapters for symbol metrics, exposure heatmaps, aggregate flow, events, earnings filings, and symbol news. These families are normalized separately and attached to a FusionSnapshot without granting execution authority. Numeric zero remains known, missing and null remain unknown, malformed values are invalid, and provider units or sign definitions remain unverified unless the public contract proves them.

Production requests follow a versioned per-family cadence and a six-request cycle cap. Calls run sequentially because the Optionomics allowance is shared. Skipped cadence families are not backfilled with guessed or stale values. Raw provider payloads remain immutable and are linked to the normalized feature snapshot by migration 030. This keeps the provider, normalized, derived, decision, and execution layers separate.

The new event context does not derive earnings distance from earnings filings and does not invent ex-dividend coverage. Those values remain unknown. Optionomics remains non-executable under its current session-oriented contract.

## 2026-09-14: canonical branch frontiers remain structural until R6 evidence exists

Every shadow cycle now evaluates the five canonical branches independently. Conventional and Hold Strike enumerate single-leg put structures within their own DTE ranges. Defined Risk enumerates same-expiry put spreads and uses broker multiplier metadata for max-profit and max-loss arithmetic. Recovery compares waiting, selling stock, and covered-call alternatives. The covered-call branch enumerates calls only when Alpaca confirms sufficient stock inventory.

Ranking is structural and Pareto-based. Missing soft evidence is recorded and does not become a veto. Hard contract, quote, account-capacity, and AEGIS failures remain blockers. Cross-branch action utilities are unknown, so simultaneous recovery and covered-call alternatives do not produce an invented winner. Every result states `empiricalEconomicsReady=false` and `executionAuthorized=false`.

Global WAIT is earned only at the bounded cross-symbol scan level after every scheduled underlying and every applicable branch finishes with no risk-feasible action. An incomplete branch, skipped symbol, or unattached open-position management surface prevents the claim. Migration 031 stores the immutable frontier and scan-level proof for deterministic R6 export.

Sizing now takes the minimum of risk-budget, collateral, concentration, assignment, tail-risk, correlation, liquidity, buying-power, and broker caps. Quantity zero remains valid. Roll actions explicitly require `BUY_TO_CLOSE` followed by `SELL_TO_OPEN`, preserving the old leg and realized loss rather than mutating them into the new exposure.
# 2026-09-14: Canonical multi-branch decision authority closes R7 internal routing

The immutable five-branch frontier is now the current Production decision authority under `theta-canonical-decision-authority-v1`. Legacy THETA_Q output remains embedded for replay and compatibility, but it no longer determines the persisted selected branch, selected candidate, primary action, or quantity when a canonical frontier is present.

Cross-branch selection uses known structural economics, global Pareto dominance, complete sizing caps, and deterministic tie-breaking. Empirical utility is explicitly `UNKNOWN_NOT_YET_CALIBRATED`. Management inventory is delegated to the management-first authority and is never converted into an automatic covered call. The sole Production-to-research wire contract is documented in `docs/research/THETA_PRODUCTION_RESEARCH_EXPORT_CONTRACT.md`.

## 2026-09-14: the laptop worker is the independent master Paper runtime

The canonical Windows process is `MASTER_THETA_PAPER`. It runs reconciliation,
management, lifecycle processing, portfolio-risk refresh, opportunity discovery,
strategy routing, sizing, evidence capture, and research export independently of
all followers. Zero followers is a valid normal state and cannot pause the
master. Shadow selection remains an internal challenger and evidence mechanism,
not the runtime identity displayed to operators.

The current broker mutation boundary remains structurally unavailable. The
runtime reports `EXTERNAL_QUOTE_BLOCKER` until an exact-contract, fresh,
two-sided option quote passes the provider-neutral execution-quote contract.
The worker still runs while blocked, including when the market is closed. Live
hosts and live credentials remain forbidden. This change does not claim
profitability or authorize a Paper order.

The Windows task starts at owner logon, starts when available after missed
triggers, requires network availability, wakes the machine when Windows permits,
restarts after failure, ignores overlapping task instances, and is additionally
protected by a process mutex and PostgreSQL lease. Every recovered process
reconciles broker truth before considering new exposure.
# 2026-09-14, approved action plans use the existing execution coordinator

- Decision: Keep the canonical strategy, AEGIS, execution, broker, and lifecycle modules separate. Persist one typed `ApprovedMasterPaperActionPlan` after a canonical decision is approved, claim it durably in the resident worker, qualify a current execution quote, price it with the existing adaptive-limit policy, and delegate to the existing `MasterPaperExecutionOrchestrator`.
- Reason: The resident cycle previously had no production-reachable handoff from an approved strategy action to the tested Paper coordinator. A durable queue closes that internal seam without creating another trading architecture.
- Safety: Enqueue verifies the immutable decision's selected candidate, quantity, AEGIS result, and master execution-account readiness inside one transaction. The worker reconciles first. Claims are restart-safe. New risk requires empirical positive after-cost EV. The kill switch, Paper host, market-session, quote freshness, account capability, idempotency, and order-state gates remain mandatory.
- Execution quote semantics: Alpaca consolidated OPRA and an Optionomics two-sided quote may satisfy the same provider-neutral contract only when their actual provenance proves the stated semantics. Research or indicative Optionomics data does not qualify. Stock disposal remains Alpaca-priced.
- Current state: The Production execution switches remain locked. The strategy package remains non-executable, and no plan exists merely because the transport path now exists.
## 2026-09-14 - Treat Optionomics gamma, Vanna, and Charm as separate heatmap observations

The current public API contract documents three values for the heatmap `metric` query: `gamma_exposure`, `vanna_exposure`, and `charm_exposure`. THETA previously called only the default heatmap and incorrectly classified Vanna and Charm as unavailable. The provider adapter now issues three explicit, rate-budgeted requests, verifies that each response echoes the requested metric, and stores each response with a distinct operation alias. The feature snapshot keeps three separate grids. Provider methodology, units, sign convention, and session freshness remain unverified, so all three are contextual research evidence and never execution-price authority.
# 2026-09-14: Separate bounded Paper evidence from empirical and live promotion

THETA now records four distinct authorization concepts: `PAPER_EVIDENCE`, `EMPIRICALLY_PROMOTED_PAPER`, `LIVE_ELIGIBLE`, and `LIVE_AUTHORIZED`. Only the first two can enter Paper persistence. The runtime and broker coordinator reject both live tiers.

`PAPER_EVIDENCE` may preserve `empiricalEconomicsReady=false` and `expectedAfterCostEv=null`. It still requires canonical selection, structural validity, exact contract identity, a fresh qualified Alpaca BBO, Paper account verification, options capability, no equivalent exposure conflict, market-open state, positive forward structural economics, AEGIS approval, persisted intent, idempotency, and reconciliation-before-retry. A separate `PAPER_EVIDENCE_RISK_CAP` defaults to one contract and can only reduce canonical quantity. Zero remains a valid no-order result.

`EMPIRICALLY_PROMOTED_PAPER` keeps the positive, known after-cost EV requirement for new risk. Future live eligibility continues to require empirical promotion and a separate owner authorization. Current live eligibility and authorization are false.

## 2026-09-14 - Produce Paper plans only from canonical persisted decisions

The Production opportunity scan now owns the missing producer side of the
durable master action-plan queue. It may create a plan only for an exact,
single-leg `OPEN_CSP` selected by the canonical authority and stored as the
decision's candidate foreign key. The plan is capped by
`PAPER_EVIDENCE_RISK_CAP`, which can only reduce quantity.

The structural minimum-credit boundary is the versioned modeled round-trip
cost per contract divided by the actual contract multiplier, plus one tick.
This proves only that the quoted opening credit clears the declared cost floor.
Expected after-cost EV remains `null` and empirical readiness remains false.
Research-only branches cannot enter this Paper path.

Expired decisions are quarantined before queue claims and receive immutable
events. This prevents an old external-quote-blocked plan from starving newer
decisions. Alpaca OPRA or an independently qualified Optionomics two-sided
quote remains mandatory at the last pricing boundary.

## 2026-09-15 - Management actions use their own atomic, dependency-aware authority

- Decision: Publish active management decisions and all of their broker legs in one PostgreSQL transaction. A management plan must reference the immutable management input snapshot and action frontier that selected it. New-risk decisions keep their existing candidate authority.
- Roll safety: A roll is two independent orders. The open-new plan cannot be claimed until the close-old plan is linked to a local order intent whose state is `FILLED` from broker reconciliation. The opening quantity may shrink under the Paper evidence cap and may never exceed the close quantity.
- No invented policy: The assembler maps a selected action to explicit order intents, but it does not invent the selected action, target contract, quantity, economic boundary, or expected value. Current frontiers remain passive HOLD while empirical continuation economics are unknown.
- Recovery safety: Stock disposal requires the exact confirmed share inventory. Covered-call opening requires a real call contract and enough confirmed shares for the contract multiplier. Missing identity, coverage, quote, AEGIS, or strategy evidence blocks publication.
- Runtime behavior: Every management scan now persists and reads back its immutable frontier, invokes the typed action-plan assembler, and publishes only a fully ready active result. Passive HOLD/RECOVERY_WAIT/HOLD_CC creates no broker action. Pending intents are reconciled from Alpaca before a dependent plan can advance.
- Execution boundary: This does not qualify Optionomics or Alpaca option quotes and does not authorize an order. The external quote gate, Paper controls, live-host rejection, and follower lock remain unchanged.

## 2026-09-15 - Bind active management to immutable same-snapshot policy evidence

- Decision: The autonomous runtime accepts management output only through a typed policy-evidence provider. The evidence must identify the exact management-input content hash and timestamp, value every feasible action, select the known-utility argmax, and carry a non-empty policy version.
- Fail-closed behavior: Missing, stale, incomplete, malformed, or non-argmax evidence falls back to the lifecycle's passive action. The existing Python transparent baseline is not installed as Production authority because an unknown HOLD forecast can otherwise make a known CLOSE value win by default.
- New-risk boundary: ROLL, SELL_CC, ROLL_CC, and REDEPLOY remain blocked unless their execution evidence has known positive empirical after-cost EV. The evidence cannot remove AEGIS, quote, inventory, or lifecycle blockers.
- Expiration boundary: LET_EXPIRE, ACCEPT_ASSIGNMENT, and ALLOW_CALL_AWAY are no-order structural outcomes. They may be selected without a fitted EV model only at DTE zero, after the broker session is closed, with exact moneyness and required share or assignment capacity known.
- Execution compilation: CLOSE_FULL, ROLL, SELL_STOCK, SELL_CC, CLOSE_CC, and ROLL_CC now compile from the selected immutable frontier. Current-leg identity and quantity come only from reconciled state. Target contracts and economic boundaries come only from the selected evidence. Covered calls cannot exceed broker-confirmed shares.
- Durable lineage: Migration 041 adds policy version and evidence hash to the immutable frontier. The atomic action-plan writer verifies both before creating a management decision or plan. Research exports include the same lineage.
- Authorization: This closes an engineering seam only. No empirical policy provider is configured, the execution-quote gate is unchanged, follower submission remains disabled, and live trading remains forbidden.

## 2026-09-15 - Treat profit percentages as evidence, never exit authority

- Decision: Record current profit capture, the highest observed profit since evidence capture, profit giveback, remaining reward, secured capital-days, and the current pre-cost close mark for every open THETA option chain. A 5%, 10%, 20%, 30%, or 40% gain is a point-in-time fact, not an order rule.
- Forward comparison: HOLD, CLOSE, ROLL, assignment, recovery, covered-call, and WAIT alternatives retain separate structural facts and empirical values. HOLD continuation value, tail risk, execution cost, and redeployment opportunity cost remain `UNKNOWN` until a calibrated model and real observations supply them.
- Challenger policies: Fixed 25% through 90%, 21/14/7-DTE, 50%-or-21-DTE, hold-to-expiry, dynamic remaining-EV, dynamic giveback, event-aware, and regime-aware policies are persisted side by side as research challengers. None can select a production action.
- Peak semantics: Peak profit is explicitly `SINCE_EVIDENCE_CAPTURE`. It is never presented as the lifetime peak when data collection began after entry.
- Strategy switching: STAY, SWITCH, and WAIT share one record. Exit spread, new-entry spread, fees, slippage, foregone theta, capital churn, and added duration must be present before a switching policy can be compared. A prior loss never triggers a strategy switch by itself.
- Hard boundary: The shadow provider has no conversion path to `ManagementPolicyEvidence`, stores `comparison_complete=false`, `execution_authorized=false`, and `NOT_EMPIRICALLY_PROMOTED` under database constraints, and leaves the production provider unconfigured.
- Promotion contract: `theta-empirical-policy-promotion-v1` requires reproducible dataset identity, separated train/validation/OOS windows with embargo, the full economic/risk metric set, versioned acceptance evidence, execution evidence, and explicit approval. Passing it can only mark evidence ready for human review. The validator cannot self-promote a policy or authorize an order.
- Options-first boundary: Strategy switching research must compare exact contract ladders and structures. VRP must align the candidate contract IV with a defensible realized-volatility horizon. Skew must come from the candidate underlying and expiration. Market-wide or ticker-only proxies cannot silently replace those observations. These remain hypotheses until authenticated Optionomics history and resolved whole-chain labels exist.

## 2026-09-15 - Derive temporal Optionomics evidence without creating a signal

- Decision: Pair only strictly ordered, same-underlying, schema-compatible Optionomics feature snapshots and persist transparent scalar changes as immutable research evidence.
- Scope: The first method version covers IV level/rank/percentile, IV-vs-RV, skew, term, risk reversal, GEX/DEX, gamma flip, and wall locations. It records numeric deltas and rates, not bullish/bearish labels or trade recommendations.
- Missing data: UNKNOWN and INVALID inputs remain non-numeric. A schema mismatch or observation gap beyond the versioned one-hour research policy produces UNKNOWN. Zero remains a known value.
- Provenance: Each row references both source feature snapshots and retains observation times, elapsed seconds, units, method/policy version, content hash, and reason code. Database constraints enforce time order, known-value shape, immutability, and `execution_eligible=false`.
- Research boundary: These deltas may enter later paired ablation and OOS work. They cannot authorize a strategy branch, price an order, or repair the current Optionomics 401 and execution-quote blockers.

## 2026-09-15 - Materialize P2D outcome subjects without promoting policy

- Decision: Materialize whole-chain, strategy, action-regret, contract-regret, strategy-regret, WAIT, management, and contract outcome subjects from existing immutable decision evidence.
- Causality: Decision context and future observations remain in separate immutable tables. Labels become available strictly after the decision timestamp. Dataset schema v5 validates the separation and preserves deterministic identity.
- Economic truth: Whole-chain labels require terminal broker-reconciled economic facts. Option, stock, dividend, and fee facts remain additive, and old roll losses remain immutable.
- WAIT discipline: FALSE_REJECT requires an explicitly feasible and materially superior point-in-time alternative with risk, liquidity, event, portfolio, and execution evidence. Missing evidence cannot be treated as regret.
- Performance discipline: Return and win-rate bands are descriptive cohorts. They do not impose a 40 percent take-profit rule, a 70 to 80 percent win-rate target, or any execution threshold.
- Authorization: Policy-learning rows and challenger evaluations are research-only and database-locked to `execution_authorized=false`. No policy is promoted and no Paper or live order is authorized.

## 2026-09-15 - Treat time, path, action, and inaction as evidence rather than fixed rules

- Decision: Persist exchange-session context, option-time state, whole-chain position paths, action-versus-inaction Pareto frontiers, and strategy timing applicability for every changed open-chain management state.
- Profit protection: Peak capture, giveback, winner-to-loser, loss acceleration, expiry proximity, and opportunity cost are research facts. No fixed PnL percentage selects an exit.
- Anti-paralysis: WAIT and HOLD receive explicit outcome diagnostics so excessive inactivity can be measured against feasible rejected opportunities. Overtrading remains separately measurable.
- Optionomics: The provider-ready capability model accepts only authenticated documented evidence. Intelligence readiness remains separate from execution quote qualification.
- Controls: Owner pause and emergency-lock events are immutable, same-origin, confirmed, idempotent, and unable to enable execution.
- Authorization: All new research tables enforce `execution_authorized=false`. The external quote blocker, unpromoted management provider, follower lock, and live prohibition remain unchanged.
- Version lineage: The Conventional research definition advances to `theta-conventional@1.0.1-research`. Production rejected the changed payload under the immutable `1.0.0` hash, so the prior version remains untouched and the updated definition receives a new identity.

## 2026-09-14 - Run deterministic Python contracts in a private Vercel Python function

The Production Node function cannot spawn `python3`. Canonical market scans
were therefore failing closed at ownership despite the same Python contracts
passing locally and in CI. The deployed control plane now invokes a private,
allowlisted Vercel Python function using the existing runtime secret. Local and
CI execution keeps the child-process bridge, so the contract validators and
model methodology remain unchanged.

The Python function accepts only named deterministic model families, performs
no provider or broker I/O, suppresses request logging, caps request and response
sizes, and returns generic errors. The TypeScript caller still performs schema,
snapshot, policy, and model-version validation. An unavailable or invalid
remote model fails closed and can never become an OPEN decision.

Production calls the project's canonical production URL. Vercel protects
deployment-specific hostnames, so using `VERCEL_URL` would return a platform
401 before the private function could validate the runtime secret.

Unknown ownership remains an execution blocker but no longer prevents the
Conventional branch from enumerating contracts in reduced research mode. The
untrained recovery-history component otherwise made ownership permanently
unknown and starved the point-in-time evidence ledger. The existing candidate
model still marks unknown-ownership contracts infeasible, so this change
captures rejection evidence without treating missing data as acceptable.

Canonical Conventional contracts are persisted even when they are excluded
before the legacy THETA-Q scorer, such as when the only available quote is
indicative. Persisted synthetic evaluation rows retain actual contract identity
and structural economics, mark unknown evidence explicitly, force quantity to
zero, and keep expected EV unknown. This closes the gap where a decision receipt
listed 21 evaluated contracts while the point-in-time ledger stored none.
## 2026-09-15: follower Paper runtime stays fully downstream and disabled

Follower copy work begins only from a broker-confirmed master fill or lifecycle fact. A follower receives an independent account check, quantity, AEGIS result, current qualified quote, limit, action plan, and reconciliation stream. Follower action plans are immutable and constrained to `FOLLOWER_EXECUTION_DISABLED` with `execution_authorized=false`. No planner or customer route can submit an order. Missed entry, partial fill, close/roll, assignment, recovery, covered-call, call-away, pause, and restart divergence are follower-specific evidence rather than inferred from the master chain.

## 2026-09-15: Compare options contracts and structures before empirical promotion

- Decision: Persist one immutable options-chain decision evidence record inside the existing atomic THETA cycle transaction. It contains exact contract observations, expiry and strike/delta frontiers, same-snapshot strategy structures, scoped Optionomics context, and a human-readable selection receipt.
- Ranking discipline: Liquidity thresholds are versioned policy inputs. The initial Production evidence policy records quote validity and missing fields without inventing universal OI, volume, spread, or size cutoffs. Structural facts remain separate from empirical expected value.
- Missing data: UNKNOWN and INVALID Optionomics values retain their states. Provider and independently derived exposure values remain separate when they disagree. Delta is a Greek and is never represented as win probability.
- Counterfactual safety: Neighboring strikes, other expirations, other structures, and WAIT receive empty future-label contracts. Outcomes remain null and blocked until the future label pipeline can resolve them without lookahead.
- Execution boundary: The entire P2B object is research evidence. Database constraints and the Python export loader require `execution_authorized=false` and `empirical_economics_ready=false`. The fresh trusted two-sided quote gate, AEGIS, and Paper/live controls are unchanged.

## 2026-09-15: Separate P2F provider proof, quote authority, and R8 activation

- Provider transport: Use one bounded server-only Optionomics transport with timeouts, cancellation, JSON validation, correlation IDs, rate-limit evidence, and bounded retry. Synthetic and replay modes cannot qualify real authentication.
- Quote authority: A provider capability or successful login cannot clear the execution gate. Exact-contract, fresh, uncrossed two-sided evidence with explicit semantics, entitlement, and provenance is required independently.
- Operator concurrency: Every state-changing operator command carries the observed monotonic state version. Stale writes fail, idempotent replays return the original result, and database serialization prevents last-write-wins races.
- Emergency recovery: Clearing the emergency lock requires an explicit reason and leaves new entries paused. Resume cannot clear the emergency lock.
- Evidence quality: Raw management-cycle observations remain immutable, while semantic checkpoints identify actual path changes. Rejected-candidate positive outcomes are descriptive and are not called formal false rejects.
- Version safety: A strategy semantic version is immutable. A configuration-hash change requires a new version rather than an in-place rewrite.
- Phase boundary: R7 engineering readiness, Optionomics real authentication, trusted execution-quote qualification, first-order readiness, and empirical training readiness are separate machine-checkable dimensions. No P2F component can authorize an order.

## 2026-09-16: Keep Neon immutable and make historical recovery resumable

- Runtime authority: Aiven remains the only Production runtime database. Neon is a preserved read-only historical source and is never queried as part of normal trading runtime.
- Current blocker: Main pooled, main direct, both preview SQL surfaces, Data API, Time Travel, snapshot, and operation-history paths are blocked by the Neon project-wide transfer quota. SQLSTATE `53000` is source unavailability, not evidence that historical rows are absent.
- Recovery: One bounded runner probes each configured source once. Once readable, it enumerates every non-template database, creates PostgreSQL custom-format dumps in an ignored local directory, and hashes every dump. It never loops on quota failures or mutates Neon.
- Import boundary: Source dumps restore into isolated staging before comparison and controlled backfill. Current Alpaca, provider, account, position, order, strategy, gate, and worker state cannot be overwritten by legacy rows.
- Evidence: A protected read-only Aiven inventory classifies every canonical table. Empty schemas cannot be called recovered. The existing 25,125 staged research records remain partial recovery until source counts and identities can be compared.
- Authorization: This work cannot submit orders, unlock followers, promote policy, clear the external quote gate, or add live-money capability.

## 2026-09-16: Promote recovered Neon exports into an isolated immutable history layer

- Decision: Validate and classify every staged application-export record before exposing it to research. Records with complete point-in-time provenance enter `research.legacy_neon_recovered_evidence`. Control-plane metadata enters a separate operator-history view.
- Canonical boundary: Legacy payloads do not insert directly into current trade, market, customer, broker, provider, gate, or worker tables when their original foreign-key parent set is unavailable. Current Aiven rows remain authoritative.
- Deduplication: A matching native ID and content hash is classified as a canonical duplicate. A differing hash is quarantined. Native ID matches without a comparable source hash are also quarantined. No conflict is silently resolved.
- Integrity: Promotion uses an ordered SHA-256 fingerprint over staged family, record key, and source checksum. Every promotion row is immutable and retains the source artifact-record reference.
- Execution: Promotion records are permanently non-executable. This work cannot authorize Paper or live orders, clear the quote gate, activate followers, or promote a policy.

## 2026-09-17: Close the bounded non-Neon legacy reconstruction sweep

- Decision: Register every inspected recovery source and every canonical data-family assessment in an immutable Aiven registry. Keep the registry separate from canonical trading state and permanently non-executable.
- Source discipline: Search all 109 immutable exports, 23 research-output runs, 138 research-output JSON files, bounded local and agent workspaces, Git history, 310 GitHub Actions artifacts, Vercel metadata, Alpaca Paper, and qualified Optionomics evidence before classifying a family as currently Neon-only.
- Identity discipline: Deduplicate export evidence by stable identity and content hash. Retain conflicting variants as source-version metadata. Never overwrite a conflicting version and never invent a missing parent.
- Recovery result: No older-only stable row was found. The existing 25,125 exact PIT rows remain the maximum proven historical recovery from accessible non-Neon sources. Current Alpaca activity confirms current broker facts but does not reconstruct THETA reasoning or a whole chain.
- Runtime authority: Aiven remains current runtime authority. Neon remains preserved, read-only, and required only for eventual historical completeness. Its unavailability does not block the normal roadmap.
- Safety: The external quote blocker, follower lock, Paper execution pause, and live-money prohibition remain unchanged.
# 2026-09-17: Master Paper authority is staged and management-safe

- The owner's connected account is the dedicated `MASTER_THETA_PAPER` account.
- Paper authority is recorded as immutable database evidence. Follower submission and live money remain structurally false.
- Process configuration, persisted authorization, operator control, broker truth, strategy authority, AEGIS, and fresh execution pricing must all agree before a broker mutation.
- A pause on new entries does not disable risk-reducing management. The emergency lock still disables every broker mutation.
- New-risk plans cannot be claimed while entries are paused. Management plans remain claimable.
- New risk also requires a configured promoted management policy provider. Shadow policy evidence and fixed profit targets cannot authorize orders.
- Alpaca OPRA remains not entitled. Optionomics remains research intelligence until its documented execution-price semantics are proven. The execution-price gate stays closed.

## 2026-09-17: Alpaca indicative is the scoped master Paper price reference

- Alpaca Basic `feed=indicative` may qualify only as `PAPER_INDICATIVE_REFERENCE` for the isolated `MASTER_THETA_PAPER` runtime. It must carry exact OCC identity, a two-sided uncrossed quote, provider observation time, receipt time, acceptable age and spread, and authenticated Alpaca provenance.
- This evidence is never described as OPRA, consolidated NBBO, or live-money price authority. Live use rejects the semantic class. Follower submission remains locked.
- Every initial placement and bounded replacement re-fetches and requalifies the exact contract. The broker-confirmed Alpaca Paper order and fill remain execution truth. Transaction-cost records derived from this reference are labeled `ALPACA_INDICATIVE_TCA`.
- Optionomics remains options intelligence and research context. It is not required to supply the Paper execution reference.
- Review of `origin/claude/theta-management-intelligence` through `0a5e0b1` found useful research modules for common-horizon economics, loss-state description, thesis invalidation, roll comparison, and policy promotion. They remain `RESEARCH_ONLY` for this correction. The branch's management-frontier change treats complete deterministic net-credit arithmetic as sufficient to clear an empirical new-risk blocker, and the latest thesis utility bias is caller-supplied without validated calibration. Those runtime semantics are rejected for now. Main's bounded bootstrap provider remains the single runtime provider and makes no empirical profitability claim.
