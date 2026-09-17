# Codex handoff: standalone platform Phase 1

## 2026-09-17: R8A bootstrap management and live-session quote qualification

OWNER: Codex.

TASK: Split first-canary bootstrap management from empirical promotion and perform open-session execution-quote qualification.

FILES CHANGED: Bootstrap management provider, runtime provider authority contract, first-canary readiness contract, execution timestamp qualifier, Alpaca indicative semantic adapter, Optionomics qualification evidence, phase ledger, provider fallback decision, tests, decisions, and handoff.

WHAT WAS IMPLEMENTED: Added an explicit bounded Paper bootstrap management authority separate from empirical promotion. The resident runtime now has a fail-closed lifecycle policy for a first canary without claiming profitability. It defaults to HOLD, RECOVERY_WAIT, or HOLD_CC, delegates broker-confirmed expiration and assignment transitions to the structural path, and permits risk-reducing CSP or stock exits only on an explicit AEGIS HARD_VETO with complete executable state. New-risk management actions stay blocked. Execution quote freshness now always requires a provider timestamp. Alpaca's free option feed has an explicit indicative-only adapter that cannot pass the execution qualifier. Production Optionomics open-session evidence is retained with timestamp coverage.

TESTS RUN: Full Node suite, TypeScript check, ESLint, and the Production open-session Optionomics qualification route.

TEST RESULTS: 946 Node tests ran with 936 passed, 10 database-only skips, and 0 failures. TypeScript, ESLint, build, security scan, browser tests, Python tests, disposable PostgreSQL migrations/invariants, and customer persistence passed locally or in CI. Optionomics authentication passed. The final Production open-session run made six HTTP 200 calls and found 50,670 two-sided observations, but zero provider-timestamped observations, so order pricing remains unqualified. Aiven validated through migration 054 with zero invalid indexes or unvalidated constraints. The deployed SHA and Windows worker SHA are `226c3782923c3515e49040252c05572e9333c6af`.

KNOWN LIMITATIONS: No exact-contract fresh execution-price authority is currently entitled and qualified. The bootstrap policy is an operational safety policy, not an alpha model. New entries remain paused. No Paper order was submitted.

RISKS: Enabling entries before a provider passes the exact timestamped two-sided contract would make receipt time look like freshness. Scaling beyond one canary without empirical management evidence would exceed the bootstrap policy's intended authority.

WHAT THE OTHER AGENT SHOULD REVIEW: Bootstrap action selection, provider-timestamp requirement, and any later empirically promoted challenger against the immutable Paper evidence.

NEXT RECOMMENDED TASK: Qualify Alpaca OPRA if the existing account receives entitlement, or make an explicit third-provider decision using the fallback report. Then assemble a fresh exact-candidate receipt and allow at most one naturally qualifying Paper canary.

## 2026-09-17: exhaustive local and agent forensic recovery

OWNER: Codex.

TASK: Exhaust local, agent, Git, export, temp, download, editor, WSL, Docker and
retained-origin copies before classifying legacy evidence as Neon-only.

FILES CHANGED: Migration 053, forensic sweep and chunk importer, authenticated
runtime import operation, database validation, tests, and recovery receipts.

WHAT WAS IMPLEMENTED: A reproducible source catalog, deep research-output parse,
unreachable-Git scan, exact missing-key search, immutable export-variant archive,
and replay-safe Aiven import. The audit corrected a schema error in the earlier
missing-parent analysis. There are 553 unresolved UUID parents, not 1,548. The
other 995 values are typed text strategy-frontier references and cannot reference
the UUID parent table.

TESTS RUN: TypeScript, ESLint, the full Node suite, deterministic forensic sweep,
and migration/invariant checks in CI and Production after release.

TEST RESULTS: Local TypeScript and ESLint passed. All 925 runnable Node tests
passed, 10 database-only tests were skipped. Record Production migration/import
and final CI results in the release response.

KNOWN LIMITATIONS: Docker Desktop's engine was unavailable. OneDrive offline
placeholders were not hydrated. The 553 keys have references but no complete
parent payload outside currently inaccessible Neon.

RISKS: A reference must never be converted into an invented parent. Historical
payload variants are research evidence only and cannot overwrite runtime truth.

WHAT THE OTHER AGENT SHOULD REVIEW: No quant or strategy behavior changed.

NEXT RECOMMENDED TASK: When Neon becomes readable, recover the 553 exact parents
into isolated staging, compare hashes, and backfill only provenance-safe rows.

## 2026-09-15: cross-branch candidate evidence

OWNER: Codex.

TASK: Close the relational evidence gap between the canonical five-branch strategy frontier and the R6 dataset export.

FILES CHANGED: Migration 039, PostgreSQL cycle persistence, research export, database verification, tests, and canonical completion documentation.

WHAT WAS IMPLEMENTED: Every canonical branch and candidate is now projected into immutable relational evidence. Native leg shape, structural economics, blockers, unknowns, sizing, selection, and execution-disabled status are preserved. The deterministic export includes the projections under each frontier.

TESTS RUN: TypeScript, ESLint, focused projection tests, full Node/Python/browser/build/security suites, PostgreSQL migration and schema invariants through CI.

TEST RESULTS: Record final CI and Production migration status in the release receipt after push.

KNOWN LIMITATIONS: Existing Production cycles predate migration 039 and are not backfilled. New rows begin with newly persisted frontiers. Real outcomes remain unavailable.

RISKS: Research consumers must keep these candidate features separate from future labels. The database and export preserve that boundary.

WHAT THE OTHER AGENT SHOULD REVIEW: R6 loaders may consume the nested branch/candidate projections, but must not reimplement Production selection.

NEXT RECOMMENDED TASK: Collect authenticated point-in-time Optionomics observations or qualify another already-approved execution quote path. Do not weaken the quote gate.

## 2026-09-14: professional reference pack and Optionomics contract hardening

OWNER: Codex.

TASK: Verify the owner's 12-repository professional reference pack at exact
SHAs, extract file-level methods, and deepen the Optionomics observation and
feature contracts without changing execution authority.

FILES CHANGED: Professional reference pack, Optionomics census/data map and
research ledger, Optionomics adapter/feature routing/persistence, migration 029,
database verification, tests, decisions and handoff.

WHAT WAS IMPLEMENTED: Current default branches, SHAs, licenses, source, tests
and implementation symbols were verified for all 12 repositories. Documented
Optionomics chain requests now send only `date`. Raw observations add request
timing, safe parameters, HTTP status, rate-limit metadata, documentation/version,
session date and a one-way credential identity reference. Feature v2 adds
transparent quote and CSP structural economics. Strategy destinations use typed
feature-family allowlists. Authenticated readiness covers every safe, current,
documented GET route sequentially.

TESTS RUN: Full Node, Python, TypeScript, ESLint, build, security, PostgreSQL
migration/invariants and CI before release.

TEST RESULTS: 718 Node tests passed, 4 database-only tests skipped locally, 452
Python tests passed, lint/type/build/security passed, security findings zero,
Production Neon migration 029 and all invariants passed, and GitHub CI including
browser, PostgreSQL and Redis passed. The authenticated Production census
persisted 35 Optionomics capabilities with zero broker orders and fills.

KNOWN LIMITATIONS: Full authenticated schemas, units, historical availability
time, flow print detail, event coverage, fitted surface research and model
cross-checks remain partial until verified. Optionomics remains research-only
for quotes and empirical EV remains unready.

RISKS: Public docs and entitlements can change. A documented route can return an
empty array or lack a feature, so reachability never implies useful data.

NEXT RECOMMENDED TASK: Use persisted census results to implement only the
verified missing normalizers, then collect PIT evidence for R6 ablations.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude's `9e7a679` skew review was accepted
and repaired. Skew now stays UNKNOWN without a caller-supplied proximity policy
and rejects far-from-25-delta pairs. Its term-structure challenger is deferred
until real data can compare tenor and moneyness controls.

## 2026-09-14: R7 execution-price and TCA vertical slice

OWNER: Codex.

TASK: Implement the provider-neutral quote, deterministic adaptive pricing, canonical
TCA, immutable evidence persistence, and stricter management-state checks requested
by the R7 closure directive without activating broker submission.

FILES CHANGED: New execution quote, adaptive policy, TCA and PostgreSQL evidence
store modules, migrations 025-026, database verification, management input/frontier
guards, unit and SQL tests, decisions and handoff.

WHAT WAS IMPLEMENTED: Fresh authenticated execution quote qualification with
connection/subscription/sequence guards. Direction-correct bounded price concessions,
economic cancellation, optional size-weighted microprice, direction-aware TCA, and
immutable price/TCA evidence. Management now fails closed on missing/stale account
state, malformed quote numbers, invalid BBO, non-positive assignment capacity, and
unapproved AEGIS state.

Option order lineage now stores provider-neutral qualified quote semantics. Canonical
commands use QUALIFIED_OPTION_BBO, while Alpaca remains the only broker mutation
adapter. Session-recorded research semantics remain forbidden by a database check.

TESTS RUN: Focused Node tests, full Node/Python, TypeScript, ESLint, build, security.
PostgreSQL migration/invariants and browser regression run in CI after push. Reticle
was skipped because there is no UI surface.

TEST RESULTS: Record final local, CI and Production results in the release response.

KNOWN LIMITATIONS: The adaptive loop is a pure policy plus persistence boundary, not
yet wired to a live quote subscription and coordinator timer. TCA has no real fills.
Management utilities remain UNKNOWN until empirical models qualify. Paper stays
locked.

RISKS: A caller must requalify each quote and recompute economics before replacement.
Receipt-time freshness needs provider-specific proof. No generic boolean may promote
recorded research data.

WHAT THE OTHER AGENT SHOULD REVIEW: TCA sign conventions, common-horizon action
economics, and empirical boundary provenance. Production TypeScript remains runtime
authority.

NEXT RECOMMENDED TASK: Wire quote-qualified adaptive observations through the Paper
coordinator with reconciliation before every mutation, then gather real PIT evidence.

## 2026-09-13: quote freshness, UNKNOWN parsing and management certainty repair

OWNER: Codex.

TASK: Reconcile the new master handoff with implementation and repair concrete
decision-input defects without activating execution.

FILES CHANGED: Trusted quote validator, Optionomics parser, management frontier,
their tests, this handoff and THETA_PROFITABILITY_CLOSURE_REVIEW_2026-09-13.md.

WHAT WAS IMPLEMENTED: Original provider quote age is mandatory, malformed age
policies fail closed, invalid numeric values stay null, and marked P&L is never
presented as certain pre-trade liquidation proceeds.

TESTS RUN: 46 focused tests, full Node, Python, TypeScript, ESLint, build, security.

TEST RESULTS: 694 Node passed, 4 local DB skips, 0 failed. 452 Python passed.
Static/build checks passed and secret scan found zero issues.

KNOWN LIMITATIONS: Engineering is not globally complete. See the closure review
for management feasibility, empirical utility, quote integration and execution gaps.

RISKS: Field availability must not be mistaken for execution freshness. Cashflow
must not become profit while open liabilities remain. No execution gates changed.

WHAT THE OTHER AGENT SHOULD REVIEW: Common-horizon management economics and
research label semantics, preserving canonical runtime ownership.

NEXT RECOMMENDED TASK: Complete management risk/quote feasibility integration and
bounded execution policy evidence, then gather PIT evidence without invented fills.

## 2026-09-12: R4 engineering closure, R7 non-data closure, and research export bridge

OWNER: Codex, canonical integration owner.

TASK: Complete the disabled follower-copy engineering path, build a deterministic
no-network first-order preflight, and make real R6 evidence directly exportable.

FILES CHANGED: Copy contracts and planner, broker lifecycle orchestrators, one
cohesive migration 022, readiness and preflight contracts, research exporter and CLI,
database verification, tests, package scripts, ignore rules, and operator docs.

WHAT WAS IMPLEMENTED: Tenant-bound chain participation, skipped-entry exclusion,
follower-owned lifecycle truth, explicit roll legs, direction-aware copy economics,
freshness and timing evidence, conservative nullable capacity, immutable copy audit
events, automatic broker-confirmed master copy events, disabled planned intents,
deterministic export bundles, and a dry-run request that stops before broker I/O.

TESTS RUN: Full Node and Python suites, TypeScript, ESLint, build, security scan,
Production Neon migration and schema verification. Final Playwright and CI status are
recorded in the release report.

TEST RESULTS: Migration 022 applied successfully to Neon and the database verifier
confirmed 22 migrations, the participation ledger, tenant guard, and hard execution
lock. No point-in-time rows exist yet, so the export command correctly reports a data
blocker and creates no artifact.

KNOWN LIMITATIONS: There is no real follower account, no follower Paper fill, no
resolved economic episode, and no empirically qualified EV model. Local Docker is not
running, so disposable PostgreSQL and Redis validation remains delegated to CI.

RISKS: The first open market session may reveal provider or entitlement limits. The
copy engine is structurally ready but cannot be validated against real follower drift
until a separate tester account exists.

WHAT THE OTHER AGENT SHOULD REVIEW: Research export schema consumption and empirical
gate semantics only. Python must not become runtime authority, and directionless
follower price deterioration must not be ported.

