# Codex handoff: standalone platform Phase 1

## 2026-09-11: commit-pinned GitHub methods audit and ledger UNKNOWN fix

OWNER: Codex, sole integration owner.

TASK: Inspect the owner's fifteen GitHub references plus QuantLib/LEAN and turn
findings into explicit comparisons and one focused accounting correction.

FILES CHANGED: research Top15, ledger, gap matrix, formula catalog, new strategy
catalog, archived previous research, EV spec correction, ledger-contract.ts,
ledger-contract.test.ts, DECISIONS.md and this handoff. Quant model sources,
providers, migrations, customer UI and execution gates are unchanged.

WHAT WAS IMPLEMENTED: 17 commit-pinned source records with licensing, scope and
limitations, 36 gap rows, 21 formula entries, strategy rejection/promotion criteria.
Ledger v2 propagates unknown option/stock/dividend components into a null total
while preserving known realized losses and explicit valuation issues. Earlier
research is retained in archive, including references outside the bounded fifteen.

TESTS RUN: targeted ledger tests, TypeScript check, ESLint, full Node tests,
Python quant tests, Playwright browser/accessibility checks, build, secret scan
and diff review. No upstream repository's test suite was executed.

TEST RESULTS: 13 ledger tests passed, 532 Node tests passed with three local DB
tests skipped, 349 Python tests passed, 22 browser tests passed. Type check,
lint, build and security scan passed. CI will rerun disposable Postgres/Redis
invariants after integration. No migration is required for this pure calculation.

KNOWN LIMITATIONS: Targeted file/function review is not an exhaustive code audit
of all17 repositories. No calibrated full-H EV or OOS profitability evidence was
created. Option MTM provenance, premium/basis and fee allocation, ex-date dividend
shares, capital-days and durable management joins remain incomplete.

RISKS: Positional date zipping in lambdaclass, mixed-expiry batch handling in
ivsurf, conflated GEX crossing definitions and unsafe missing-data/forced-quantity
patterns must not be ported. Noncommercial/no-license/AGPL source was not imported.

WHAT THE OTHER AGENT SHOULD REVIEW: execution_quality.py needs explicit side and
unit review before its buy-oriented heuristic is used for short-option execution.
Preserve canonical full-H/management methodology. Avoid failed-fold suppression
and current-chain features in historical rows. Only Codex integrates main.

NEXT RECOMMENDED TASK: Provenance-aware full-chain valuation and durable management
receipts, then reconciliation/scheduler operational evidence in the existing roadmap.
No new GEX provider or strategy is needed to do that work.

ORDER SAFETY: No broker order submission was made in this milestone. Execution
gates remain unchanged. READY_FOR_FIRST_PAPER_ORDER remains NO, this source audit
does not establish fresh account, contract, quote or worker readiness evidence.

## 2026-09-10 customer copy UX and owner operations foundation

OWNER: Codex

TASK: Integrate Claude's THETA runtime contracts, rebuild customer copy UX, and add private owner operations foundation.

FILES CHANGED: Customer UI and styles, customer-safe v1 APIs and models, `/ops` server authorization, environment declarations, browser and Node tests, product and handoff documents. Claude's source branch was merged without rewriting its quant modules.

WHAT WAS IMPLEMENTED: Five-step PAPER copy preflight with activation disabled, simplified customer navigation and THETA pages, disconnected account and My Bots states, customer activity filters, server-gated `/ops`, owner system health, runtime status, read-only provider verification action, and explicit blocked trading, ledger, reconciliation, and copy states.

TESTS RUN: TypeScript check, ESLint, 128 Node tests, 225 Python tests, 11 Playwright scenarios across desktop/tablet/mobile with axe WCAG AA checks, production build, security scan, npm audit, git diff check, Reticle connection and gate attempt.

TEST RESULTS: All code, browser, accessibility, build, security, and dependency checks pass. Reticle connected but had no saved flows and correctly returned no verdict. Local provider readiness is blocked because Vercel Sensitive values are intentionally non-exportable and become placeholders in local CLI runs.

KNOWN LIMITATIONS: R1 runtime remains partial. Customer OAuth endpoints, IAM, encrypted follower token references, persistence, broker bridge, execution, reconciliation, and copy engine aren't implemented. No order submission exists.

RISKS: Claude's management action-value contract needs joint review of valuation origin to prevent entry premium double counting by future callers. Production provider connectivity still needs a secure runtime-only verification path.

