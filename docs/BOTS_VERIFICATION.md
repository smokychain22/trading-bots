# Standalone platform verification

Verification date: 2026-09-10. Authoritative customer and copy-contract completion pass.

## Local gates

- ESLint: passed for TypeScript, tests and browser modules.
- TypeScript check and production build: passed.
- Node tests: 180 passed, including published-data honesty, economic reconciliation, follower-specific copy sizing, quantity zero, roll and assignment propagation, stable copy IDs, duplicate replay, partial-fill and ambiguous-submission reconciliation, customer API boundaries, operator sessions, runtime contracts, provider contracts, and fail-closed order intent behavior.
- Python tests: 253 passed across the existing Claude-owned quantitative contract and research modules. No quantitative source file changed in this pass.
- Browser tests: 16 passed in Chromium. Coverage includes state-driven Home, Bots, THETA, follower-only My Results, Positions, Trade History, Performance, My Bots, Activity, Account, three-step Copy THETA, active follower fixtures, negative manual-trade-control checks, `/ops/login`, all five protected owner routes, degraded state, API failure, customer CTAs, disabled-action explanations, and owner session behavior.
- Accessibility: zero automated axe violations at desktop 1440 x 1000, tablet 834 x 1112 and mobile 390 x 844 across every named customer route and `/ops/login`. The four authenticated owner detail routes also pass axe WCAG AA checks at the default desktop viewport.
- Responsive overflow: no page-level horizontal overflow at the three tested viewports. Wide tables use labeled focusable scroll regions.
- Security scan: zero findings across tracked and nonignored working paths. Configured sensitive values are checked without printing them.
- Dependency audit: zero production dependency vulnerabilities.

## Visual evidence

Reference screenshots are in docs/visual. The current browser suite generates twelve full-page images per viewport in its run artifacts, covering every customer route and `/ops/login`, plus authenticated screenshots for THETA, Trading, Copy, and System operations.

The current images show a state-driven copy-trading home, THETA as the primary paper bot, five visually secondary future bots, five customer THETA tabs, a three-step copy setup, follower-only My Results, clear disabled connection and activation states, and no fabricated performance. Desktop, tablet, mobile, and authenticated owner images were visually reviewed for hierarchy, spacing, clipping, overflow, misleading controls, and empty-container regressions. That review found and removed one empty owner login panel above authenticated content.

## Reticle supplement

Reticle `2.13.1` gate returned `pass=false` with outcome `no_flows`, covered 0 of 0.
The active Codex session does not expose Reticle's action or assertion tools and the
repository has no recorded flows, so no Reticle verdict is claimed. Playwright, axe,
screenshot inspection, and the normal repository gates are the enforceable
verification authority for this release.

Automated checks and static screenshots do not replace testing with real assistive-technology users, slower devices, translated content or authenticated customer accounts.

## Deployment gates

GitHub CI run
`https://github.com/smokychain22/trading-bots/actions/runs/34497319306` passed
for commit `7c951a087a38e76ff1f920a80c20e2cf650a4307`. Its PostgreSQL 16
service applied migrations 001 through 005 and passed every SQL invariant. Redis
responded to the CI health check.

Vercel production deployment `dpl_FbiuMHZNY24hZ1DESgGoYHmu29dA` is Ready at
`https://trading-bots-one.vercel.app`. Root, Bots, THETA, My Results, Account, copy
readiness, and copy-results routes return HTTP 200. Unauthenticated `/ops` and all
four `/ops/*` detail routes return HTTP 302 to `/ops/login`. CSP, frame, content-type,
and referrer security headers are present.

Trading remains disabled. No order endpoint exists in the customer API and no provider order call is made by these pages.

Docker Desktop was started for the local schema gate, but its Linux engine pipe
remained unavailable. This remains a local infrastructure blocker. The independent
GitHub PostgreSQL service executed and passed migration 005 and its SQL invariants.

## Provider connection readiness milestone, 2026-09-10

- TypeScript check, ESLint, production build, and dependency audit passed.
- Node tests: 288 passed, including OAuth scope, options levels 0 through 3,
  encrypted-token re-verification, missing-provider states, and database readiness.
- Python quantitative tests: 298 passed. No Claude-owned quantitative source changed.
- Browser tests: 16 passed across desktop, tablet, and mobile, including axe WCAG AA,
  overflow checks, customer connection states, and independent operator checks.
- Security scan: zero findings across 318 tracked and nonignored paths.
- Docker PostgreSQL and Redis remain locally blocked because the Docker Desktop Linux
  engine pipe is unavailable. GitHub CI is the required empty-database migration and
  SQL-invariant execution environment for migration 007.
- Vercel Production pull succeeded into ignored `.env.local`. The standard dotenv
  loader correctly removed dotenv syntax quotes and overrode stale process values.
  Vercel Secret values materialized locally as non-secret placeholders, so local
  provider authentication is not claimed. Vercel documents Secret values as
  write-only after saving while remaining available to deployed functions.
- Production contains the five existing master provider and operator variable names.
  It does not contain PostgreSQL, Alpaca Connect client, callback, or follower-token
  encryption variable names. Customer connection therefore stays limited to approved
  testing and PAPER execution remains locked.
- The repository Reticle skill file is absent on current `main`. The installed SDK and
  ignored `.reticle` metadata do not provide a skill workflow or saved verdict flow.
  Playwright screenshots were visually inspected as the documented fallback. No
  Reticle verdict is claimed.

## Neon and real provider verification, 2026-09-11

- Vercel project `skillswap7/trading-bots` exposes `DATABASE_URL`,
  `DATABASE_URL_UNPOOLED`, and `POSTGRES_URL_NON_POOLING` as Sensitive values in
  Production and Preview. Values were never printed.
- The real Neon database accepted migrations 001 through 009 in lexical order under an
  advisory lock. `core.schema_migration` contains all nine canonical versions.
- Seven SQL invariant files passed against Neon. The verification included immutable
  decisions, lifecycle economics, follower copy rules, customer identity and sessions,
  connection readiness, Paper execution readiness, and private Paper API-key rules.
- Required private-beta tables exist, including `iam.customer_identity`,
  `iam.customer_session`, `copy.alpaca_oauth_token`, `copy.follower_account`, and
  `copy.customer_participation`. The encrypted-token table contains no active test
  credential after cleanup.
- Production read-only Alpaca verification returned `CONNECTED`. Account status was
  `ACTIVE`, options approval and trading level were 3, positions and open orders were
  both readable and empty, and the market was closed at the observation time. OPRA was
  `NOT_ENTITLED` with HTTP 403. INDICATIVE option snapshots were `GOOD` with HTTP 200.
- Production Optionomics verification returned `CONNECTED` for every discovered and
  documented capability probe. No route was guessed.
- The deployed private connector accepted customer registration and an authenticated
  session, reported `READY`, rejected missing credentials, and mapped deliberately
  invalid credentials to `INVALID_AUTH` with HTTP 401. The response contained no supplied
  credential value. The temporary test identity and session were deleted afterward.
- A separate real tester credential was not available to this session. Production
  connect, encrypted persistence, replace, reverify, and disconnect with a genuine
  tester account remain an external end-to-end evidence gate.
- Production root returned HTTP 200, the temporary audit endpoint returned HTTP 404 after
  cleanup, and private Paper execution stayed locked. Database order count remained zero.
- Final local verification after R1 integration passed 399 TypeScript tests, 298 Python
  tests, ESLint, TypeScript checking, build, and security scan. Main CI passed.