NEXT RECOMMENDED TASK: Let the pinned shadow worker collect the first complete market
session, export it, and run the research pipeline. Do not submit any order.

CLAUDE REVIEW: The single final fetch inspected
`origin/claude/theta-r1-real-state` at `f6251966d528ef6e9d2a82894b0a54780c8f6d93`.
The direction-aware Python follower economics are `RESEARCH_ONLY` because the same
correction is now enforced by the canonical TypeScript planner. The Python phase
manifest and R7/R9 evidence packets are `RESEARCH_ONLY`; they describe research
readiness but cannot control Production. The export loader's expanded future-label
firewall is `PORT` in substance and already matches the TypeScript firewall, so no
duplicate source change was required. The remaining broad branch delta is `DEFER`.
The branch was not merged wholesale because it also diverges from newer Production
account, migration, runtime, and documentation work.

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

## 2026-09-11 Direction-aware execution and expiry isolation

OWNER: Codex

TASK: Close the unsigned execution-cost and contract-batch contamination gaps identified
in the current R1/R2 directive.

FILES CHANGED: Python execution-quality model and JSON boundary, TypeScript response
contract and orchestrator call, option normalization/ingestion, focused tests, and
decision/handoff records.

WHAT WAS IMPLEMENTED: Execution-quality contract v2 now requires and returns the exact
option position intent. Buy and sell limits use opposite BBO directions for fillability
and remaining execution concession. THETA-Q sends `SELL_TO_OPEN`. Non-finite IV is
isolated to the affected contract, and T=0 or expired contracts are non-executable
without contaminating future-expiry siblings.

TESTS RUN: 549 Node tests, 352 Python tests, ESLint, TypeScript check, Production build,
and security scan.

TEST RESULTS: 546 Node tests passed with three local PostgreSQL-only skips, all 352
Python tests passed, and all static/build/security gates passed with zero secret-scan
findings.

KNOWN LIMITATIONS: THETA consumes provider IV and has no Production IV solver, so no
claim is made about solver convergence or impossible-price handling. The always-on
worker remains externally blocked by the Vercel plan and inaccessible owner project
session described above.

RISKS: `preSlippageExpectedUtility` remains a per-share model input by convention and
needs a future explicit unit rename when the calibrated execution/TCA model replaces
this deterministic heuristic. No execution authorization was enabled.

WHAT THE OTHER AGENT SHOULD REVIEW: The v2 position-intent field and BBO-direction
formulas only. Strategy thresholds, calibrated probabilities, and entry policy did not
change.

NEXT RECOMMENDED TASK: Run the same checks in CI with PostgreSQL/Redis, then activate
the read-only worker only after a supported always-on host and strong runtime secret are
available. Keep every broker mutation gate locked.

## 2026-09-12 Host-independent worker and broker lifecycle evidence

OWNER: Codex

TASK: Defer permanent hosting, package a portable resident worker, make the first-order
readiness boundary executable, and close broker lifecycle evidence gaps without placing
an order.

FILES CHANGED: Worker entry point/runtime, typed environment, two-target Dockerfile,
worker Compose example, broker reconciliation persistence, lifecycle evidence
classifier, deterministic first-order receipt, migration 016 and verifier, focused
tests, README, decisions, worker documentation, and Claude review ledger.

WHAT WAS IMPLEMENTED: A generic Node plus Python worker validates database, Python, and
locked execution state, exposes sanitized health/readiness, prevents overlapping runs,
uses the existing lease-backed scheduler, and shuts down gracefully. The readiness
receipt requires complete known broker, market, option, BBO, economics, AEGIS, durable
identity, scheduler, reconciliation, and idempotency evidence. Broker reconciliation
now stores complete immutable point-in-time positions and hashed activity facts.
Lifecycle classification requires broker activity plus position movement for put
assignment, put expiry, covered-call expiry, and call-away. Migration 016 was applied
to Production Neon and all repository invariants passed with all order gates locked.

TESTS RUN: 564 Node tests, 352 Python tests, TypeScript, ESLint, production build,
security scan, diff check, migration 001-016 idempotent replay, and Production database
verification.

TEST RESULTS: 561 Node passed and three disposable-local-PostgreSQL tests skipped. All
352 Python tests passed. TypeScript, ESLint, build, and security scan passed with zero
findings. Neon reports 16 migrations, 20 required tables, one master role, one encrypted
credential, all account/copy/runtime/lifecycle protections enforced, and zero broker
orders.

KNOWN LIMITATIONS: Docker Desktop's Linux engine is stopped, so the image could not be
built locally. No always-on worker is deployed by owner direction. Production
management still lacks a complete assembler for Greeks, economic marks, concentration,
event, and AEGIS state. The production opportunity job therefore remains degraded and
does not produce an OrderIntent. Historical calibration is insufficient, so
`EV_MODEL_NOT_EMPIRICALLY_READY` remains a readiness blocker.

RISKS: Lifecycle evidence is persisted and deterministically classified, but the
classifier is not yet allowed to mutate economic-chain state. Atomic option-leg,
assignment/expiration event, stock-lot, ledger, and chain updates must be completed
together to avoid economically inconsistent partial transitions.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude should repair the R6 issues listed in
`docs/reviews/CLAUDE_THETA_R1_REAL_STATE_REVIEW.md`. It must not change worker,
execution-control, customer identity, or migration files.

CLAUDE COMMITS REVIEWED: All commits through `9d3172e`. New repair `531ae8b` correctly
addresses the six previously reported defects but depends on the unintegrated R6 base,
so it is `REPAIR_AND_PORT`, not a wholesale merge. `9d3172e` is `DEFER` because it does
not close the current runtime or empirical-data blockers.

NEXT RECOMMENDED TASK: Build the PostgreSQL management-input projection and atomic
broker-confirmed lifecycle writer, then connect the safe opportunity cycle to durable
receipt generation. Keep every broker mutation locked until the full real receipt is
YES and has been reported before the first POST.

## 2026-09-12 Profitability decision vertical slice

OWNER: Codex

TASK: Replace the generic management-input blocker with real persisted inputs, explicit
action frontiers, earned global-WAIT evidence, and atomic lifecycle accounting.

FILES CHANGED: Decision evidence taxonomy, management input projection, action frontier,
broker position normalization, autonomous runtime, lifecycle application store, migration
017, database verifier, tests, profitability runtime note, Claude review, decisions, and
handoff.

WHAT WAS IMPLEMENTED: Hard mechanical blockers are separate from soft ranking evidence.
Global WAIT requires exhaustive surface evidence. Each open economic chain gets an
immutable input snapshot and complete state-appropriate action frontier. Missing Greeks,
IV, events, portfolio risk, or empirical economics remain explicit. Assignment, expiry,
option close, CSP and CC rolls, covered-call open, call-away, and stock disposal now have
one transactionally consistent and idempotent PostgreSQL application path.

TESTS RUN: 577 Node tests, 352 Python tests, TypeScript, ESLint, production build,
security scan, browser tests, migrations and schema invariants, and four disposable
PostgreSQL integration tests. CI run 34650080986 executed the complete Linux/PostgreSQL/
Redis path. Migration 017 was then applied idempotently to Production Neon and the
production database verifier was rerun.

TEST RESULTS: 573 Node tests passed locally with four database-only skips. All 352
Python tests passed. CI passed every check, including all four PostgreSQL tests and the
broker-confirmed lifecycle replay test. The security scan found zero findings. Production
Neon reports 17 migrations, 23 required tables, one master Paper role, one encrypted
credential, locked Paper execution, and zero broker orders.

KNOWN LIMITATIONS: The empirical continuation-EV, assignment, recovery, tail, and fill
models are not promoted. No action can claim calibrated expected profit or win
probability. The atomic lifecycle writer is not yet called automatically by the broker
reconciliation classifier, so broker-confirmed terminal facts still require that final
orchestration link before unattended lifecycle mutation is safe. External worker hosting
and CRON_SECRET remain intentionally deferred.

RISKS: Existing live data does not yet populate every management field. The runtime will
persist the frontier and report a degraded empirical-readiness state instead of selecting
a profit-maximizing action from incomplete evidence.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude commit `48b522a` was reviewed file by file.
Research utility code that substitutes zero for unknown penalty inputs was not adopted.
Claude must continue using its isolated branch and must not change production runtime,
execution, account, or migration files.

NEXT RECOMMENDED TASK: Accumulate point-in-time shadow and resolved whole-chain evidence,
calibrate the action-value distributions, and promote only a paired out-of-sample policy
that improves after-cost economics without weakening drawdown or tail-risk controls.

## 2026-09-12 Strategy package integration

OWNER: Codex

TASK: Reconcile the new THETA strategy documents with canonical runtime, add a validated
five-branch strategy package, repair UNKNOWN economics handling, and link confirmed
broker terminal evidence to the atomic lifecycle writer.

FILES CHANGED: Strategy package, aggregate Node-to-Python contract, underlying Pareto
selector, strategy decision envelope, broker lifecycle application bridge, new-risk
assembly, persistence, sizing and lifecycle tests, the complete strategy documentation
set, decisions, and handoff.

WHAT WAS IMPLEMENTED: The existing six-family router is mapped to five business
branches without duplicating THETA_R. Each branch has a strict, immutable, hashed config
and an execution-disabled status. Research lattices are explicit without becoming
profitability claims. The strategy response preserves UNKNOWN empirical values and can
never authorize execution. New-risk selection requires known positive after-cost EV
and capital-day return. Missing bid no longer becomes zero. Persisted decisions now use
a versioned envelope with strategy version, branch, alternatives, second-best,
economics, AEGIS state, invalidation conditions, and reevaluation triggers. Broker-
confirmed assignment and expiration can reach the atomic writer only through a hashed,
type-checked evidence bridge.

TESTS RUN: 595 Node tests, 355 Python tests, 22 Playwright browser tests,
TypeScript, ESLint, production build, security scan, diff check, Production Neon
verification, and GitHub CI with disposable PostgreSQL and Redis.

TEST RESULTS: 591 Node tests passed and four disposable-local-PostgreSQL tests skipped
locally. All 355 Python and 22 browser tests passed. TypeScript, ESLint, build, and
security passed with zero secret findings. CI run `34655396596` passed the full Linux,
PostgreSQL, Redis, browser, and database integration matrix. Production deployment for
`d43191bcb45954700de191d2cef1903a7238179a` is READY, the canonical root returns 200,
and Neon reports migration 017, 23 required tables, locked execution, and zero orders.

CLAUDE REVIEW: Commits `8fa0909` and follow-up repair `811da56` were reviewed file by file. Sizing monotonicity tests and
the UNKNOWN-first distributional contract were ported. Promotion and feature-taxonomy
ideas were accepted conceptually. Outcome-dependent strictness, opportunity-capture,
and routing-regret work remains deferred. The duplicate management action enum and its
original UNKNOWN-to-zero utility were rejected. `811da56` fixes that utility correctly,
but its parallel research config/registry was not ported because the canonical Production
strategy package now supplies one validated source of truth. No wholesale merge occurred.

KNOWN LIMITATIONS: Empirical EV, assignment, recovery, tail, fill, and action-value
models remain unready. Global WAIT evidence now carries best, second-best, and best-
rejected identities, but the single-underlying shadow cycle is not yet a complete
cross-account global frontier. Greeks and Optionomics event context are still UNKNOWN
when providers do not supply them. No always-on worker is deployed.

RISKS: A deterministic branch config cannot prove profitability. Branch promotion needs
resolved point-in-time whole-chain data and independent OOS evidence. The broker bridge
covers broker-confirmed assignment and expiration. Close, roll, CC open/close, and stock
disposal still require their existing explicit application assemblers to be attached to
the future worker after management economics are promoted.

WHAT THE OTHER AGENT SHOULD REVIEW: The strategy package contracts and research mapping
only. Claude must not modify Production execution, customer identity, migrations, or
worker code.

NEXT RECOMMENDED TASK: Persist candidate-funnel telemetry and complete the global
cross-symbol, management, recovery, CC, and redeployment frontier in SHADOW. Then build
the point-in-time resolved-episode dataset required to calibrate action values. Keep all
broker submission gates locked.

## 2026-09-12 R1/R2 closure and R6 evidence foundation

OWNER: Codex

TASK: Complete the Production-side point-in-time evidence, lifecycle orchestration,
management-first ordering, replay, label, and deterministic dataset-export foundation.

FILES CHANGED: Migration 018, candidate-cycle persistence, management input projection,
broker reconciliation and lifecycle orchestration, scheduler priority, research evidence
and export contracts, decision trigger and invalidation contracts, database verification,
tests, decisions, and this handoff.

WHAT WAS IMPLEMENTED: Every persisted evaluated candidate now receives a feature-only
point-in-time record with contract, BBO, Greeks and IV when observed, null-preserving
research families, account and portfolio state, AEGIS and execution state, reason codes,
provider timestamps, and complete version lineage. Candidate sets record search counts,
best, second-best, best-rejected, and missing search scope. WAIT decisions persist an
earned/unearned search proof. Decision quotes and subsequent observations have a replay
table. Resolved outcomes are physically separate. Counterfactuals can only be stored as
`BLOCKED_ON_DATA`. Dataset exports are bounded, deterministic, schema-versioned, and
hash-identified. The runtime applies broker-confirmed assignment and expiry before
management review. Aggregate and partial broker fills are persisted idempotently.

