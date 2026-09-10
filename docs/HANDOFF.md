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