WHAT THE OTHER AGENT SHOULD REVIEW: The management valuation origin ambiguity and the customer-safe mapping from future persisted runtime events. Claude must not commit or push.

NEXT RECOMMENDED TASK: Build the production-runtime provider verification job and persistent shadow decision ledger before any first PAPER order gate.

OWNER: Codex, production/backend/execution lead

TASK: Standalone customer platform, public competitor UX research, versioned customer API, private owner visibility and deployment.

FILES CHANGED: public/, src/customer/, src/app.ts, src/index.ts, api/customer.ts, vercel.json, tests/customer.test.ts, tests/browser/, playwright.config.ts, tools/security-scan.mjs, package files, lint/CI configuration and Phase 1 documentation.

WHAT WAS IMPLEMENTED: Owned-bot discovery, THETA detail sections, economic chart and lifecycle, illustrative capital scenario, local drafts, comparison, activity, safe empty/degraded states and authenticated read-only owner release visibility. Public read models are independent of broker tables and TradePilot.

TESTS RUN / TEST RESULTS: See BOTS_VERIFICATION.md for the final run, browser evidence, deployment and CI status.

KNOWN LIMITATIONS: No customer account connection, live publication feed, active copy engine, enforced copy preferences or validated performance. The educational calculator is not a backtest. Five roadmap bots are unavailable. Owner access is a limited existing-key surface, not a full IAM implementation.

RISKS: Options and assigned inventory can lose materially. UI readiness does not imply trading readiness. A future publisher must validate and authorize user-specific records. Automated accessibility checks need complementing with assistive-technology user testing.

WHAT THE OTHER AGENT SHOULD REVIEW: Economic accounting and provenance, strict separation of illustrations from results, safe contracts and future publisher interfaces. Quant methodology and model files are unchanged.

## Research durabilization integration

Claude's docs-only Phase 2-4 durabilization branch was independently reviewed and
merged after confirming no runtime, provider, migration, UI, Vercel, broker or secret
changes. The integration corrected four TRD Appendix A formula references and the
durability-file count. See `docs/quant/PHASE2_4_CORRECTION_AUDIT.md` and
`docs/EMPIRICAL_THETA_BACKLOG.md`.

NEXT RECOMMENDED TASK: Start only the first empirical prerequisite after explicit
approval: historical-data and provider-capability evidence. Do not begin an empirical
run, paper order or copy activation until the documented prerequisites are met.

## 2026-09-10 customer UX final correction pass

OWNER: Codex

TASK: Reconstruct the public experience around a simple PAPER copy-trading journey
and strengthen the private operator status surface without changing THETA models.

FILES CHANGED: `public/assets/app.js`, `public/assets/workflows.js`,
`public/assets/ui.js`, `public/assets/styles.css`, `tests/browser/platform.spec.ts`,
`docs/product/OWNER_OPS_IA.md`, and verification documentation.

WHAT WAS IMPLEMENTED: A direct customer home page, a product-style THETA card,
four customer THETA tabs, simple performance/position/trade empty states, a four-step
copy setup, plain account messaging, customer-safe activity wording, and a denser
read-only `/ops` control center. Copy and Alpaca connection controls remain visibly
unavailable until their backend gates pass.

TESTS RUN: TypeScript check, ESLint, Node tests, Python tests, Playwright customer
journeys, axe WCAG AA analysis, responsive overflow checks, production build,
security scan, dependency audit, secret-pattern checks, and Git diff checks.

TEST RESULTS: See `docs/BOTS_VERIFICATION.md` and the release commit for exact final
counts and deployment status.

KNOWN LIMITATIONS: Customer OAuth, customer IAM, follower token storage, runtime
persistence, master-fill ingestion, follower sizing, child orders, reconciliation,
pause, stop, and copy activation remain unavailable. Reticle connected to the app but
could not issue a verdict because this client lacks its MCP verdict tools and the repo
has no saved flows.

RISKS: The current `/ops` login uses one temporary shared operator secret. It lacks
per-owner identity, MFA, roles, and durable audit attribution. Paper runtime and
website deployment must continue to be treated as separate release states.

WHAT THE OTHER AGENT SHOULD REVIEW: No quant code changed. Claude should consume the
customer-safe runtime boundary and continue to avoid commits or pushes.

NEXT RECOMMENDED TASK: Return to the first runtime persistence and provider-backed
shadow decision milestone. Do not enable customer copy activation or submit an order.