TESTS RUN: Full Node, Python, TypeScript, ESLint, production build, security scan,
Production migration, database invariant verification, and CI after push.

KNOWN LIMITATIONS: The Production evidence tables begin empty. Existing historical
rows cannot be backfilled as genuine point-in-time evidence. The single-underlying
shadow cycle records a partial candidate-set proof and cannot yet earn global WAIT.
No resolved whole-chain or management labels and no subsequent quote observations exist.
The runtime still needs a deployable opportunity scanner and always-on host before it can
accumulate a useful empirical sample.

RISKS: The empirical EV, fill, assignment, recovery, and action-value models remain
unready. Dataset infrastructure does not establish profitability. No order submission
gate changed.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude `811da56` remains selectively reviewed.
Its UNKNOWN-safe management repair is correct. Its parallel strategy registry and config
remain research-only because the Production TypeScript package is the runtime authority.
Execution-failure promotion gates and the feature family-role taxonomy are useful for R6.
No wholesale merge was performed.

NEXT RECOMMENDED TASK: Run real SHADOW cycles with a complete cross-symbol frontier,
capture subsequent BBO observations, resolve full economic chains, and export the first
non-empty reproducible dataset for paired OOS validation. Keep Paper submission locked.

## 2026-09-12 R6H real shadow activation

OWNER: Codex

TASK: Activate the Production-safe R6 evidence path while preserving the absolute
zero-order boundary.

FILES CHANGED: Migration 019, autonomous runtime, read-only broker contract, cross-symbol
shadow scan, point-in-time and replay stores, broker-fill lifecycle router, deterministic
outcome resolver, master SHADOW context provisioner, R6 readiness reporting, environment
loader, AEGIS UNKNOWN handling, tests, decisions, and research parity review.

WHAT WAS IMPLEMENTED: The runtime can only run in `THETA_SHADOW_ONLY` and has no broker
mutation methods. A bounded cross-symbol scan records completeness, members, candidates,
WAIT/PASS evidence, and deterministic +1m/+5m/+30m/EOD observation jobs. Market-closed
cycles record no fake candidate evidence. Confirmed fills route to atomic CSP, close,
roll, stock, covered-call, and call-away writers. External or unmatched broker activity
stays unknown. Outcome labels require a closed chain, fully resolved economic facts, and
known execution fees. The Production master now has one complete, versioned SHADOW bot
context backed by an encrypted credential reference.

TEST RESULTS: TypeScript, ESLint, build, security, 356 Python tests, focused Node tests,
and Production Neon invariants pass. The combined Node suite produced five Python bridge
timeouts under parallel process load. Every affected test file passed in isolation.
Migration 019 is applied. Neon reports one complete SHADOW context, zero broker orders,
and zero broker fills.

KNOWN LIMITATIONS: The market is closed and no genuine decision-time candidate scan has
run. Point-in-time rows, shadow candidates, subsequent BBO observations, and resolved
labels remain empty. Model training and strategy promotion remain blocked. Vercel cannot
provide an always-on process, so this phase only activates authenticated scheduled/manual
shadow cycles on the existing control plane.

RISKS: A bounded two-symbol scan is evidence collection, not proof that the bound is
economically adequate. Missing empirical action values stay UNKNOWN. No performance or
win-rate claim is supported.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude `4ffbd49` and follow-up `a744939` were reviewed.
The migration-018-aligned dataset contracts, fail-closed export loader, readiness state
machine, and R6H audit documents are approved for selective integration. Runtime and
Production schema authority remains TypeScript/PostgreSQL.

NEXT RECOMMENDED TASK: Run the first authenticated SHADOW cycle during an open confirmed
market session, inspect its first evidence audit, then accumulate enough resolved Paper
episodes for descriptive audit before any model fitting or strategy promotion.

## 2026-09-12 rapid closure: pinned laptop shadow runtime and disabled copy planning

OWNER: Codex

TASK: Close R1/R2 engineering, activate continuous read-only shadow collection on the
owner's Windows laptop, and advance safe R3/R4/R5 work without crossing the order boundary.

FILES CHANGED: Migrations 020 and 021, local worker runtime/lease store, authenticated
shadow handler, Windows Task Scheduler scripts, operator readiness UI, environment loader,
disabled copy planner, R6 quality reporting, database verification, tests, decisions, and
this handoff.

WHAT WAS IMPLEMENTED: A clean, pinned `origin/main` checkout now drives a one-minute
Windows Task Scheduler supervisor. It authenticates to Vercel with an ignored trigger
token, while provider, encryption, and Neon secrets remain server-side. Neon persists the
singleton lease, heartbeat, market state, provider health, cycle count, sleep gaps, and
immutable runtime events. The worker reconciles before scans, waits correctly while the
market is closed, and has no broker mutation API. A disabled copy planner now requires a
broker-confirmed master fill or lifecycle activity, rejects aggregate roll events in favor
of explicit close/open legs, validates follower identity and active policy, persists each
follower's own risk/BBO evidence, and creates only locked `PLANNED` intents.

TESTS RUN: 625 Node tests passed, four disposable-database tests skipped locally. ESLint,
TypeScript, Production build, browser suite, PowerShell parsing, security scan, Production
Neon migrations/invariants, Vercel deployment, and GitHub CI passed. The live laptop task
completed repeated authenticated cycles with Alpaca GOOD, database GOOD, market CLOSED,
and execution LOCKED.

TEST RESULTS: R1 engineering PASS. R2 lifecycle/replay PASS. R6 infrastructure PASS.
R6 evidence remains BLOCKED_ON_DATA because the market is closed and point-in-time rows
are still empty. R3 account architecture PASS. R4 disabled planning is PARTIAL because
follower broker execution remains intentionally absent and no real follower account is
connected. R5 operational status is PASS for the required owner heartbeat surface.

KNOWN LIMITATIONS: No open-session cross-symbol scan exists yet. There are zero candidate
rows, quote observations, resolved labels, master orders, follower orders, and broker
fills. Optionomics remains UNKNOWN on market-closed reconciliation-only cycles. Historical
option bars/trades do not establish historical decision-time Greeks or executable BBO
without a separately verified entitlement and timestamp contract.

RISKS: Continuous infrastructure does not prove positive expectancy. The EV, assignment,
recovery, execution, and action-value models remain empirically unready. Laptop sleep or
power loss creates explicit missed observations and resumes with reconciliation.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude `c2c75af` and `dd1d3c3` account-risk and
copy-economics research is useful as research-only input. Its direction-agnostic
price-deterioration sign remains unsafe for option credits versus debits and needs repair
before porting. The latest manifest also supersedes its earlier eight-factor Paper gate,
so that obsolete subset was not retained. Its Production loader firewall parity addition
is valid and was ported. No wholesale branch merge occurred.

NEXT RECOMMENDED TASK: Let the installed worker capture the first complete open-session
cross-symbol scan, audit the first non-empty export, and accumulate resolved point-in-time
episodes. Keep all order submission locked until the separate empirical promotion gate
passes.

## 2026-09-12 evidence acceleration and first-session watchdog

OWNER: Codex

TASK: Remove ambiguity from the first open-session proof and the R6 engineering versus
evidence boundary without creating another runtime subsystem.

WHAT WAS IMPLEMENTED: Complete zero-candidate scans now remain `COMPLETE`. The R6 receipt
contains a first-session proof with expected, started, completed, partial, failed, and
candidate counts plus market and provider states. Execution replay and outcome resolution
report separate engineering and empirical evidence states. Observation processing now
records offline host, provider/unbounded-enumeration failure, invalid contract, and
invalid BBO distinctly, with a session-ended code reserved for confirmed session state. The first
deterministic export writes an ignored `handoff.json` beside the dataset, manifest, and
quality receipt for one-command research consumption. Export window discovery includes
candidate-set evidence, so a complete zero-candidate WAIT session is not discarded.

KNOWN LIMITATIONS: 2026-09-12 is a Saturday, so no supported open session occurred and no
real scan, quote horizon, or resolved label exists. Production master credentials stay
encrypted server-side. Exact historical Alpaca BBO and Optionomics API entitlements remain
unverified, so no historical BBO adapter was added.

NEXT RECOMMENDED TASK: Keep the pinned locked worker online through the next supported
options session. Inspect the automatically generated first export and its handoff receipt,
then run the secure field-specific entitlement probes from the Production credential
boundary. No broker order is permitted.

The Windows task explicitly allows start and continuation on laptop battery. The prior
Task Scheduler defaults could leave the otherwise healthy evidence worker queued until
AC power returned, which would miss observation horizons without a code or provider error.

## 2026-09-12 Production provider evidence entitlement closure

OWNER: Codex

TASK: Resolve the remaining real Alpaca and Optionomics evidence entitlements through the
encrypted Production credential boundary, persist the sanitized capability registry, and
decide whether a historical PIT adapter is defensible.

FILES CHANGED: `src/providers/readiness.ts`, `src/providers/capability-registry.ts`,
`src/theta/autonomous-runtime-handler.ts`, provider/worker tests, the Phase 6 data-gap
register, decisions, and this handoff.

WHAT WAS IMPLEMENTED: The locked Production worker route accepts one explicit read-only
provider-audit selector. It requires the existing worker bearer token and complete local
identity, uses only GET requests, decrypts the designated master credentials only inside
Production, and returns/persists sanitized metadata. Unknown selectors are rejected.
Capability results and documented operation aliases are upserted into the existing Neon
registries. No credential, account balance, authorization header, or full account ID is
stored in capability metadata.

TESTS RUN: 654 Node tests passed with four environment-only skips. TypeScript, ESLint,
build, secret scan, GitHub CI, its disposable PostgreSQL/Redis services, browser tests,
Python tests, Production deployment, real Production provider probes, and Neon registry
queries were run.

TEST RESULTS: The master PAPER account was CONNECTED, ACTIVE, identity-matched, options
level 3, with zero positions and zero open orders. Alpaca current indicative snapshots and
Greeks, contracts, IEX stock history, historical option bars/trades, and corporate actions
returned HTTP 200. OPRA returned 403 `NOT_ENTITLED`. Optionomics authentication, metrics,
chain/Greeks, price history, current net flow, and events returned HTTP 200. Neon holds two
provider connections and 18 current sanitized capability rows. Broker orders and fills
remain zero.

KNOWN LIMITATIONS: Alpaca has no documented historical option BBO or historical Greeks
REST endpoint. Optionomics's tested history route did not prove historical IV/skew/term/
surface, date-aware option analytics, or independent current/24h/48h flow trajectories.
No open-session scan, candidate, quote observation, outcome label, or dataset export
exists yet.

RISKS: Current indicative data is suitable for engineering and shadow evidence but is not
automatically approved as execution-grade. Historical prints/bars cannot be treated as
fills. Current provider reachability does not prove a profitable policy.

WHAT THE OTHER AGENT SHOULD REVIEW: The empirical pipeline should consume the first real
export as-is and preserve the field/label firewall. No strategy or feature should be
promoted from this capability audit alone.

NEXT RECOMMENDED TASK: Keep the pinned worker online through the next supported options
session. Validate the first complete scan, automatic export, quote horizons, and empirical
pipeline result. Keep all order submission locked.

## 2026-09-12 Optionomics evidence closure and research autopilot

OWNER: Codex

TASK: Close the remaining provider-context and first-dataset automation gaps while the
market is closed, without changing strategy or crossing the zero-order boundary.

FILES CHANGED: Optionomics provider and shadow-cycle evidence capture, point-in-time
candidate persistence, provider readiness, Python production export loader, empirical
pipeline and experiment registry, Windows supervisor research trigger, tests, capability
audit, data-gap register, decisions, and this handoff.

WHAT WAS IMPLEMENTED: Production read-only checks proved dated Optionomics metrics,
option-chain analytics, a research-only surface grid, flow aggregates, bounded 8h/24h/48h
net-flow windows, and event history. The shadow cycle now retains those three flow windows
with exact query bounds and no invented sentiment. The dataset loader now computes the
same export identity as TypeScript by excluding the non-identity export timestamp. The
Windows supervisor runs the existing empirical pipeline once for each new dataset hash.

TESTS RUN: Targeted Optionomics/shadow tests, full Node, full Python, TypeScript, ESLint,
build, security scan, Vercel Production provider audit, deployment, and GitHub CI.

TEST RESULTS: The real Optionomics calls returned HTTP 200. Historical metrics returned
83 entries, the dated chain returned 12,456 rows, flow aggregates returned five rows per
documented list, 24h and 48h net flow returned 81 and 162 points per side, and four bounded
events retained `known_at`. The closed-session 8h result was a real empty series and was
not converted into sentiment. Alpaca remained PAPER, ACTIVE, options level 3, with zero
positions and zero open orders. No broker mutation occurred.

KNOWN LIMITATIONS: No supported open session occurred on Saturday 2026-09-12. Candidate
sets, candidates, replay observations, labels, and datasets remain empty. Historical
executable BBO and historical Greeks remain unavailable as one defensible PIT contract.

RISKS: Flow call/put series do not prove trade aggressor, opening/closing intent, account
positioning, or trader profitability. They remain research-only until OOS evidence proves
incremental value. An always-on cloud worker remains deferred, and the laptop must remain
available for the next session.

