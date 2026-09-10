# Codex handoff: standalone platform Phase 1

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