## 2026-09-10 authoritative customer and copy-contract completion pass

OWNER: Codex

TASK: Apply the final product authority to customer copy behavior, follower-result
separation, private owner operations, and the non-executing copy-engine foundation.

FILES CHANGED: Customer copy contracts and tests, migration 005 and SQL invariants,
customer-safe models and APIs, customer and owner UI, route protection, Vercel
rewrites, browser tests, and product status documentation.

WHAT WAS IMPLEMENTED: Follower-specific copy planning with stable identifiers,
quantity adaptation including zero, full lifecycle actions, stop-new-entry management,
roll close-plus-open semantics, and reconcile-before-retry. Added durable follower
copy tables with opaque secret references and append-only facts. Added follower-only
My Results, state-driven Home and My Bots, a three-step automatic-copy setup, explicit
disconnect consequences, read-only customer tables, and five protected owner routes.

TESTS RUN: TypeScript check, ESLint, Node unit/API/contract tests, Playwright customer
and owner journeys, axe WCAG AA checks, responsive overflow checks, build, security
scan, dependency audit, secret-pattern scan, and Docker readiness probe.

TEST RESULTS: 180 Node tests, 253 Python tests, and 16 Playwright journeys passed.
The browser run includes axe WCAG AA and responsive overflow checks. Security scan,
build, lint, type checking, and dependency audit passed. GitHub CI applied all five
PostgreSQL migrations, passed SQL invariants, and verified Redis. Docker schema
execution remains blocked locally because the Docker Desktop Linux engine pipe is
unavailable.

KNOWN LIMITATIONS: Customer IAM, OAuth callback and token vault integration, runtime
persistence adapters, follower broker I/O, PAPER order execution, scheduler, economic
publisher, and validated performance remain unreleased.

RISKS: A disconnected follower with open positions loses THETA management. The UI
warns about this, but customer mutations remain disabled until identity, audit, and
reconciliation controls exist.

WHAT THE OTHER AGENT SHOULD REVIEW: Copy action mapping against lifecycle contracts
and the future AEGIS input/output adapter. Claude's quant source was not changed.

NEXT RECOMMENDED TASK: Implement the authenticated follower read adapter and shadow
master-event ingestion. Keep execution disabled until persistence and chaos tests pass.

## 2026-09-10 provider connection and private PAPER beta readiness

OWNER: Codex

TASK: Complete separate master Alpaca, Optionomics, PostgreSQL, and follower OAuth
readiness paths without enabling any order submission.

FILES CHANGED: Migration 007 and its SQL invariant, environment contracts, customer
OAuth/store/readiness/API modules, customer and operator UI, provider parsing, tests,
and Alpaca Connect documentation.

WHAT WAS IMPLEMENTED: Independent read-only master Alpaca and Optionomics checks,
real PostgreSQL readiness, stored follower-token re-verification, options levels 0-3
handling, minimal OAuth scope, and explicit customer setup states. Follower raw-key
beta is disabled and structurally prohibited. Saving a setup does not place an order.

TESTS RUN: TypeScript, ESLint, Node tests, browser and accessibility tests, production
build, security scan, SQL migration invariants, and deployment checks.

KNOWN LIMITATIONS: Alpaca Connect commercial approval, production PostgreSQL, and
their Vercel values are external gates. Production provider checks require an operator
session. PAPER execution is locked.

RISKS: A provider HTTP success does not authorize execution. A saved follower setup
must remain separate from an active execution worker. Transaction-pooled runtime URLs
must not be used for migration session semantics.

WHAT THE OTHER AGENT SHOULD REVIEW: Consume the typed account readiness and persisted
follower boundary. Do not merge the old shadow runner or change provider/account UI.

NEXT RECOMMENDED TASK: After external Connect approval and database provisioning,
apply migration 007 and run one real follower OAuth connect/reverify journey. Keep
order submission disabled.

## 2026-09-11 THETA runtime integration and PAPER_READY execution milestone

OWNER: Codex

TASK: Preserve Claude's full autonomous-runtime history, integrate it into main, then
build the single master/follower Alpaca PAPER broker boundary without placing an order.

FILES CHANGED: THETA shadow integration files, `src/execution/`, migration 008 and SQL
invariants, typed execution flags, private operator status, tests, and decision records.

