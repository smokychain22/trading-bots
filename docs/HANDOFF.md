# Codex handoff: standalone platform Phase 1

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
