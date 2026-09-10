# Standalone platform verification

Verification date: 2026-09-10.

## Local gates

- ESLint: passed for TypeScript, tests and browser modules.
- TypeScript check and production build: passed.
- Node tests: 28 passed, including published-data honesty, economic reconciliation, zero quantity, strict simulation validation, customer API boundaries, Vercel nested routing and operator sessions.
- Browser tests: 18 passed in Chrome. Coverage includes all named pages, real local API calls, demo preservation, whole-chain loss, simulation, local drafts, comparison, loading, network/API failures, stale, degraded, invalid, paused, market closed, broker unavailable, shadow, paper and display-only live states.
- Accessibility: zero automated axe violations at desktop 1440 x 1000, tablet 834 x 1112 and mobile 390 x 844 across Bots, THETA, Positions, Simulate and Compare. Skip-link keyboard behavior passed.
- Responsive overflow: no page-level horizontal overflow at the three tested viewports. Wide tables use labeled focusable scroll regions.
- Security scan: zero findings across tracked and nonignored working paths. Configured sensitive values are checked without printing them.
- Dependency audit: zero production dependency vulnerabilities.

## Visual evidence

Reference screenshots are in docs/visual. The browser suite generates five full-page images per viewport in its run artifacts. The tracked set contains the Bots catalog and THETA overview at desktop, tablet and mobile sizes, plus tablet references for Compare, Positions and Simulate where the Linux overflow was found and corrected.

The references show DEMO DATA persistently on illustrative THETA performance, negative assigned-stock MTM in the KPI strip, no activation CTA, five research-only roadmap cards, and mobile progressive disclosure.

Automated checks and static screenshots do not replace testing with real assistive-technology users, slower devices, translated content or authenticated customer accounts.

## Deployment gates

The production deployment URL, HTTP route checks, security headers, Vercel state and GitHub CI run are recorded in the final Phase 1 handoff after the tested commit reaches main.

Trading remains disabled. No order endpoint exists in the customer API and no provider order call is made by these pages.