WHAT THE OTHER AGENT SHOULD REVIEW: The empirical pipeline was selectively ported from
Claude with dataset-hash, null-outcome, and branch-lineage repairs. No wholesale branch
merge occurred. Future research should consume the immutable export rather than create a
parallel dataset contract.

NEXT RECOMMENDED TASK: Keep the locked worker online through the next supported options
session. Audit the first complete real export, then let the idempotent empirical pipeline
run once for its dataset hash. Do not promote a strategy or submit an order before the
evidence gates pass.

## 2026-09-13 Master Paper activation prerequisite audit

OWNER: Codex

TASK: Verify the existing master independently of followers and repair executable
quote and account-permission readiness before autonomous Paper activation.

AUTHORITY UPDATE: The owner's latest directive authorizes autonomous Paper after
technical gates pass, superseding the earlier stop-before-first-POST instruction.
Live trading remains forbidden. This authorization does not establish readiness.
No execution configuration or broker mutation was made in this audit.

WHAT WAS IMPLEMENTED: Option contracts cannot be marked executable from indicative,
unknown, or non-Alpaca quote provenance. Future timestamps and crossed/invalid BBO
are rejected. Master readiness requires both known approval and current trading
levels, plus an explicitly unblocked account. Blank numeric fields remain null.

TESTS RUN / RESULTS: Node 664 passed, four skipped, zero failures. Full Python
452 passed. TypeScript, ESLint, build and security scan passed with zero findings.
Executable test fixtures now explicitly use OPRA, with a regression assertion
that an otherwise healthy indicative quote is not execution-ready.

REAL PROVIDER EVIDENCE: The authenticated deployed read-only readiness operation
resolved MASTER_THETA_PAPER, verified broker identity at the exact Paper host,
and returned ACTIVE with options approval/trading levels 3/3, zero positions and
zero open orders. Account connection does not depend on follower enrollment.
Market was closed. OPRA snapshots and Greeks returned NOT_ENTITLED, HTTP 403.
Indicative snapshots/Greeks returned HTTP 200 with limits. Optionomics documented
authentication and current context operations returned HTTP 200. No credentials
were printed. Local verification lacks the encryption configuration, while the
deployed encrypted credential path works.

KNOWN LIMITATIONS: The autonomous runtime still enforces THETA_SHADOW_ONLY and
uses a read-only broker wrapper. Its copy-preparation skip does not block master
execution. Submission and executable management integration remain unfinished.
The local worker remains stopped. No strategy profitability is demonstrated by
provider connectivity. No migration is required by these prerequisite repairs.

RISKS: Indicative quotes are modified quotes, not official executable OPRA BBO.
Do not bypass this distinction by relabeling the feed or flipping runtime flags.
Followers require separate sizing and reconciliation, not promised identical P&L.

WHAT THE OTHER AGENT SHOULD REVIEW: Account permission null handling and the
execution-feed boundary. Preserve independent master routing and existing quant
work. NEXT RECOMMENDED TASK: Complete the gated Paper orchestration and management
path, and resolve executable quote entitlement before enabling broker submission.

## 2026-09-13 Paper execution and lifecycle engineering closure

OWNER: Codex

TASK: Finish the Alpaca Paper mutation, restart, cancel/replace, roll, persistence,
readiness, and operator-reporting contracts without submitting an order or weakening the
OPRA boundary.

FILES CHANGED: Broker adapter and reconciliation mapping, execution gate, order
construction, Paper coordinator, PostgreSQL order store, master execution orchestrator,
first-order readiness, R7 status, point-in-time evidence persistence, migration 024,
database verification, operator status, tests, decisions, and this handoff.

WHAT WAS IMPLEMENTED: The exact Paper adapter supports submit, get by broker ID, get by
client ID, list, cancel, and replace. Every mutation needs an operation-bound execution
permit. Server failures and malformed successful mutation responses are ambiguous, not
definitive rejections. The coordinator persists before POST, reconciles before retry,
survives an accepted POST followed by a local write failure, handles broker state and
partial-fill truth, cancels safely through fill races, and replaces through a distinct
lineage intent without increasing exposure. CSP and covered-call rolls are explicit
close-old then open-new sequences, with the new leg blocked until the old leg is fully
filled. Migration 024 persists executable quote source, feed, and content hash, and
enforces OPRA for options and SIP/IEX for stock. Existing lifecycle writers continue to
handle broker-confirmed CSP, assignment, expiry, recovery stock, covered calls, and
call-away atomically. Owner Paper authorization now reports GRANTED rather than the old
hardcoded state.

The command assembler closes the boundary from an already-selected strategy or management
action into the persisted execution command. It creates deterministic lineage identities
and rejects indicative options data, stale or crossed BBO, out-of-BBO limits, invalid
quantity or multiplier, missing option contracts, and uncovered calls before persistence.

TESTS RUN: Focused execution tests, full Node, TypeScript, ESLint, build, Python, security,
PostgreSQL/Redis integration where available, CI, and Production verification.

TEST RESULTS: See the final handoff for exact counts and external verification status.
No broker mutation was attempted. Master Paper, follower Paper, and live order counts
remain zero.

KNOWN LIMITATIONS: The current Alpaca account is not entitled to OPRA, so executable option
BBO is unavailable. The champion strategy still lacks empirical after-cost and tail
validation. The Production runtime remains shadow-only and its broker object remains
read-only by design. These gates prevent autonomous Paper entry even though the mutation
and lifecycle engineering contracts are now present.

RISKS: Enabling execution flags or relabeling indicative data would bypass financial truth.
Do not activate the separate mutation orchestrator until a real selected decision, current
account reconciliation, current session, OPRA quote, AEGIS approval, durable command, and
complete readiness receipt all agree.

WHAT THE OTHER AGENT SHOULD REVIEW: Empirical model outputs and strategy promotion evidence
only. The TypeScript execution and lifecycle path is the Production authority.

NEXT RECOMMENDED TASK: Obtain legitimate OPRA entitlement, capture enough real point-in-time
and Paper evidence for empirical validation, then run the sanitized first-order receipt.
Only after it says YES should a later cycle submit the first Paper order.

## 2026-09-13 permanent provider and competitor workstreams

OWNER: Codex

TASK: Make Optionomics, QuantWheel, and Alertsify permanent workstreams inside
R3/R4/R6/R7/R8/R9 without adding an unproven runtime dependency or weakening the
Paper execution gate.

FILES CHANGED: Active phased plan, provider and mechanism research records,
provider-neutral trusted option quote contract, tests, decisions, and handoff.

WHAT WAS IMPLEMENTED: The roadmap now assigns Optionomics intelligence and
contract work to every relevant remaining phase. QuantWheel is tracked as a
Wheel and management hypothesis source. Alertsify is tracked as a copy-safety
and broker-evidence benchmark. A typed quote assessment can distinguish proven
Alpaca OPRA consolidated BBO from a narrower proven Optionomics two-sided quote
without relabeling either. It rejects missing, crossed, stale, future,
indicative, undocumented, degraded, and wrong-contract evidence.

CURRENT SAFETY STATE: Optionomics has not yet proven the documented two-sided
order-pricing contract required by the new qualifier. The current Alpaca account
is not entitled to OPRA. The new contract is not connected to broker mutation.
`FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_READY = NO` and all trading remains locked.

KNOWN LIMITATIONS: Public product documentation supports research hypotheses,
not empirical THETA results. GEX, DEX, Vanna, Charm, walls, detailed flow, quote,
alert, and webhook operation schemas still require authenticated capability-by-
capability validation. R4 copy activation and R6 empirical readiness remain open.

NEXT RECOMMENDED TASK: Audit the authenticated Optionomics API reference for the
new catalog, capture sanitized operation schemas, and keep unproven families
UNKNOWN. Run each QuantWheel and Alertsify mechanism through the external
mechanism ledger before implementation or policy use.

## 2026-09-13 Optionomics execution-quote decision

OWNER: Codex

TASK: Prove whether the currently authenticated Optionomics contract can supply
the fresh two-sided price authority required for autonomous Alpaca Paper orders.

FILES CHANGED: Optionomics provider normalization, quote-contract proof, provider
tests, provider authority/data-map/audit records, decisions, and this handoff.

WHAT WAS IMPLEMENTED: The documented option-chain quote, size, DTE, theoretical
price, moneyness, and exposure fields are retained without converting missing
values to zero. Every observation is explicitly session-recorded research and
non-executable. A deterministic sanitized proof counts available fields but
rejects execution regardless of a valid two-sided shape because Optionomics
documents the API as session-ingested and not a real-time quote or execution
feed.

TEST RESULTS: Unit tests prove numeric-string parsing, null safety, two-sided
field capture, empty response behavior, fixed semantic rejection, and no token
leakage. Full repository and external verification results are recorded in the
completion report for this milestone.

KNOWN LIMITATIONS: Alpaca OPRA remains not entitled. Optionomics is valuable for
research and decision context but cannot supply the missing order-pricing
authority under its current documented contract. No provider has been added.

RISKS: Treating recorded bid and ask fields as live execution truth could create
unbounded slippage or stale-limit errors. The execution gate stays locked.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant and research use of the newly retained
fields only. Do not connect them to broker mutation.

NEXT RECOMMENDED TASK: Prepare one explicit provider or entitlement proposal for
a real-time execution quote contract, then obtain owner approval before changing
the provider stack. Continue shadow evidence collection in parallel.

## 2026-09-14 master anti-paralysis and Paper baseline closure

OWNER: Codex

TASK: Make the existing structural shadow selector explicit, auditable, Pareto-safe, and restart-visible without enabling an Alpaca order.

FILES CHANGED: Shadow baseline selection and persistence, autonomous WAIT reevaluation, migration 027, SQL invariants, unit tests, decisions, and this handoff.

WHAT WAS IMPLEMENTED: `theta-paper-active-baseline-v2` filters mechanical blockers, keeps UNKNOWN distinct, calculates only descriptive premium-per-collateral-day, builds a multi-dimensional Pareto frontier, and selects deterministically without an invented EV or probability. Every scan writes an immutable baseline receipt with why-not-wait evidence. Non-selected feasible and transiently blocked candidates enter an append-only near-miss queue. The management-first scheduler now consumes queued near misses through a full market-session-confirmed rescan, records the trigger, and suppresses a duplicate opportunity scan in the same cycle.

TESTS RUN: Full Node, Python, TypeScript, ESLint, build, security, PostgreSQL migration and invariants through CI/Production where available.

KNOWN LIMITATIONS: The Production account still lacks a proven fresh execution-grade option quote. Global WAIT is not earned while the bounded discovery scan or branch/management coverage is incomplete. The calibrated EV model remains unavailable. None of these states are converted into zero or success.

RISKS: Structural premium return is descriptive and must never be presented as expected return. The baseline is an evidence generator, not proof of profitability. The runtime and broker mutation gates remain separate and locked.

WHAT THE OTHER AGENT SHOULD REVIEW: Empirical outcomes and strictness diagnostics after enough point-in-time episodes exist. Production TypeScript remains the authority for persistence, scheduling, reconciliation, and execution safety.

NEXT RECOMMENDED TASK: Run the always-on worker during a confirmed options session, collect the first complete structural baseline and near-miss receipts, then use the export to measure coverage and execution replay. Do not submit a Paper order until the full readiness receipt passes.
## 2026-09-14 Optionomics layered evidence and quote qualification

OWNER: Codex production engineering

TASK: Extend the existing Optionomics and point-in-time evidence paths without changing execution authority.

FILES CHANGED: Optionomics provider, layered feature engine, FusionSnapshot assembly, PostgreSQL cycle persistence, quote-qualification harness, migration 028, tests and professional reference map.

WHAT WAS IMPLEMENTED: Raw authenticated response hashes/payloads now survive normalization. Every real shadow FusionSnapshot carries a versioned layered Optionomics feature snapshot. PostgreSQL stores immutable raw and derived records separately. Candidate evidence consumes the layered volatility and market-structure state. A repeated-symbol qualification harness records observed coverage, two-sided shape and timestamp freshness but remains research-only under the current provider contract.

TESTS RUN: TypeScript check and full Node test suite.

TEST RESULTS: 720 tests, 716 passed and 4 PostgreSQL-dependent tests skipped in the ordinary Node run. Migration 028 and all 28 migration invariants passed against Production Neon. TypeScript and lint passed. Build, security, CI and deployment results are recorded at release completion.

KNOWN LIMITATIONS: Current Optionomics documentation still describes session-recorded research data, so it cannot authorize an order. IV rank, IV percentile, vanna, charm, dark-pool and event families remain unavailable until documented authenticated operations and units are observed. Empirical EV remains unavailable.

RISKS: Provider field meanings and units can change. The raw/derived split and schema versioning make that detectable but do not eliminate provider risk.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant review should test feature definitions and determine whether any family adds OOS WholeChain economic value. It must not promote a feature from shape or intuition alone.

NEXT RECOMMENDED TASK: Run migration 028, execute the market-session qualification harness when the session is open, then continue the branch-complete frontier and management policy integration using captured evidence.

## 2026-09-14 R7 Run 1 internal strategy closure

OWNER: Codex production engineering

