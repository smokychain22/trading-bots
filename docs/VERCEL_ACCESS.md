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

## Open architecture question

THETA's frozen runtime topology (TRD §5–6) is a Node.js/TypeScript control plane +
Python quant service, PostgreSQL, Redis, and Docker/Docker Compose, with an
always-on scheduler holding Alpaca WebSocket connections (trade_updates, option
quote stream) during market sessions. Vercel's serverless/Fluid Compute model is not
a drop-in replacement for that — it doesn't run Docker Compose, and a function-based
architecture needs a different design for anything long-running (an always-on
scheduler, persistent WebSocket subscriptions) even though Vercel Functions can now
hold WebSocket connections and Vercel Cron can trigger periodic work.

This doesn't block anything in the current phase (no application code exists yet),
but it does affect how Codex should scaffold Phase 0 infrastructure, so it needs an
explicit answer before that work starts rather than an assumption baked into the
scaffold. See the question raised alongside this document's introduction for the
options considered.