WHAT WAS IMPLEMENTED: PR #2 merged the complete Claude branch with a two-parent merge.
The runtime now has structured capability states, ranked underlyings, the canonical
FusionSnapshot hash, and a development-gated non-executing one-shot path. Provider and
pipeline failures produce `SYSTEM_HOLD`, separate from an AEGIS hard veto. The new
shared PAPER adapter supports API-key and OAuth authentication, read operations,
submit/replace/cancel contracts, exact limit-order construction, intent-first
persistence, ambiguous-submission lookup, restart recovery, trade-update normalization,
partial-fill deduplication, and provisional assignment reconciliation.

TESTS RUN: TypeScript check, ESLint, Node tests, Python tests, Playwright responsive and
accessibility tests, production build, security scan, dependency audit, and diff checks.
Migration 008 and its SQL invariant are delegated to GitHub CI because the local Docker
Linux engine is unavailable.

TEST RESULTS: Integration PR #2 and PAPER readiness PR #3 passed their GitHub CI runs
and Vercel previews. The final local suite passed 320 TypeScript, 298 Python, and 16
Playwright tests. The Linux main pipeline passed 287 TypeScript tests with 33
platform-specific skips, 298 Python tests, and all 16 Playwright tests. It applied
migrations 001 through 008 to an empty PostgreSQL database, passed every SQL invariant,
and verified Redis connectivity. Lint, type checking, build, secret scan, and dependency
audit passed with zero high-risk dependency findings. The production deployment is Ready.

KNOWN LIMITATIONS: Production PostgreSQL and Alpaca Connect app credentials are absent.
The real universe, event, account-risk, scheduler, WebSocket worker, and durable shadow
receipt assembly remain incomplete. Credentials pasted in task history are exposed and
must be rotated before authenticated master verification.

RISKS: The broker mutation methods now exist in source, so release flags, PAPER-host
assertions, intent persistence, AEGIS, quote freshness, and reconciliation controls must
remain mandatory. Neither execution flag is enabled and no order endpoint is exposed to
customers or operators.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude should review only the quant-to-order boundary,
action mapping, and preserved lifecycle economics. Do not rebuild the broker adapter.

NEXT RECOMMENDED TASK: Provision production PostgreSQL, rotate exposed credentials,
verify the master account read-only, then connect real universe, event, positions, and
open-order state into persisted shadow cycles. Do not authorize the first PAPER order yet.

## 2026-09-11 provider provenance correction

OWNER: Codex

TASK: Port the remaining semantic correction from Claude commit `f3d7f38` onto the
newer canonical runtime without merging the old branch wholesale.

FILES CHANGED: THETA new-risk orchestration and shadow-cycle provenance, their tests,
and decision/handoff records.

WHAT WAS IMPLEMENTED: Provider origin now distinguishes successful values,
successful-but-unknown values, failed calls, deterministic derivations, fixtures,
manual inputs, and unattempted paths. Data quality remains separate. Transient
provider failures produce `SYSTEM_HOLD`, while invalid authentication and required
entitlement failures retain `HARD_VETO`. Provider failure cannot count as `FULL_REAL`,
and provider incidents cannot be recorded as economic `PASS` outcomes.

TESTS RUN: Current TypeScript, Python quant, Playwright responsive/accessibility,
type checking, ESLint, build, secret scan, and dependency audit. PostgreSQL migration
and Redis verification remain mandatory CI merge gates.

TEST RESULTS: 326 TypeScript, 298 Python, and 16 Playwright tests passed locally.
Type checking, lint, build, secret scan, and dependency audit passed.

KNOWN LIMITATIONS: The cycle still lacks real Optionomics, event, positions,
open-orders, account-derived AEGIS, persistent receipts, and a production scheduler.

RISKS: Provenance describes evidence origin, not profitability or execution authority.
PAPER execution remains locked and no order was submitted.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude should start future R1 work from the new
post-merge main SHA and consume these origin and quality contracts without recreating
the provider gate.

NEXT RECOMMENDED TASK: Connect real Optionomics, positions, open orders, and
account-derived AEGIS into persisted shadow cycles. Keep execution locked.

## 2026-09-11 private team Alpaca Paper API-key connection

OWNER: Codex

TASK: Add the owner-authorized, temporary private team Alpaca Paper credential flow
without changing OAuth or enabling order submission.

FILES CHANGED: Environment contract, common broker credential provider, read-only
Paper verifier, customer store, migration 009, customer API and account UI, tests,
API contract, and decision record.