TASK: Close the internal strategy-router, branch-frontier, sizing, management-intent, global-WAIT, and evidence-export gaps without changing execution authority.

FILES CHANGED: Canonical strategy frontier, shadow cycle, cross-symbol scan evidence, PostgreSQL cycle persistence, dataset export, sizing model and contract, management action frontier, scheduler ordering, migration 031, tests, decisions, and this handoff.

WHAT WAS IMPLEMENTED: All five canonical branches now have independent candidate or action frontiers. The cycle conditionally fetches call contracts only for confirmed stock inventory. Conventional, Hold Strike, Defined Risk, Recovery, and CC retain complete candidates, blockers, unknown evidence, branch-local Pareto ranks, and structural economics. The database stores the full immutable frontier and exports it with R6 evidence. Scan-level global WAIT requires complete underlying and branch exhaustion. Sizing includes tail, correlation, and liquidity caps. Management rolls persist explicit close-old and open-new option intents.

TESTS RUN: Focused TypeScript and Python tests, full Node tests, TypeScript check, migration 031, and all Production Neon invariants. Final lint, build, security, browser, CI, deployment, and worker verification are reported in the release receipt.

TEST RESULTS: Production Neon reports migrations 001 through 031, 56 required tables, one `MASTER_THETA_PAPER`, zero active followers, one encrypted credential, and zero broker orders. All checked protections remain enforced and the execution gate remains locked.

KNOWN LIMITATIONS: Expected after-cost EV and cross-branch action values remain empirically unavailable. Optionomics remains non-executable under its documented session-recorded contract. Alpaca OPRA is not entitled. Whole-chain basis is not inferred from a broker position snapshot and remains unknown until ledger lineage supplies it. The cross-cycle Optionomics context cache is still absent.

RISKS: A structural Pareto reference is an evidence-selection device, not a profitability claim. Hold Strike and Defined Risk remain research-only. Recovery and CC are not cross-ranked when action EV is unknown. The current runtime must not submit any order.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude branch `fc87df3` was reviewed. Its latest research adapters are research-only and do not request a Production runtime change. The exact Production candidate-export keys are `contract.strike`, `contract.expiration`, `contract.optionType`, `contract.dte`, `contract.moneyness`, `market.bid`, `market.ask`, `market.stockPrice`, `market.dataQuality`, and `volatility.iv`. Forward log-moneyness remains unavailable because a defensible forward is not yet exported. Claude's `FeatureFieldMap` must leave that key unset rather than substitute simple moneyness.

NEXT RECOMMENDED TASK: Collect complete market-session frontier evidence, resolve a proven execution-grade option quote, then run Claude's branch-isolated R6 adapters and action-value research against the immutable export. Keep Paper and live order submission locked.

## 2026-09-14 R7 Run 1 Optionomics context milestone

OWNER: Codex production engineering

TASK: Convert the confirmed Optionomics census families into bounded Production adapters and preserve complete raw-to-feature lineage without changing execution authority.

FILES CHANGED: Optionomics provider and feature engine, THETA shadow cycle, PostgreSQL cycle store, migration 030, database verifier, focused tests, decisions, census, and the R7 Run 1 handoff.

WHAT WAS IMPLEMENTED: Typed normalizers now cover metrics, exposure heatmap, aggregate flow, events, earnings filings, and symbol news. The real cycle fetches due families sequentially under a versioned request budget. FusionSnapshot retains normalized context and event observations. Raw payloads are stored once and linked to the feature snapshot through an immutable join table.

TESTS RUN: Full Node, Python, TypeScript, ESLint, build, security, browser, and real Neon migration/invariant verification.

TEST RESULTS: Node 733 total, 729 passed and four disposable-PostgreSQL-only tests skipped. Python 452 passed. Browser 22 passed. TypeScript, lint, build, and security passed. Neon reports migrations 001 through 030 and all checked invariants. Docker Desktop was unavailable locally.

KNOWN LIMITATIONS: Provider metric units and exposure sign semantics remain unverified. Upcoming earnings distance and ex-dividend state remain unknown. Cross-cycle context caching is not complete. Independent branch frontiers and empirical action values remain open R7 work.

RISKS: A context family that isn't due is absent rather than reused. This is safe but can reduce decision context until durable timestamp-aware caching is added. Optionomics context remains non-executable.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude should attack the normalized metric aliases, DTE-selection bias, term-structure composition, and whether each feature family has incremental point-in-time OOS value. Claude must not promote or push Production code.

NEXT RECOMMENDED TASK: Complete durable context reuse with freshness semantics, then build independent applicable-branch frontiers and management action comparisons. Keep broker submission locked.
# 2026-09-14: R7 final internal engineering closure

OWNER: Codex

TASK: Replace legacy THETA_Q final authority with the canonical five-branch structural authority and finalize the Production research export wire contract.

WHAT WAS IMPLEMENTED: Versioned cross-branch authority, complete structural sizing caps with quantity zero preserved, global Pareto selection, management delegation, explicit empirical-utility unknown state, durable authority lineage, and camel-case Production research export fields matching the Python loader.

KNOWN LIMITATIONS: Execution-grade option quote qualification still requires supported market-open evidence. Empirical profitability, feature ablation, historical alpha research, and real lifecycle statistics belong to R6/R8.

## 2026-09-14 master Paper always-on operating milestone

OWNER: Codex

TASK: Replace the shadow-only laptop identity with the independent always-on
master Paper operating identity without bypassing the execution-quote gate.

FILES CHANGED: Environment contract, autonomous runtime, worker registration and
lease state, Windows Task Scheduler scripts, operator status API/UI, migration
033, SQL and runtime tests, decisions, and this handoff.

WHAT WAS IMPLEMENTED: `MASTER_THETA_PAPER` now owns the canonical worker. The
database and website distinguish active, market-closed, quote-blocked,
risk-blocked, provider-degraded, and kill-switch states. Runtime evidence exposes
real persisted decisions, scans, reconciliation, positions, orders, fills, open
chains, and resolved economics without inventing missing MTM. The worker remains
independent of follower count. Task Scheduler adds network-aware start, wake,
restart, single-instance, heartbeat, mutex, lease, and stale-lease recovery.

TESTS RUN: Node, Python, TypeScript, ESLint, build, security scan, browser,
PostgreSQL migration and invariants, Windows stop/install/start/restart status,
Production deployment, and CI.

KNOWN LIMITATIONS: The current documented Optionomics feed cannot authorize an
execution price, and Alpaca OPRA entitlement is unavailable. The master remains
running with `EXTERNAL_QUOTE_BLOCKER`. No Paper or live order is authorized by
this milestone.

RISKS: A Windows laptop is available only while powered and connected. WakeToRun
cannot recover a powered-off machine. Whole-chain P&L remains unknown whenever
open inventory lacks a current reconciled mark.

WHAT THE OTHER AGENT SHOULD REVIEW: R6/R8 should consume only persisted evidence
and should not relabel structural ranking as empirical alpha.

NEXT RECOMMENDED TASK: Observe the next open options session, run the existing
execution-quote qualification, and keep the worker operating even if the quote
remains externally blocked.
# 2026-09-14, master Paper action handoff

OWNER: Codex

TASK: Close the missing internal seam between a canonically approved THETA action and the existing Paper execution coordinator, without enabling orders.

FILES CHANGED: `src/execution/master-paper-action-handoff.ts`, `src/execution/postgres-master-paper-action-plan-store.ts`, `src/execution/alpaca-opra-execution-quote-source.ts`, `src/execution/master-paper-command-assembly.ts`, `src/theta/autonomous-runtime.ts`, scheduler and worker files, migration `034`, tests, database verification, and the orchestration reference map.

WHAT WAS IMPLEMENTED: A typed approved-action contract, durable PostgreSQL queue with immutable events and restart-safe claims, provider-neutral current option-quote qualification, adaptive pricing delegation, resident-worker handoff job, and explicit separation of structural strategy evidence from execution-quote readiness.

TESTS RUN: Full verification is recorded in the milestone commit report. Focused action-handoff tests and the full Node suite passed before final verification.

TEST RESULTS: No broker mutation occurred. Production execution switches remain locked. Master Paper, follower Paper, and live order counts remain zero.

KNOWN LIMITATIONS: No current strategy branch has empirically ready positive after-cost EV. The currently proven external execution-quote capability remains blocked. Docker was unavailable for local PostgreSQL and Redis testing, so those checks require CI and the approved Production migration path.

RISKS: Enabling the execution flags before empirical promotion and external quote qualification would be unsafe. Credentials previously pasted into chat must be rotated before any Paper activation if they are still active.

WHAT THE OTHER AGENT SHOULD REVIEW: Strategy research may consume the plan interface, but must not bypass canonical selection, AEGIS, empirical EV, or quote qualification. Quant work stays on its isolated branch.

NEXT RECOMMENDED TASK: Accumulate point-in-time R6 evidence and qualify the external execution quote contract. When both gates pass, produce the full readiness receipt and stop before the first `POST /v2/orders`.
## 2026-09-14 Optionomics exposure heatmap correction

OWNER: Codex

TASK: Reconcile the authenticated Optionomics census with the current public contract and close the missing Vanna/Charm adapter gap.

FILES CHANGED: Optionomics provider, feature engine, shadow cadence, provider readiness, focused tests, capability census, decisions, and handoff.

WHAT WAS IMPLEMENTED: Separate gamma, Vanna, and Charm heatmap requests using the documented `metric` values. Responses must echo the exact requested metric or remain unknown. Each grid has a distinct operation alias, raw-observation lineage, normalized feature destination, and unavailable-family state. The context budget rose from six to eight requests only to cover the two new documented reads.

TESTS RUN: Full Node suite, focused Optionomics/readiness suites, TypeScript, ESLint, build, Python, security scan, CI PostgreSQL/Redis/browser integration, and authenticated Production provider verification.

TEST RESULTS: 748 Node tests passed with 4 local PostgreSQL integration skips and 0 failures. The focused final suite passed 21/21. Python passed 452/452. TypeScript, ESLint, build, security scan, browser tests, CI PostgreSQL/Redis checks, and real customer persistence passed. Production returned HTTP 200 populated gamma, Vanna, and Charm heatmap schemas and persisted 37 Optionomics capabilities. No broker order or fill was created.

KNOWN LIMITATIONS: Optionomics explicitly documents session-ingested research data rather than a streaming execution feed. Vanna/Charm units, sign convention, methodology, and point-in-time availability still require provider documentation or empirical research before quantitative use.

RISKS: Treating these exposure grids as observed dealer inventory or deterministic direction would be invalid. They remain versioned context and R6 ablation candidates.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude may test incremental OOS value and sign-convention assumptions. It must not promote these grids directly into Production strategy authority.

NEXT RECOMMENDED TASK: Verify both metric-specific routes through Production, then let the existing market-open qualification worker gather execution-quote evidence while keeping submission blocked.
OWNER: Codex

TASK: R7 Paper evidence authorization boundary

FILES CHANGED: execution authorization tier, master Paper handoff and command assembly, Paper coordinator and PostgreSQL stores, environment configuration, migration 035, operator status API/UI, tests, decisions and handoff.

WHAT WAS IMPLEMENTED: Removed empirical-model readiness as a universal prerequisite only for bounded `PAPER_EVIDENCE`. Added a reducing-only configurable evidence cap, immutable tier and sizing evidence on plans and order intents, database constraints, and repeated live-tier rejection at the handoff, command assembly, coordinator, and database boundaries. `EMPIRICALLY_PROMOTED_PAPER` still requires known positive after-cost EV for new risk. Existing quote, account, AEGIS, market, idempotency, and reconciliation controls remain.

TESTS RUN: Focused execution/configuration tests and full repository verification.

KNOWN LIMITATIONS: Actual Paper evidence remains externally blocked until Alpaca returns a qualified fresh OPRA BBO for an exact contract during a regular options session. The current canonical selector still produces research-only rankings when empirical economics are unknown. No order was submitted.

RISKS: Paper evidence can lose money in Paper and does not establish profitability. Previously exposed Alpaca credentials must be rotated before mutation if still active.

WHAT THE OTHER AGENT SHOULD REVIEW: Research should treat `PAPER_EVIDENCE` observations as unpromoted evidence and must not reinterpret UNKNOWN EV as zero or positive.

NEXT RECOMMENDED TASK: Run the existing Alpaca OPRA qualification at market open. If entitled, connect structurally selected actions to the v2 plan producer under the one-contract cap. If not entitled, record `ALPACA_OPRA_ENTITLEMENT_REQUIRED` without redesigning THETA.

OWNER: Codex

TASK: End-to-end master Paper decision-to-plan integration and system gap audit.

FILES CHANGED: Master plan assembly and store, Production evidence runtime,
autonomous runtime, canonical candidate persistence, tests, decisions, handoff,
and the system completion matrix.

WHAT WAS IMPLEMENTED: Connected a canonical persisted `OPEN_CSP` decision to
the durable master action-plan queue. Quantity is reducing-only under the Paper
evidence cap. The cost floor uses the real contract multiplier. Expected EV
stays unknown. Exact duplicate exposure, missing account/options/AEGIS/cost
evidence, research-only branches, zero quantity, and invalid expiry all block.
Expired queued plans are quarantined before claiming. Canonical Conventional
candidate aliases now resolve to their persisted THETA-Q row instead of losing
the selected candidate relationship.

