# Vercel Access Rules

This project is linked to an existing Vercel project (`skillswap7/trading-bots`,
already confirmed via CLI inspection — do not create a new one). GitHub
(`smokychain22/trading-bots`) remains the canonical source repository.

## Credentials — never printed, never committed

`VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, and `VERCEL_TOKEN` are private environment
variables that live on the user's machine, not in this repo. Never print their
values, copy them into source code, add them to `CLAUDE.md`/`AGENTS.md`/any committed
doc, commit them, or include them in logs. `.vercel/` (local project-link metadata)
and `.env*` (including the `.env.local` the Vercel CLI writes when linking, which
contains a Vercel OIDC token) are gitignored — verify they stay that way rather than
assuming it; `git status` before committing anything Vercel-CLI-adjacent.

The CLI on this machine is already authenticated interactively (`vercel whoami` →
`smokychain22`), so most inspection/deploy operations below don't require the token at
all. The token matters for non-interactive/CI use, which isn't set up yet.

## Permitted operations

- Inspect project configuration
- Review deployments
- Inspect build/runtime logs
- Pull environment configuration (names/metadata — treat any pulled values with the
  same never-print/never-commit discipline as above)
- Link the local repo to the existing Vercel project (done — see below)
- Deploy preview builds
- Diagnose failed deployments
- Fix Vercel configuration
- Verify production deployments

## Restrictions

- **Do not create a new Vercel project if the existing one can be linked.**
- **Do not change production secrets/environment variables unless explicitly
  requested.**
- **Do not delete production deployments, domains, databases, or environment
  variables without explicit approval.**
- **Prefer fixing code in the repo, committing locally, and letting the GitHub→Vercel
  integration deploy it**, over deploying directly from a local working tree, unless
  a preview build is specifically what's needed to diagnose something.

## Current state (as inspected, no values read)

- Local repo linked via `vercel link` to `skillswap7/trading-bots`
  (`.vercel/project.json`, gitignored).
- One production deployment exists (created when the project was set up) with no
  detected build framework — consistent with this repo currently being docs-only
  (Phase 0, no application code).
- One Production-scoped environment variable is already configured on the Vercel
  project: `OPTIONOMICS_API_KEY`. Its value was not read or pulled. Its presence
  suggests some intent to reach Optionomics from a Vercel-hosted component, which is
  an open architecture question — see the note in `docs/TEAM_CHARTER.md` and
  `docs/PHASED_PLAN.md` until it's resolved with the user.

## Architecture decision: Vercel hosts the future dashboard/API only

Resolved with the user: **Vercel hosts a future Next.js dashboard and/or thin
reporting/monitoring API — not the trading engine.** THETA's runtime (scheduler,
Alpaca/Optionomics adapters, execution, AEGIS, the Wheel lifecycle state machine,
Postgres, Redis) stays self-hosted exactly as the TRD specifies (§5–6: Node/TS
control plane + Python quant service + Docker Compose, with an always-on scheduler
holding broker WebSocket connections during market sessions) — Vercel's
serverless/Fluid Compute model was never going to be a drop-in replacement for that,
and this keeps the frozen runtime topology intact with no TRD revision needed.

Implications for repo layout and Phase 0+ work:

- The Next.js dashboard, when it's built, is a **separate application** from
  `bots/theta/app/` — likely `apps/dashboard/` or similar alongside `bots/` at the
  repo root, added when the PRD's Command Center/reporting screens are actually
  scheduled (not before; don't scaffold it speculatively ahead of the phase that
  needs it).
- The dashboard talks to THETA's data through whatever read API/reporting layer
  `bots/theta/app/src/api/` exposes (per PRD §43 "Full Runtime API Stack" and the
  `analytics.v_*` read views) — it does not get its own direct database connection
  with independent query logic, to avoid two places defining "the" performance
  numbers.
- The `OPTIONOMICS_API_KEY` already configured as a Vercel Production env var (see
  above) is unusual under this decision — the dashboard shouldn't need direct
  Optionomics access if it's reading through THETA's own API. Worth asking the user
  whether that variable was set up in anticipation of something specific (e.g. a
  dashboard widget that calls Optionomics directly) or is leftover from an earlier
  plan, next time Vercel/dashboard work is actually picked up. Not urgent — it's an
  unused Production variable, not a live risk — but it shouldn't be silently
  forgotten either.
- Nothing in `docs/PHASED_PLAN.md` changes as a result of this — no phase currently
  includes dashboard work, and none should until the engine phases it depends on
  (candidate/decision persistence, performance views) are further along.