WHAT WAS IMPLEMENTED: Authenticated same-origin HTTPS users can submit their own
Paper API key and masked secret field. The server accepts only the exact Alpaca Paper
host, verifies account and options facts plus positions, open orders, and clock,
encrypts a key bundle with customer-bound AES-256-GCM, and returns only a masked
account plus safe read facts. Connect, replace, reverify, disconnect, timestamps, and
health are supported. OAuth is preserved behind the same credential-provider
interface. Order submission remains locked.

TESTS RUN: ESLint, TypeScript checks, 330 Node tests, production build, security scan,
targeted Playwright credential-flow verification, and the full responsive,
accessibility, and screenshot suite. Migration 009 and SQL invariants are part of the
Linux CI database gate.

TEST RESULTS: Local deterministic and browser tests pass. Secret scan reports zero
findings. Visual inspection shows the masked Paper form without clipping or overflow.

KNOWN LIMITATIONS: The linked Vercel project has no database resource. Installing the
free Neon integration requires the account owner to accept Vercel Marketplace and
Neon legal terms. Docker Desktop is not currently reachable locally, so PostgreSQL
and Redis validation must run in GitHub CI until the Vercel database exists.

RISKS: The legacy encrypted table retains its OAuth-oriented name for migration
compatibility, though its records are discriminated by the follower connection
method. Private API-key beta must remain limited to trusted testers and PAPER.

WHAT THE OTHER AGENT SHOULD REVIEW: The shared credential-provider boundary and safe
read projection only. No quant methodology or strategy logic changed.

NEXT RECOMMENDED TASK: After the owner accepts the Neon terms, create and attach the
free production database, apply migrations through 009, pull the resulting production
environment safely, and execute a real tester connect/read/disconnect smoke test. Do
not place an order.

## 2026-09-11 Neon production database and real-state R1 integration

OWNER: Codex

TASK: Provision the attached Neon database, verify the deployed private Paper account
path, and integrate Claude's latest non-conflicting real-state R1 runtime work.

FILES CHANGED: Canonical database migration and verification tools, plus the files from
Claude branch `claude/theta-r1-real-state`. No customer credential, environment file,
temporary audit endpoint, or temporary audit token remains in the repository or Vercel.

WHAT WAS IMPLEMENTED: Neon Production and Preview variables were confirmed as Vercel
Sensitive values. Migrations 001 through 009 were applied in order over an unpooled Neon
connection. All seven SQL invariant suites passed against Neon. Reusable migration and
verification commands now choose a session-capable migration URL before any pooled
runtime URL. Claude's R1 work added real Alpaca account, position, open-order, clock,
calendar accessor, asset-universe, stock-history, optionability, Optionomics chain,
contract merge, and account-exposure inputs to the non-executing shadow cycle.

TESTS RUN: 399 TypeScript tests, 298 Python tests, ESLint, TypeScript check, production
build, security scan, real Neon migrations and SQL invariants, production root and API
smoke tests, read-only master Alpaca and Optionomics verification, and a deployed
customer registration/session/private-connector rejection test.

TEST RESULTS: All local and GitHub CI gates passed. Production root returns HTTP 200
through Vercel's authenticated private deployment. Alpaca Paper account, configuration,
clock, calendar, IEX stock data, option-contract discovery, indicative option snapshots,
positions, open orders, account activity, and corporate actions returned successful
read-only responses. OPRA returned HTTP 403 `NOT_ENTITLED`, while INDICATIVE returned
HTTP 200. Optionomics documented contracts, authentication, symbol metrics, option
chain, history, flow, and events returned HTTP 200. The database reports zero broker
orders, zero active followers, and zero active customer credentials.

KNOWN LIMITATIONS: A real tester has not yet supplied a separate private-beta Alpaca
Paper credential through the deployed form. Valid customer connect, encrypted Neon
persistence, reverify, replace, and disconnect are covered by deterministic integration
tests, but the deployed real-credential journey cannot be claimed until a tester enters
their own credential. The master deployment credential was intentionally not reused as
a customer credential. The shadow cycle still lacks durable FusionSnapshot/opportunity
persistence, real event-state assembly, a production scheduler, and complete management
and reconciliation workers.

RISKS: INDICATIVE data is reachable, but OPRA is not entitled. No first Paper order may
use an unapproved feed assumption. Several AEGIS families still depend on explicitly
manual or unavailable inputs, and current shadow policy defaults are research values.

