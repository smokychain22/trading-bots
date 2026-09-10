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