TESTS RUN: Full Node suite, TypeScript, ESLint, build, security scan, focused
plan-assembly tests, and an authenticated open-session Production provider
readiness check.

TEST RESULTS: 765 Node tests passed, 4 local PostgreSQL tests skipped, and 0
failed. TypeScript and build passed. ESLint passed after the final test cleanup.
Security scan found 0 findings. Production reported an ACTIVE options-level-3
master account, zero positions, zero open orders, Alpaca indicative snapshots
HTTP 200, Alpaca OPRA HTTP 403 NOT_ENTITLED, and Optionomics HTTP 401.

KNOWN LIMITATIONS: Docker Desktop was not available for local PostgreSQL/Redis
integration. The new SQL path must be exercised by CI and the authenticated
Production worker after deployment. Only `OPEN_CSP` has a canonical action-plan
producer. Management and other lifecycle actions still need typed plan
assemblers. No empirical strategy edge is proven.

RISKS: A structural credit above modeled costs is not positive expected value.
The Paper tier can lose simulated money. No execution quote is currently
qualified, so the broker submission boundary remains blocked.

WHAT THE OTHER AGENT SHOULD REVIEW: Research may evaluate the evidence created
by Paper observations. It must preserve `expectedAfterCostEv=null` until a
defensible model is trained and validated.

NEXT RECOMMENDED TASK: Qualify an external exact-contract two-sided quote,
complete typed management action producers, and accumulate resolved Paper
episodes. Keep follower submission and all live tiers locked.

OWNER: Codex

TASK: Production Python contract runtime compatibility.

FILES CHANGED: Private Vercel Python model endpoint, TypeScript Python bridge,
Production shadow runtime configuration, Vercel function configuration, bridge
tests, decisions, and handoff.

WHAT WAS IMPLEMENTED: Added an authenticated, allowlisted Python function for
the canonical deterministic quant contracts. Vercel Node functions use this
remote boundary because they cannot spawn Python. Local and CI callers keep the
existing fixed-argv child-process path. All responses still pass the existing
TypeScript schema and version checks, and all failures remain fail-closed.

TESTS RUN: Full Node suite, Python module import check, TypeScript, ESLint,
build, security scan, and a local Vercel Production build including the Python
function.

KNOWN LIMITATIONS: This removes the internal `spawn python3 ENOENT` blocker. A
deployed market scan must still prove candidate generation. The fresh trusted
two-sided option execution quote remains externally blocked, empirical expected
value remains unknown, and no order is authorized by this transport change.

RISKS: A model endpoint must never accept arbitrary module or script names.
Keep the static allowlist, runtime-secret authentication, body caps, generic
errors, and TypeScript response validation intact.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude may verify that remote and local
contract results are deterministic for the same payload. It must not change the
Production transport into a second quantitative authority.

NEXT RECOMMENDED TASK: Deploy, run the protected open-session scan, confirm real
candidate and point-in-time evidence rows, then continue resolving quote
qualification and management action production. Keep all live and follower
orders locked.

OWNER: Codex

TASK: Runtime WAIT-paralysis and overtrading evidence vertical slice.

FILES CHANGED: Runtime behavior classifier/store, Production evidence scan,
operator status projection, migration 036, database and unit tests, system
completion matrix, and handoff.

WHAT WAS IMPLEMENTED: Every Production opportunity scan now creates an
immutable cycle-level behavior diagnostic. It distinguishes healthy, empty,
risk, quote, data, overstrict-policy, and possible-logic-paralysis waits from a
ready action. It records consecutive WAIT cycles, last broker-action age,
candidate funnel counts, near misses, quantity-zero and AEGIS veto counts,
provider/action-plan blockers, and whether one scan produced zero, one, or
multiple plans. Operator status exposes only the sanitized latest projection.
No empirical trade-frequency threshold or future outcome is invented.

TESTS RUN: Full Node suite, Python quant suite, TypeScript, ESLint, build,
security scan, and PostgreSQL integration through CI.

KNOWN LIMITATIONS: False-reject rate, opportunity-capture rate, and calibrated
overtrading limits require resolved point-in-time episodes. Docker Desktop was
unavailable locally, so disposable PostgreSQL proof is delegated to CI before
Production migration. Management action-to-plan dispatch remains incomplete.

RISKS: Consecutive WAIT is descriptive evidence. It must not become an
automatic instruction to trade. Multiple plans in one scan is surfaced for
review and does not by itself prove overtrading.

WHAT THE OTHER AGENT SHOULD REVIEW: Research may use the diagnostic as a
strictness cohort feature after outcome labels exist. It must not use the
future label in the decision-time feature set or invent a threshold from a
small sample.

NEXT RECOMMENDED TASK: Complete typed management action-plan assembly and
dispatch, then use resolved Paper episodes to calibrate soft-gate regret and
activity limits. Keep live and follower order submission locked.

OWNER: Codex

TASK: Production-to-research evidence integrity closure.

FILES CHANGED: TypeScript dataset canonicalization, Python Production export
loader, focused tests, R6H schema parity and integrity documentation.

WHAT WAS IMPLEMENTED: PostgreSQL Date values now hash as their serialized ISO
timestamps. The Python verifier reproduces TypeScript Unicode, ECMAScript
finite-number formatting, and v1 key ordering byte-for-byte. PostgreSQL
numeric strings are parsed as finite values before BBO and research checks.
Unambiguous legacy shadow router codes map explicitly to canonical branches,
while ambiguous THETA_R fails closed.

TESTS RUN: TypeScript point-in-time tests, Python Production-export tests,
the real Production dataset hash verification, and the empirical descriptive
pipeline.

TEST RESULTS: The Python recomputation exactly matched dataset hash
`25478c74e2464325d0c4c0358d4915f276a2d8da4766a092b065e95e448f32da`.
The empirical pipeline returned `DESCRIPTIVE_AUDIT_ONLY`, allowed three
descriptive audits, and refused 43 unsupported empirical experiments.

KNOWN LIMITATIONS: The accepted export contains no resolved whole-chain or
management labels. It cannot establish expected value, profitability, or a
win rate.

RISKS: Future changes to dataset canonicalization require an explicit schema
version change. Ambiguous legacy strategy codes must never be guessed.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research may consume this verified
export for descriptive audit. Model fitting and policy promotion remain
blocked until enough point-in-time outcomes resolve.

NEXT RECOMMENDED TASK: Resume evidence collection, complete management action
dispatch, and resolve genuine Paper lifecycle outcomes after execution-quote
qualification. Keep every order tier locked until readiness passes.

OWNER: Codex

TASK: Restart-safe empirical supervisor identity.

FILES CHANGED: Windows THETA supervisor, supervisor contract test, local
runtime documentation, and handoff.

WHAT WAS IMPLEMENTED: Automatic descriptive research is keyed by both the
immutable dataset hash and exact worker build SHA. Experiment output paths also
include the build SHA. On restart, an existing result is reused only after its
dataset, source-code, experiment, feature, evidence-source, and strategy fields
match. A conflicting artifact fails closed instead of being overwritten.

TESTS RUN: Focused supervisor contract test, repository verification, and a
real worker restart on the exact Production SHA.

TEST RESULTS: Local supervisor contract, TypeScript, lint, build, security, full
Node, and full Python suites passed. Canonical deployment and worker restart
remain the operational verification step for this commit.

KNOWN LIMITATIONS: Descriptive audit remains distinct from empirical model
readiness. Resolved labels are still required for profitability claims.

RISKS: Reusing an artifact on dataset hash alone would hide code-version
changes. This implementation binds both identities.

WHAT THE OTHER AGENT SHOULD REVIEW: Research output remains immutable and may
be regenerated under a new build-specific experiment identity.

NEXT RECOMMENDED TASK: Continue real point-in-time capture and resolve the
external execution-quote gate without weakening it.

OWNER: Codex

TASK: Management decision-to-execution dispatch closure.

FILES CHANGED: Typed management action assembler, action-plan contract/store,
management input identity, runtime management and pending-order jobs, migration
037, database verifier, focused tests, completion matrix, and decisions.

WHAT WAS IMPLEMENTED: Management actions now have a distinct immutable
authority path from the persisted management input and frontier to durable
Paper action plans. Close, stock exit, covered-call entry/close, CSP roll, and
covered-call roll mappings are explicit. Roll legs are persisted atomically,
and the open leg cannot be claimed until broker reconciliation proves the
close intent is FILLED. Risk-reducing quantities are not clipped, while an
opening leg may only shrink under the Paper evidence cap. The scheduler now
invokes this bridge after management-first reconciliation and reconciles every
active local intent from broker truth.

TESTS RUN: Focused management/action-handoff tests, full Node suite,
TypeScript, ESLint, build, and security scan. PostgreSQL migration verification
is the deployment gate for this milestone.

KNOWN LIMITATIONS: The current management frontier intentionally selects
passive HOLD because empirical continuation EV is unavailable. No active
management plan is manufactured from structural marks. The execution quote
gate remains externally blocked.

RISKS: A two-leg roll must never be treated as one atomic broker fill. The
database dependency enforces close-first ordering, but real Paper partial-fill,
cancel, expiry, and restart evidence is still required before claiming
operational proof.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research may supply versioned active
management directives only after point-in-time/OOS validation. It must preserve
the exact contract multiplier, UNKNOWN values, and immutable old-leg loss.

NEXT RECOMMENDED TASK: Accumulate real point-in-time and resolved lifecycle
evidence, qualify a fresh trusted two-sided execution quote, then produce the
first-order readiness receipt. Keep follower submission and all live trading
locked.

OWNER: Codex

TASK: Optionomics Production qualification diagnostics.

FILES CHANGED: Quote-qualification contract/runtime, focused tests, decision
record, and handoff.

WHAT WAS IMPLEMENTED: The protected server-side qualification now preserves
and returns sanitized per-sample operation alias, HTTP status, normalized
failure class, retry timing, attempt count, and observation counts. It reports
an explicit Production authentication verdict without including credentials,
headers, response bodies, or provider messages. HTTP 2xx proves auth even if
the response shape is unusable. HTTP 401 is reported as
`401_UNAUTHORIZED`. Other no-data states remain distinct.
The typed Optionomics environment boundary also trims accidental outer
whitespace from its documented single-line email/token headers and rejects
embedded line breaks without modifying other secret contents.

TESTS RUN: Focused quote-qualification tests, full Node suite, TypeScript,
ESLint, build, and security scan.

KNOWN LIMITATIONS: Authentication success alone does not qualify Optionomics
as execution-price truth. Fresh exact-contract two-sided quote observations
and documented order-pricing semantics remain required.

RISKS: Exposing arbitrary provider messages could leak reflected request data.
The public diagnostic deliberately excludes all such text.

WHAT THE OTHER AGENT SHOULD REVIEW: Research can use the normalized status
codes to separate auth, entitlement, schema, and quote-coverage failures. It
must not treat a successful login as quote qualification.

NEXT RECOMMENDED TASK: Deploy this diagnostic contract and run one bounded
Production qualification to establish the current non-secret provider result.

OWNER: Codex

TASK: Durable Optionomics temporal evidence and selective Claude review.

FILES CHANGED: Temporal feature engine, cycle persistence, migration 038,
database verifier, Node/SQL tests, completion matrix, decision log, and Claude
review ledger.

WHAT WAS IMPLEMENTED: Consecutive same-underlying Optionomics feature snapshots
now produce immutable research-only volatility, skew, term-structure, and
exposure changes. The engine rejects reversed timestamps, incompatible schemas,
cross-underlying pairs, non-finite values, and excessive gaps. UNKNOWN never
becomes zero. Every result links both source snapshots and is permanently
non-executable. Claude commits `b249625`, `8f1be58`, `9c05da9`, `514cdf7`, and
`715c97f` were classified individually. No branch or speculative provider parser
was merged wholesale.

TESTS RUN: TypeScript and full Node suite. Full repository, PostgreSQL, browser,
Python, security, deployment, and Production migration checks remain required
before release of this milestone.

TEST RESULTS: TypeScript passed. Full Node passed 792 tests with five disposable
database tests skipped because local PostgreSQL was unavailable.

KNOWN LIMITATIONS: Optionomics Production authentication still returns HTTP 401,
so no new real temporal rows can be collected. One-hour pairing is a versioned
research data-quality policy, not a strategy threshold. Direction, persistence,
acceleration, and profitability remain unmodeled until real repeated observations
and resolved labels exist.

RISKS: Temporal correlations can be mistaken for alpha. No temporal feature may
enter Production selection until paired point-in-time ablation and independent
OOS evidence show incremental economic value after cost.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research should test the temporal
families one at a time and preserve source-pair lineage. The rejected composite
quote code must not be used until BBO completeness, causal event ordering,
recursive redaction, and real authenticated payload semantics are proven.

NEXT RECOMMENDED TASK: Apply migration 038, resume authenticated Optionomics
collection when the provider accepts Production credentials, and accumulate
resolved Paper lifecycle evidence after a real execution quote qualifies.
OWNER: Codex

TASK: Complete the locked follower Paper action-plan, reconciliation, divergence, and customer-control slice.