WHAT THE OTHER AGENT SHOULD REVIEW: The merged real-state R1 provider and cycle files
only at a release boundary. Claude must not commit or push under the current owner rule.

NEXT RECOMMENDED TASK: Add durable shadow snapshot, opportunity, and decision persistence,
then wire real event state and a restart-safe scheduler. Keep both Paper execution flags
false and `PAPER_PAUSE_NEW_ORDERS=true`.

## 2026-09-11 Canonical-domain customer connection correction

OWNER: Codex

TASK: Make the private tester sign-in and Alpaca Paper connection sequence explicit,
resume the exact Copy THETA step after authentication, and preserve safe connection
state during transient provider failures.

FILES CHANGED: Customer auth/API/readiness contracts, Paper account and Copy THETA UI,
private-connection verification behavior, browser and unit tests, and decision/handoff
documentation.

WHAT WAS IMPLEMENTED: The Copy THETA flow now distinguishes Trading Bots credentials
from Alpaca Paper API credentials, offers separate sign-in and tester-registration
actions, and returns through a server-allowlisted internal path. Authenticated testers
can enter Paper API credentials directly in the same Copy THETA step. The connected
card includes cash, equity, buying power, options buying power, both options levels,
position/order counts, market state, and verification time. Provider errors are
customer-safe. Transient reverify failures preserve the stored connection, while a
confirmed 401 marks it for attention. Order submission remains locked.

TESTS RUN: ESLint, TypeScript check, 401 Node tests, production build, security scan,
18 Playwright journeys across desktop/tablet/mobile with WCAG checks, 298 Python tests,
and visual inspection of the sign-in and Paper credential screens.

TEST RESULTS: All repository gates pass. Reticle CLI reported `no_flows`, so it could
not issue a visual verdict. Playwright screenshots and accessibility assertions were
used as the verified visual fallback.

KNOWN LIMITATIONS: A genuine tester credential is still required to prove the deployed
successful connection and persistence journey. The master credential remains isolated
and was not reused. No Paper or live order was submitted.

RISKS: Vercel Deployment Protection still requires authorized access to the private
site. OPRA remains not entitled, so no future execution gate may assume OPRA quality.

WHAT THE OTHER AGENT SHOULD REVIEW: The auth return-path allowlist and the reverify
health transition only. No quant module or strategy rule changed.

NEXT RECOMMENDED TASK: Deploy this slice to the canonical alias, run real Neon and
customer-session smoke checks, then continue durable shadow evidence and scheduler work.

## 2026-09-11 Shadow calendar and temporal consistency

OWNER: Codex

TASK: Close the market-calendar/session and mixed-timestamp gaps in the non-executing
THETA shadow cycle.

FILES CHANGED: `src/theta/theta-shadow-cycle.ts`, its focused test suite, and project
decision/handoff records.

WHAT WAS IMPLEMENTED: Every cycle captures one decision timestamp, retrieves the Alpaca
calendar independently from the clock, records calendar data and provenance in the
FusionSnapshot, and holds new risk when an open clock cannot be reconciled to a dated
exchange session. No order endpoint or execution flag changed.

TESTS RUN: ESLint, TypeScript check, 402 Node tests, production build, and security scan.

TEST RESULTS: All gates pass. A focused fixture proves open-clock plus missing-calendar
returns `SYSTEM_HOLD/MARKET_SESSION_UNCONFIRMED`.

KNOWN LIMITATIONS: Real event-state assembly, remaining AEGIS families, durable shadow
evidence persistence, and production scheduler invocation remain incomplete.

RISKS: Calendar truth is required only as an explicit precondition for an open-session
new-risk scan. Closed-market handling stays clock-authoritative and fail-safe.

WHAT THE OTHER AGENT SHOULD REVIEW: The calendar/session precondition only. No quant
methodology or policy threshold changed.

NEXT RECOMMENDED TASK: Persist FusionSnapshot, opportunity, and decision evidence using
the existing migration 003 schema, then add a lease-backed scheduler. Keep execution
locked.

## 2026-09-11 Contract-multiplier safety integration

OWNER: Codex

TASK: Review and integrate Claude commit `645b977` without accepting an implicit
100-share economics assumption.

FILES CHANGED: Alpaca option-contract parsing, option-chain normalization, THETA cycle
fixtures, multiplier safety tests, and this handoff.

