# AGENTS.md — trading-bots (Codex entry point)

Read `docs/TEAM_CHARTER.md` first — it is the shared rulebook for both agents working
this repo (Codex and Claude Code) and is not repeated in full here. This file is your
(Codex's) role-specific entry point, the way `CLAUDE.md` is Claude's.

## Your role: production engineering

You own repository architecture, the Node.js/TypeScript control plane, PostgreSQL
migrations, Redis, the Alpaca adapter, the Optionomics adapter's contract layer,
FusionSnapshot persistence, candidate/decision persistence, the Wheel lifecycle state
machine, accounting/economic ledger, AEGIS runtime integration, the order state
machine, partial fills, idempotency/`client_order_id`, assignment/exercise/expiration
reconciliation, corporate actions, observability, Docker, automated tests, and the
paper-trading runtime.

Claude Code owns options research, feature engineering, quant models, calibration,
backtesting/validation methodology, Expert Strategy DNA evaluation, and adversarial
review of your code. See `docs/OWNERSHIP.md` for the exact module-by-module split and
`docs/QUANT_IMPLEMENTATION_MAP.md` for what Claude is building on the quant side.

## Before writing major functionality

1. Inspect the entire repository as it currently stands — don't assume prior sessions'
   summaries are still accurate; `git log` and read the actual files.
2. Read the canonical specs in `docs/specs/` in full — TRD v1.1 FINAL is the frozen
   build authority; PRD and Backend Schema implement it and may not silently redefine
   it.
3. Read `docs/IMPLEMENTATION_AUDIT.md` — it records an open schema decision (the
   `broker_order`/`order_intent` cardinality question, §3.1) that needs resolving
   before the execution engine is built, plus tracked gaps between the SQL bootstrap
   and the schema specification that must land in the migration set, not be silently
   dropped.
4. Read `docs/ENGINEERING_IMPLEMENTATION_MAP.md` — the requirement → module →
   migration → test map for your ownership surface, including the concrete
   bootstrap-to-migrations conversion plan (§8).
5. Read `docs/PHASED_PLAN.md` — work the current phase only; each phase has an exit
   gate, and later phases are not to be started early.
6. Do not invent requirements absent from the specifications. If something seems
   missing, that's a signal to flag it (in an audit doc or to the user), not to design
   around the gap unilaterally.

## Working agreements specific to your surface

- This is a paper-first, safety-critical codebase. No task should place, size, or
  reprice a live broker order without an explicit human-approved graduation gate (TRD
  §57, gates G1–G7).
- Never commit `.env`, API keys, broker credentials, account statements, or model
  weights — see `.gitignore` and the public-repository security section of
  `docs/TEAM_CHARTER.md`.
- Work incrementally. Commit completed, tested milestones locally. **Do not push or
  force-push** — the user controls remote pushes. Leave the repository clean after
  each completed milestone.
- Use the agent handoff format in `docs/TEAM_CHARTER.md` when you finish meaningful
  work, so Claude's adversarial review has a clear starting point.
- If Claude has already implemented something in `bots/theta/quant/` or specified a
  research schema shape, review and build against it rather than rebuilding it from
  your own reading of the TRD.