FILES CHANGED: Follower Paper runtime contracts and PostgreSQL store, migration 040, database readiness and verifier, copy participation persistence/API, My Bots and My Results surfaces, browser/unit/SQL tests, decisions, and handoff.

WHAT WAS IMPLEMENTED: Broker-confirmed master events can already create follower-specific copy decisions. The new layer turns an eligible decision into an immutable follower Paper action plan only after follower AEGIS and a fresh exact-contract approved two-sided quote pass. Explicit option position intents are preserved. Plans remain permanently locked. Read-only broker observations now classify absent, external, partial, filled, canceled, rejected, and ambiguous states without retrying. Follower lifecycle divergence covers skipped master entry, CSP close/roll, assignment, stock recovery, covered calls, call-away, partial fill, pause, broker drift, and restart reconciliation. Customers can persistently stop new entries or resume them while existing positions remain managed. Customer and operator pages now show persisted allocation, broker state, copy tracking, and follower-runtime counts.

TESTS RUN: Focused TypeScript, ESLint, follower runtime, customer credential, OAuth, database readiness, browser, full Node, Python, build, security, PostgreSQL migration/invariants, and CI before release.

KNOWN LIMITATIONS: Follower submission remains disabled and no follower is active. No follower economic result exists. The execution quote gate is unchanged. Production evidence rows can only appear after a real follower and broker-confirmed master fill exist.

RISKS: A follower can diverge economically from the master through quantity, price, fill, assignment, and lifecycle timing. The system records those differences and must never publish master results as follower results.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant work may review follower AEGIS inputs and sizing evidence. It must not change execution gates, tenant boundaries, broker truth, or follower lifecycle accounting.

NEXT RECOMMENDED TASK: Accumulate master Paper evidence after a qualified execution quote exists, then test the full copy path with a separate authenticated follower Paper account while keeping submission locked until its independent release gate is approved.

OWNER: Codex

TASK: Close the active-management selection, execution-leg compilation, and policy-lineage seam.

FILES CHANGED: Management input/frontier, autonomous runtime dependency boundary, management Paper plan compiler and atomic publisher, research export, migration 041, database readiness/verifier, focused tests, completion matrix, decision log, and this handoff.

WHAT WAS IMPLEMENTED: Management can accept a complete same-snapshot policy comparison and select a non-passive action without letting stale or partial evidence displace HOLD. Exact no-order expiration outcomes use broker session and moneyness facts. Selected active actions compile into exact CSP close/roll, stock exit, covered-call open/close/roll directives. Current exposure comes only from reconciliation. New target identity and economic limits come only from selected evidence. Policy version and evidence hash are persisted and revalidated in the atomic plan transaction. Research export retains that lineage.

TESTS RUN: Focused management frontier, input, compiler/assembler, runtime provider, and research export tests. Full Node, Python, PostgreSQL, Redis, browser, build, security, and CI results are recorded in the release report.

KNOWN LIMITATIONS: Production has no empirically promoted management-policy evidence provider. The worker therefore remains passive outside exact no-order expiration outcomes. A fresh qualified two-sided execution quote is still required at order time.

RISKS: A fitted management model can still be poorly calibrated even when its contract is valid. Promotion needs independent whole-chain evidence and must preserve tail, capital-day, execution, and inventory outcomes rather than optimizing win rate.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research should produce the versioned same-snapshot evidence contract and prove each active policy through paired walk-forward and untouched OOS evaluation. It must not mutate runtime thresholds or bypass the evidence, AEGIS, quote, inventory, and broker-reconciliation gates.

NEXT RECOMMENDED TASK: Accumulate point-in-time and resolved Paper evidence, promote a management challenger only after empirical acceptance, and qualify a fresh two-sided execution quote. Keep follower submission and all live trading locked.

OWNER: Codex

TASK: Build the P2 dynamic profit-preservation and shadow management-policy evidence slice.

FILES CHANGED: Claude's bounded profit-preservation research commit, TypeScript shadow management policy, autonomous management collector, migration 042 and invariants, deterministic research export v2, database readiness/verifier, focused tests, decisions, system matrix, and this handoff.

WHAT WAS IMPLEMENTED: Every reconciled open THETA chain now produces immutable research evidence for profit capture, peak profit since collection began, giveback, remaining structural reward, secured capital-days, current option Greeks and context through the linked input snapshot, the full lifecycle-specific action frontier, fixed and dynamic exit challengers, STAY/SWITCH/WAIT costs, and categorical event-state change. Structural close marks and maximum remaining reward are kept separate from expected after-cost value. Unknown tail, continuation, execution, opportunity, flow-acceleration, and strategy-switch inputs remain null with explicit reasons. The research dataset contract advanced to v2 and includes the shadow record. Database constraints permanently force this provider to stay incomplete, non-preferred, unpromoted, and non-executable. A separate empirical-promotion validator requires reproducible dataset identity, embargoed train/validation/OOS windows, complete economics and risk metrics, versioned acceptance evidence, execution evidence, and approval. Even a complete receipt remains non-executable and can only become ready for human review.

TESTS RUN: TypeScript, focused Node and Python research tests, ESLint, build, and security scan. Full Node/Python/browser, PostgreSQL migration/invariants, Production deployment, and CI are completed in the release receipt.

KNOWN LIMITATIONS: This makes professional management questions observable and testable. It does not predict the future or prove a profitable exit policy. Production continues to use passive management because no forward management model has passed walk-forward and untouched OOS validation. Flow acceleration/reversal needs a real repeated provider series. Docker is unavailable locally, so PostgreSQL validation runs in CI and Production.

RISKS: A fixed take-profit challenger can look attractive through selection bias, and a trailing giveback rule can overtrade noisy options. Any later promotion must compare whole-chain after-cost EV, tail loss, drawdown, capital-days, calibration, and execution quality across independent OOS episodes. Win rate or a round percentage alone is insufficient.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research should consume dataset v2, fit no values into the original feature cutoff, and compare each challenger on the same episodes. It must keep the production policy provider unconfigured until an explicit empirical promotion receipt passes.

NEXT RECOMMENDED TASK: Accumulate real point-in-time management observations and resolved whole-chain labels, then run paired challenger experiments. Restore authenticated Optionomics observations for flow and event deltas without weakening quote qualification.

OWNER: Codex

TASK: Complete P2B options-chain decision intelligence as a research-only Production vertical slice.

FILES CHANGED: Canonical chain decision module, atomic cycle persistence, migration 043 and invariant checks, deterministic dataset v3 and Python intake validation, focused tests, database readiness, decisions, completion matrix, and handoff documents.

WHAT WAS IMPLEMENTED: Every persisted canonical frontier now produces one immutable exact-contract chain record. It includes quote age and liquidity state, Greeks, IV, OI, volume, intrinsic/extrinsic and breakeven context, expiry comparisons, strike/delta/liquidity ladders, all five THETA structures plus WAIT, exact-scope Optionomics attachments, explanation reasons, and empty future counterfactual labels. Structural economics retain contract multipliers and covered-call whole-chain call-away outcomes. Empty contract sets remain valid WAIT evidence.

TESTS RUN: Full Node suite, Python quant suite, TypeScript, ESLint, build, security scan, Neon migration 043, full database verifier, and migration 043 invariants. Browser tests were not required because no UI changed. Docker Desktop was unavailable locally, so the canonical Production Neon database provided PostgreSQL verification.

TEST RESULTS: Node 839 tests passed with 5 environment-dependent skips. Python 470 tests passed. TypeScript, lint, build, security, database verification, and migration invariants passed. Security scan found zero findings.

KNOWN LIMITATIONS: Optionomics authenticated data is still unavailable to the runtime, and neither Optionomics nor Alpaca currently proves a qualified fresh exact-contract execution quote. The new policy has no invented universal liquidity thresholds. Empirical after-cost values and future counterfactual outcomes remain null.

RISKS: Structural premium and Pareto relationships can be mistaken for alpha. This evidence layer cannot promote a model, authorize execution, or support a profitability claim without resolved independent OOS evidence.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research should consume dataset v3, validate each feature family and structure through point-in-time ablation, preserve whole-chain grouping, and never populate counterfactual labels before their availability time.

NEXT RECOMMENDED TASK: Accumulate authenticated chain snapshots and resolved whole-chain outcomes, then run the P2B contract and structure challengers through the existing empirical promotion process. Keep all Paper execution blocked until the separate quote and readiness gates pass.

OWNER: Codex

TASK: Complete P2E time-aware decision intelligence, position-path evidence, action/inaction research, Optionomics provider readiness, and safe operator controls.

FILES CHANGED: Time, path, frontier, timing-router, Optionomics capability, operator-control, runtime persistence, dataset v6, migration 047, verifier/readiness, tests, phase ledger, decisions, and this handoff.

WHAT WAS IMPLEMENTED: Reconciled open chains now persist immutable path checkpoints, non-scalar action/inaction frontiers, session/option-time state, and all-branch timing applicability. WAIT and HOLD can be audited for missed opportunity without becoming forced action rules. Optionomics capabilities require real documented evidence and an empty capability set cannot pass. Owner controls are authenticated, same-origin, confirmed, idempotent, immutable, and preserve management plus reconciliation. Dataset v6 exports the new point-in-time evidence. TCA includes submitted-limit slippage and aggregate cancel/replace attempts. Return cohorts carry a definition version.

TESTS RUN: TypeScript and the complete Node suite passed before database/deployment verification. PostgreSQL, lint, build, security, browser, CI, Production migration, and worker checks are recorded in the release receipt.

KNOWN LIMITATIONS: No empirically promoted management policy exists. Optionomics Production capability proof and a qualified fresh two-sided execution quote remain external blockers. Path classification is descriptive and must not be treated as alpha.

RUNTIME CORRECTION: Production exposed an immutable strategy-version hash mismatch that predated this release. The Conventional research definition is now `theta-conventional@1.0.1-research`, preserving `1.0.0` and allowing evidence collection to resume without mutating history or promoting the strategy.

RISKS: Small samples can make WAIT regret, giveback, and timing cohorts look predictive. Promotion still requires PIT-safe walk-forward and untouched OOS results with after-cost EV, tails, capital-days, calibration, and execution evidence.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research should test path and timing families one at a time and keep whole-chain episodes grouped. It must not turn descriptive states into fixed trade rules or bypass runtime gates.

NEXT RECOMMENDED TASK: Apply migration 047, collect real changed-state evidence, qualify authenticated Optionomics capabilities, and run P2E cohorts through the existing R6 acceptance process. Keep all order submission blocked.

OWNER: Codex

TASK: Complete P2F provider-activation readiness, execution-quote qualification infrastructure, concurrency-safe operator controls, and the machine-checkable R8 entry gate.

FILES CHANGED: Optionomics transport and qualification, provider-neutral quote qualification, operator API and controls, immutable alerts, decision explanations, semantic path checkpoints, strategy-version persistence, migration 048, verification tools, tests, phase ledger, and P2F documentation.

WHAT WAS IMPLEMENTED: Server-only Optionomics transport now records sanitized correlation, request, latency, rate-limit, content-type, and retry evidence. Real, replay, and synthetic qualification modes remain distinct. Execution quotes require exact contract identity and individually qualified two-sided evidence. Operator commands use monotonic state versions, serialized database writes, idempotency, and a reasoned emergency-lock clear that leaves new entries paused. Immutable qualification receipts and alerts are available to the operator view. Strategy payload drift under one semantic version is rejected. The R8 receipt separates engineering readiness, provider readiness, Paper activation, and empirical evidence and cannot authorize an order.

TESTS RUN: Full Node and Python suites, TypeScript, ESLint, build, security scan, browser/accessibility tests, migration 048, Production Neon invariants, synthetic/replay provider qualification, quote qualification, and Reticle gate where available.

TEST RESULTS: Recorded in the P2F release receipt. Production database verification confirms migration 048, immutable provider receipts, state-version controls, semantic checkpoints, one master account, zero followers, and zero broker orders.

KNOWN LIMITATIONS: Local Vercel pulls redact the Optionomics secret, so genuine authentication and entitlement evidence must be collected by the deployed server-side qualification route. No execution quote source has passed the trusted fresh two-sided contract. Resolved outcome labels and an empirically promoted management policy remain unavailable.

RISKS: Authentication success could be mistaken for execution-quote authority, and a fresh trade print could be mistaken for a two-sided quote. The separate qualification receipts and hard execution gate prevent both shortcuts.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research may evaluate normalized Optionomics feature families and outcome cohorts. It must preserve the provider/execution boundary, feature-label firewall, strategy version identity, and all execution locks.

NEXT RECOMMENDED TASK: Run the deployed real-auth qualification from an authenticated operator session, qualify each documented capability with real response evidence, and continue collecting resolved Paper evidence. Stop before any broker order until the independent first-order and execution-quote gates both pass.

OWNER: Codex

TASK: Complete P2G synthetic lifecycle proof, non-submitting Paper order preview, provider-family failure isolation, and OPRA-independent pricing semantics.

FILES CHANGED: P2G simulator, Paper order preview, Optionomics Vega family-health evaluator, immutable migration 049, persistence helpers, database invariants, readiness contract, tests, and P2G documentation.