WHAT WAS IMPLEMENTED: Alpaca contract `size` is preserved as the contract multiplier.
Missing or malformed provider multipliers remain UNKNOWN and force the normalized
contract non-executable. A caller default may satisfy the normalized storage schema,
but can never authorize economics or execution. A misleading shadow-cycle test that
treated a premium/collateral proxy as calibrated positive expectancy was removed. The
cross-symbol frontier's dedicated tests continue to require positive after-cost EV and
positive return per capital-day before any executable selection.

TESTS RUN: TypeScript check, ESLint, 533 Node tests, production build, and security scan.

TEST RESULTS: 530 passed, 3 PostgreSQL-only tests skipped locally, 0 failed. Security
scan reported zero findings.

KNOWN LIMITATIONS: The production runtime still lacks a calibrated positive-EV model
and an always-on worker deployment, so this correction cannot make a first Paper order
ready by itself.

RISKS: Alpaca responses that omit contract size will now reduce opportunity throughput.
That is intentional until exact contract economics can be verified.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude should consume the fail-closed multiplier
contract and must not reintroduce proxy-based executable ranking.

NEXT RECOMMENDED TASK: Run disposable PostgreSQL CI, integrate the verified commit into
current main, and keep all Paper and live broker submissions locked.

## 2026-09-11 Autonomous runtime and broker reconciliation milestone

OWNER: Codex

TASK: Build the first restart-safe, browser-independent THETA PAPER runtime slice, add
durable broker/replay evidence, audit historical data sufficiency, and review Claude's
new R6 research commits without weakening production controls.

FILES CHANGED: Environment contract, Vercel worker entry point, scheduler contracts and
PostgreSQL repository, PAPER broker read methods, broker reconciliation worker, replay
contracts, migration 015 and SQL invariants, Optionomics historical query support,
database verifier, historical-data audit, tests, and decision/handoff records.

WHAT WAS IMPLEMENTED: An authenticated, bounded serverless worker now has deterministic
minute jobs, fixed safety priority, exclusive leases, heartbeats, bounded retry,
reconciliation-before-retry, and durable cycle results. The master reconciliation path
verifies broker identity and reads account, positions, all orders, activities, clock,
and calendar without calling a mutation method. Matched broker orders can advance only
through the existing order-intent state machine. Contradictory states are quarantined.
Unmatched broker facts are immutable `EXTERNAL_OR_UNKNOWN` records. Replay observations
and future labels are physically separated with temporal and append-only constraints.
Migration 015 was applied to Production Neon and all database invariants passed.

TESTS RUN: TypeScript check, ESLint, 543 runnable Node tests plus three PostgreSQL-only
skips, 349 Python tests, focused scheduler/broker tests, production build, security
scan, migration 015 against Neon, the migration 015 SQL invariant suite, and the full
production database verifier.

TEST RESULTS: All runnable tests, lint, type checks, and build passed. The security scan
reported zero findings. Neon reports 15 migrations, 18 required tables, the master role
and self-copy protection enforced, optional follower-limit semantics enforced, one
active encrypted credential, and zero broker orders.

KNOWN LIMITATIONS: The Vercel cron and worker environment cannot be enabled or observed
from the current browser session because Chrome is still signed in as
`puppyhugs.help@gmail.com`, which receives 404 for `skillswap7/trading-bots`. The local
Vercel token is invalid and the local encryption values are intentionally redacted.
Production quant opportunity input assembly is also unavailable inside the current
Node serverless worker, so new-risk scanning reports DEGRADED and cannot create an
order. Docker Desktop is unavailable locally, leaving three disposable-PostgreSQL tests
to GitHub CI.

RISKS: Vercel rejected the one-minute cron because the project plan permits only a daily
schedule. A daily imprecise invocation is unsafe and was not substituted. The runtime
remains read-only and returns a degraded result for incomplete management, WAIT, or
opportunity inputs. `READY_FOR_FIRST_PAPER_ORDER` remains NO.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude should correct and retest the R6 research
issues recorded in `docs/DECISIONS.md`. No Claude commit from `4c8fe61` through
`f182aa0` was merged. Documentation-only commit `7f3f610` was selectively integrated
after removing its dependency on the rejected ablation implementation. Claude must not
modify the production worker, account, execution, or migration files.

NEXT RECOMMENDED TASK: Restore the correct Vercel owner session, verify plan support,
configure a strong `CRON_SECRET` and enable the read-only worker, then inspect its first
Neon-backed reconciliation cycle. Keep all broker mutation gates locked. Correct the R6
research modules on Claude's branch before selective integration.