WHAT WAS IMPLEMENTED: A deterministic full Wheel chain and representative scenario registry now prove lifecycle and accounting mechanics while remaining excluded from real evidence and policy learning. Single-leg and multi-leg previews record exact terms, pricing provenance, risk, AEGIS, locks, persistence, and idempotency while hard-coding all broker submission fields false. The first-order receipt now accepts either proven consolidated NBBO or proven trusted two-sided order pricing and no longer assumes every valid source must be Alpaca OPRA. Optionomics families fail independently across empty, partial, stale, malformed, missing-timestamp, duplicate-page, and pagination-loop evidence.

TESTS RUN: Full Node and Python suites, TypeScript, ESLint, build, security, migration 049, PostgreSQL invariants, CI, Production deployment, and worker verification are recorded in the P2G release receipt.

KNOWN LIMITATIONS: Simulation is not market evidence. Optionomics Production authentication currently returns HTTP 401 and no execution-price source has produced authenticated, documented, fresh exact-contract two-sided evidence. The policy provider remains unpromoted.

RISKS: Synthetic PnL could be misread as performance. Database constraints and receipt flags prevent it from entering real evidence. Trusted two-sided pricing must not be labeled NBBO unless the source proves consolidated semantics.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research may inspect scenario coverage but must not treat simulated rows as training evidence or resolved R8 samples.

NEXT RECOMMENDED TASK: Resolve the Optionomics Production authentication failure and capture actual per-family schemas and fresh price semantics. Then create a real candidate-specific preview and stop before the first Paper broker submission.

OWNER: Codex

TASK: Preserve every Neon branch, exhaust all bounded recovery surfaces, and make Neon-to-Aiven historical recovery resumable without reintroducing Neon runtime authority.

FILES CHANGED: Neon recovery runner, control-plane manifest importer, Aiven table-level recovery inventory, protected runtime operation, tests, manifests, recovery matrix, support request, decision record, and this handoff.

WHAT WAS IMPLEMENTED: The Neon control plane was inventoried through the existing Vercel SSO without creating a new credential. Main and both Vercel preview branches are preserved. Main pooled and direct PostgreSQL returned SQLSTATE 53000, while preview SQL, Data API, Time Travel, snapshot, and operation-history surfaces were unavailable under the project-wide transfer quota. Local, Claude/Codex history, and GitHub artifact searches found no full database dump. The ignored recovery runner now probes each configured source once and will create hashed PostgreSQL 18 custom-format dumps immediately when source reads return. A protected Aiven operation inventories every canonical table and distinguishes staged history, reconstructed current state, schema-only state, confirmed empty order state, and Neon-blocked history. The exact control-plane manifest can be staged in Aiven with immutable provenance and no secret fields.

TESTS RUN: Node syntax checks, complete Node suite, TypeScript, ESLint, build, and security scan. Production endpoint, Aiven inventory, manifest staging, CI, deployment, worker, and zero-order checks are recorded in the release receipt after deployment.

KNOWN LIMITATIONS: Neon row data cannot be exported while the provider enforces the transfer quota. The existing 25,125 staged research records are valuable partial history, not a full source recovery. No source row counts, table hashes, full dump, or preview-branch dump can be claimed yet.

RISKS: Restoring a source dump directly over Aiven would overwrite current runtime truth. All eventual dumps must enter isolated staging, retain source lineage, and pass table-by-table deduplication and authority checks.

WHAT THE OTHER AGENT SHOULD REVIEW: Research may use only staged records whose real/synthetic and PIT classifications are known. It must not treat staged history as current broker state or complete training evidence.

NEXT RECOMMENDED TASK: Ask Neon for a temporary read-only export window or provider-generated immutable export using the prepared support request. When access returns, run the recovery command once, hash the dumps, restore to isolated staging, compare every table, and backfill approved immutable history only.

OWNER: Codex

TASK: Prove the Aiven legacy import and promote all safe recovered Neon history.

FILES CHANGED: Migration 051, legacy promotion validator/store, protected Production operation, local promotion and recovery-method tools, inventory and database validation, tests, recovery documentation, decision record, and the production receipt.

WHAT WAS IMPLEMENTED: Every staged legacy record now passes an explicit schema, provenance, PIT, evidence-class, native-identity, and execution-authority classification. Valid research evidence is exposed through an immutable research view. The control-plane manifest is exposed through a separate immutable operations view. Direct insertion into native runtime tables is forbidden when original parent lineage is incomplete. Canonical ID/hash matches deduplicate, conflicts quarantine, and unverifiable native-ID matches quarantine. An ordered SHA-256 staging fingerprint makes reruns reproducible. A PostgreSQL text/UUID comparison defect found by the first rolled-back Production run was fixed and covered by a real PostgreSQL 18 regression test.

TESTS RUN: TypeScript, ESLint, full Node suite, Python suite, build, security scan, disposable PostgreSQL 18 migrations 001 through 051, promotion integration tests, schema invariants, Production migration, Production promotion, Production invariant validation, root HTTP check, Vercel deployment, GitHub CI, Windows worker repin, and zero-order checks.

TEST RESULTS: Production classified all 25,126 staged rows. It promoted 25,125 PIT research rows and one engineering manifest, with zero rejects, zero conflicts, zero canonical rows changed, and execution authorization false. Migration head is 051. Production has zero invalid indexes, zero unvalidated constraints, and 3 of 20 client connections at the invariant probe. Exact receipts are in `docs/LEGACY_NEON_PROMOTION_RECEIPT_2026-09-16.md`.

KNOWN LIMITATIONS: The staged export is a valuable partial application export, not a full PostgreSQL source dump. Neon still rejects source reads under the project transfer quota. No missing source table or preview-branch row may be claimed recovered until a provider export or restored read window permits a complete dump and comparison.

RISKS: Mixing staged legacy payloads into current operational tables would break lineage and could overwrite current truth. The isolated immutable history layer prevents that. Research must still inspect source classification and PIT eligibility before using records for training or policy evaluation.

WHAT THE OTHER AGENT SHOULD REVIEW: Quant research may consume `research.legacy_neon_recovered_evidence` only as point-in-time historical evidence and must keep it separate from current broker state and future labels. It must not infer completeness from promotion success.

NEXT RECOMMENDED TASK: Resume the normal THETA roadmap using Aiven current state plus the promoted history. When Neon access returns, run the already prepared full-source recovery once and backfill only newly proven immutable history.

OWNER: Codex

TASK: Complete the maximum bounded reconstruction of legacy Neon history from every accessible authoritative non-Neon source.

FILES CHANGED: Migration 052, immutable reconstruction registry and analysis, protected import operation, Production validation, reconstruction sweep and importer tools, tests, provenance graph, complete recovery matrix, decisions, receipt, and this handoff.

WHAT WAS IMPLEMENTED: All 134 canonical data families were mapped to writers, origins, keys, time semantics, point-in-time requirements, and reconstruction status. The sweep inspected 109 immutable exports, 23 research-output runs, 138 research-output JSON files, bounded local and agent locations, Git history, 310 GitHub Actions artifacts, Vercel metadata, Alpaca Paper, and qualified Optionomics evidence. Aiven now records one immutable sweep, 147 source assessments, and 134 family assessments. Replays are transaction-serialized and idempotent. No canonical trading row is changed by the registry.

TESTS RUN: Focused Node tests, TypeScript, full CI Node, ESLint, build, security, browser, Python, PostgreSQL 18 migrations and invariants, real customer persistence, Production replay, Production Aiven validation, Vercel deployment, and root HTTP verification.

TEST RESULTS: CI run 35204020884 passed. Production is at migration 052 with 0 invalid indexes, 0 unvalidated constraints, 2 of 20 connections, and 136,033,983 database bytes. The maximum proven recovery remains 25,125 exact PIT research rows plus one engineering manifest. No additional older-only record was found.

KNOWN LIMITATIONS: Full Neon source recovery remains unavailable while transfer quota blocks row access. There are 1,548 unique unresolved parent keys and 101 families whose original legacy history remains Neon-only. No resolved outcome label, management event, or whole chain could be reconstructed safely from the available evidence.

RISKS: Current Aiven rows must not be mistaken for recovered historical Neon rows. Generic Alpaca activities must not be assigned THETA intent or chain lineage. Conflicting strategy-frontier variants must remain distinct source versions.

WHAT THE OTHER AGENT SHOULD REVIEW: Research may consume only the 25,125 promoted PIT rows under their recorded source and missing-parent limits. It must not infer dataset completeness, reconstruct missing labels, or treat metadata-only registry rows as empirical evidence.

NEXT RECOMMENDED TASK: Resume the normal THETA roadmap with Aiven as runtime authority and the execution quote gate intact. When Neon reads become available, run the prepared full-source recovery and compare the source dump against this immutable registry.

OWNER: Codex

TASK: Exhaust local, agent, export, Git, workspace, temporary, and retained-origin evidence before classifying legacy records as Neon-only.

FILES CHANGED: Migration 053, immutable local-forensic registry, hash-bound chunk importer, forensic sweep, protected Production operation, tests, corrected reconstruction logic, recovery receipt, reconstruction matrix and provenance graph, handoff, and Windows worker timeout guard.

WHAT WAS IMPLEMENTED: The sweep inspected 109 immutable research exports with 244,566 row occurrences, 144 research-output JSON files with 1,704 parsed objects, Codex and Claude state, Downloads, temp storage, the old repository, every current worktree, Cursor history, locally available OneDrive files, WSL storage, 134 unreachable Git objects, and retained CI artifact metadata. It preserved 460 exact payload variants from 230 conflicting identities and 553 key-level search receipts in Aiven. The earlier 1,548-key estimate was corrected: 995 entries are typed strategy-frontier text references and cannot reference the UUID candidate parent table. The actual unresolved parent set is 302 fusion snapshots, 125 decisions, and 126 UUID candidate evidence rows. No child reference was fabricated into a parent. Migration 053 makes the forensic archive immutable, replay-safe, and permanently non-executable.

TESTS RUN: Full Node suite, TypeScript, ESLint, build, security scan, browser suite, Python quant suite, disposable PostgreSQL migrations and invariants, real customer persistence, Production Aiven import/replay and invariants, Vercel deployment, CI, and one full Windows worker cycle.

TEST RESULTS: 935 Node tests ran with 925 passed, 10 database-only skips, and 0 failures locally. CI passed all Node, browser, Python, PostgreSQL, persistence, build, lint, type, and security checks. The security scan found zero findings. Aiven accepted 11 of 11 chunks, 295 source receipts, 460 payload variants, and 553 missing-key search receipts, with zero canonical rows changed and no execution authorization. Migration head is 053. The repinned worker completed a full cycle ONLINE in `MASTER_THETA_PAPER` mode under `EXTERNAL_QUOTE_BLOCKER`.

KNOWN LIMITATIONS: Docker Desktop's engine was unavailable, so Docker volumes remain an unavailable search surface rather than a proven empty one. OneDrive had 149 offline placeholders that could not be read. No complete record for the remaining 553 parents was found outside Neon. Those parents and 101 original legacy data families remain recoverable only from Neon unless a future independent full record with valid provenance is found.

RISKS: Child evidence can look like a recoverable parent when searched without schema typing. The UUID-only correction prevents that error. Historical variants must remain evidence and cannot overwrite current Aiven runtime truth or authorize execution.

WHAT THE OTHER AGENT SHOULD REVIEW: Research may use only records with explicit point-in-time and evidence classifications. It must not infer missing labels, complete parents, fills, management actions, or whole-chain histories from child references.

NEXT RECOMMENDED TASK: Continue normal THETA work using Aiven as the only runtime authority. Keep Neon preserved and read-only. When Neon becomes readable, run the prepared full export, stage it in isolation, compare stable identities and hashes against the forensic registry, and backfill only proven immutable history.
# 2026-09-17 master Paper activation safety slice

OWNER: Codex

TASK: Persist the owner's Paper-only authority and make existing-position management independent from the new-entry pause without weakening quote, policy, AEGIS, or broker gates.

FILES CHANGED: migration 054, Paper authorization store, autonomous runtime and handler, action-plan claiming, database verification, tests, and decisions.

WHAT WAS IMPLEMENTED: Immutable `MASTER_THETA_PAPER` authorization lineage, fail-closed effective control composition, follower/live exclusion, management-only staged mode, management-priority plan claiming while new entries are paused, and a protected idempotent authorization operation. New risk stays blocked unless a production management policy provider is present and all existing gates pass.

TESTS RUN: TypeScript check, full Node suite, ESLint, production build, security scan.

TEST RESULTS: Passed. Alpaca account is ACTIVE at the Paper host with options level 3, zero positions, and zero open orders. Alpaca OPRA returned HTTP 403 NOT_ENTITLED. Optionomics Production authentication and intelligence capabilities passed, but its documented chain semantics remain session-recorded research rather than execution-price authority.

KNOWN LIMITATIONS: No empirically promoted production management policy provider exists. No qualified fresh exact-contract two-sided execution-price source exists for order pricing. New entries remain paused.

RISKS: Activating new risk before both blockers are resolved would create positions that the current production policy cannot manage with validated forward economics.

WHAT THE OTHER AGENT SHOULD REVIEW: Management policy research and empirical promotion evidence only. Do not alter production execution controls or provider semantics.

NEXT RECOMMENDED TASK: Qualify an authorized execution-price source, promote a validated management policy from real evidence, then use the staged authorization to open one bounded Paper canary.
