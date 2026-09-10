# CLAUDE.md — trading-bots

**Read `docs/TEAM_CHARTER.md` first.** It is the shared rulebook Codex and Claude Code
both operate under in this repository (canonical specs, providers, lifecycle,
non-negotiable financial rules, teamwork/disagreement protocol, ablation reporting
format, public-repository security rules, and the agent handoff format). This file is
Claude's role-specific entry point and does not repeat that charter in full — Codex has
its own entry point at `AGENTS.md`, pointing at the same charter, so the two agents
never work from diverging copies of the shared rules.

This repository hosts the user's multi-bot options-trading platform. **THETA is the
first bot** and the only one in scope for v1. Five further bots (PULSE, NEXUS, VEGA,
EVENT, ATLAS — 0DTE, event, vol-RV and swing strategies) are named in the canonical
documents but are explicitly out of scope until THETA graduates. Do not scaffold code
for them.

Read this file before touching anything in `bots/theta/`.

## Canonical documents (build authority — do not paraphrase from memory)

All are in `docs/specs/`:

- `THETA_v1_1_FINAL_TRD_Alpaca_Optionomics_2026-09-09.docx` — **Technical Requirements
  Document. This is the frozen build authority.** Strategy lifecycle, architecture,
  formulas (Appendix A), provider contracts, risk rules, validation standard, and the
  release-signature gates all live here. Section 58 ("TRD Freeze and Handoff Contract")
  states explicitly: the PRD may define workflows/UX but may **not** redefine metrics,
  lifecycle, provider ownership, risk semantics, or formulas. Any of those requires a
  versioned TRD revision — never a silent change made while coding.
- `THETA_v1_1_FINAL_PRD_Alpaca_Optionomics_2026-09-09.docx` — Product requirements:
  operator workflows, UI surfaces (Command Center, Opportunity Center, Research/Backtest
  Lab, AEGIS Risk Center, Model Health, etc.), KPI contract.
- `THETA_v1_1_FINAL_Backend_Database_Schema_Alpaca_Optionomics_2026-09-09.docx` —
  Physical schema specification (partitioning, RLS, views, immutability enforcement).
- `THETA_v1_1_PostgreSQL_Bootstrap_Schema_2026-09-09.sql` — A **bootstrap starting
  point only**, using idempotent `IF NOT EXISTS` DDL. It is not yet a forward-only
  migration system and does not yet implement all views/partitioning/RLS the schema doc
  promises. Convert it into ordered migrations in Phase 0 — do not apply it as-is.

Also read `docs/OWNERSHIP.md`, `docs/QUANT_IMPLEMENTATION_MAP.md`,
`docs/ENGINEERING_IMPLEMENTATION_MAP.md`, `docs/IMPLEMENTATION_AUDIT.md`, and
`docs/PHASED_PLAN.md` before proposing or reviewing any implementation work.
`docs/IMPLEMENTATION_AUDIT.md` in particular records open decisions (e.g. the
`broker_order`/`order_intent` cardinality question) that must be resolved — not
silently picked either way — before the execution engine is built.

An earlier read-through of these same documents (by a Codex session, before this repo
existed) is preserved for cross-reference at
`~/Documents/Codex/2026-09-09/read-all-my-files-in-depth/outputs/THETA_v1_1_Implementation_Audit_and_Plan_2026-09-09.md`
on the user's machine — it is **not** part of this repo and is not authoritative, but
its findings (see "Findings requiring resolution before coding") are worth checking
against before Phase 0 work begins.

Version history note: `v1.0` documents in `~/Downloads` are superseded by `v1.1` and
are not copied into this repo. The TRD's own "canonical blueprint basis" line cites an
"Independent AI Options Bots Blueprint v5.5" as latest; only v5.4 and earlier blueprint
PDFs were found in `~/Downloads` at the time this repo was created — v5.5 was not
located. Flag this to the user if a future task needs it; do not invent its content.

## What THETA is

An assignment-aware premium-selling Wheel bot. Canonical lifecycle (TRD §4):

```
WAIT -> CSP_PROPOSED -> CSP_OPEN
  -> BTC_CLOSE / EXPIRE_OTM / ROLL_DECISION -> NEW_CSP
  -> ASSIGNED -> STOCK_HELD
       -> RECOVERY_WAIT -> SELL_STOCK
       -> CC_PROPOSED -> CC_OPEN
            -> BTC_CLOSE / EXPIRE_OTM / ROLL_DECISION -> CALLED_AWAY
  -> CASH / REDEPLOY
```

Runtime providers are **Alpaca (broker/execution truth) and Optionomics (research
intelligence) only.** No other vendor may be added without a documented missing
capability plus a controlled OOS ablation proving it's needed, per TRD Canonical
constraint (§0). Optionomics never places an order — it is a features/context source.

The performance objective is **THETA_CycleUtility** (full-cycle, after-cost, per unit
of capital-time), not leg-level win rate. The 70–80% figure is a **Managed Episode WR
research target for named, validated high-confidence cohorts** (TRD §40, §50) — never a
guarantee, never a tuning target, and never the headline number reported without Leg
WR, Whole-Chain WR, open mark-to-market P&L, AvgWin/AvgLoss, PF, and drawdown alongside
it (OUT-002).

## Non-negotiable rules (see TRD §54 for the full "Prohibited Shortcuts" table)

This list restates `docs/TEAM_CHARTER.md`'s financial rules with their TRD requirement
IDs for quick lookup during review — the charter is the canonical copy if the two ever
seem to diverge.

- Delta is not probability of profit. Never treat 25-delta as "75% win rate."
- Quantity zero is a valid, expected sizing outcome. Never `max(1, qty)`.
- A roll is close-old + open-new. The old leg's realized P&L is immutable and cannot be
  absorbed into the new trade's numbers.
- Assignment is a modeled lifecycle transition, not automatic failure.
- Missing/stale optional data becomes `UNKNOWN` — never silently coerced to zero.
- No martingale or loss-doubling sizing, ever.
- Never claim 70–80% WR from calibrated model confidence — realized WR and predicted
  probability are different quantities (STAT-001).
- Never let a backtest win rate stand in for production proof — OOS, paper mechanics,
  and small-live fills are all required before graduation (TRD §30).
- Never manipulate models, thresholds, or the OOS split to force the 70–80% number into
  view. If the honest answer is a lower WR with a better payoff/drawdown profile, report
  that instead (TRD §2.2).

## Ownership split

See `docs/OWNERSHIP.md` for the full module-by-module table. Summary: **Claude (quant
research + adversarial validation lead)** owns everything under `bots/theta/quant/`,
the research schema, feature engineering, model design, calibration, backtesting
methodology (purged walk-forward, untouched OOS, benchmarks/nulls, ablations), leakage
detection, drift monitoring, and adversarial review of Codex's engineering output.
**Codex (engineering)** owns everything under `bots/theta/app/` (API, provider
adapters, execution, lifecycle state machine, accounting, AEGIS risk enforcement,
ops/monitoring) plus migrations and infra.

When reviewing Codex-authored code in `bots/theta/app/`, check it against the TRD
requirement IDs it claims to satisfy (e.g. `ROLL-001`, `PNL-003`) — don't just check
that it runs.

## Working agreements

- This is a **paper-first, safety-critical** codebase. No task in this repo should
  place, size, or reprice a live broker order without an explicit human-approved
  graduation gate (TRD §57, gates G1–G7).
- Do not silently redesign THETA's frozen architecture (lifecycle, provider ownership,
  outcome definitions, cost treatment, risk semantics). Any of these needs a versioned
  TRD revision — raise it to the user, don't just implement a different design.
- Do not build ahead of the current phase in `docs/PHASED_PLAN.md`. Each phase has an
  explicit exit gate; do not start Phase N+1 work before Phase N's gate is met.
- Never commit `.env`, API keys, broker credentials, account statements, or model
  weights. See `.gitignore`. If you ever see what looks like a live credential in a
  file about to be committed, stop and flag it — do not commit it "to be safe." **This
  repository may be public** (per `docs/TEAM_CHARTER.md`) — treat that as the default
  assumption, not an edge case. When real config exists, use `.env.example` with empty
  values only; don't invent variable names ahead of an actual config schema just to
  populate that file early.
- Prefer editing the phased plan / ownership doc over ad hoc scope creep. If new work
  doesn't fit a listed phase, that's a signal to update the plan deliberately, not to
  just start building.
- **Do not push to GitHub unless the user explicitly requests it** — the user controls
  remote pushes. Work incrementally and commit completed, tested milestones locally,
  leaving the tree clean after each one.
- When finishing meaningful work, close with the agent handoff format from
  `docs/TEAM_CHARTER.md` (OWNER/TASK/FILES CHANGED/... /NEXT RECOMMENDED TASK) so Codex
  has a clear starting point for its own review.
- Any alpha/strategy change follows the ablation protocol in `docs/TEAM_CHARTER.md`
  (BASELINE vs. BASELINE + NEW_FEATURE, all other variables held constant, full metric
  set reported, no cherry-picking) — this applies to Claude's own quant proposals, not
  only to reviewing Codex's work.

<!-- reticle:begin (managed by `reticle init` — edit outside these markers) -->
## Verifying with Reticle

This app is instrumented by **Reticle**, an in-app verification layer exposed as `reticle_*` MCP tools and the `npx @reticlehq/server` CLI (always through npx: Reticle's server is not installed into this project). Verifying is part of "done", not an optional extra.

**Verify when you have changed something a user can see or do.** A component, a form, a route, a request, a piece of state that reaches the screen. Do it BEFORE telling the user it is complete. Reading the diff proves nothing and unit tests do not run the app.

**Do not reach for Reticle when the change cannot show up in the running app.** It costs tool calls and the user's patience, and a verdict over an unrelated flow proves nothing about what you changed. Skip it for: documentation, comments, tests, build config, CI, dependency bumps with no user-facing effect, backend or CLI work with no UI surface, and any change to a project that is not a running web app. Say in one line that you skipped verification and why, rather than silently not doing it.

**How to verify:**

- Drive the flow with `reticle_act_and_wait({ ref, action, until })`. It names the consequence you expect BEFORE the action, which is the difference between a check and a rationalisation.
- Batch a multi-step journey (a login, a form) into one `reticle_act_sequence` rather than one round trip per field.
- Read the surrounding evidence with `reticle_snapshot`, `reticle_state`, `reticle_network`, `reticle_console`.
- **Only `reticle_act_and_wait` and `reticle_assert` produce a verdict.** `reticle_act` and everything else move or read the app and prove nothing, so a session ending without one of those two has no result however many tools it used.
- Covered flows: `npx @reticlehq/server gate` reports which recorded flows the changed files affect and whether they still pass.

**Setting Reticle up, or just restarted? You are mid-sequence — do not stop until a verdict exists.**
The whole of it is: instrument the app → get a dev server running → open the app in a browser →
drive one flow → report the verdict. Every step is yours to do, and none of them needs the user.
The ONE legitimate pause is a client restart, because a client reads its server list at startup;
when you come back, you are not finished, you are on the next step — resume it without being asked.
Stopping anywhere else leaves an app that looks installed and can verify nothing, which is the
single commonest way this goes wrong. `/reticle` carries the full recovery ladder when a step
does not work; use it rather than guessing, and never report the install as finished without a
verdict to point at.

**Nothing connected? Get the app running.**

**A dev server already running when `reticle init` ran does not have Reticle in its bundle.** It read the build config at boot; `init` edited it afterwards. It serves the old bundle and no session appears. In order:

1. **A dev server was already running?** Restart it, then hard-reload the tab. "Something is listening" does not mean the right bundle is served.
2. **Nothing was running?** Start it in the BACKGROUND and say so in one line. `reticle_sessions` gives you this project's own dev command in `next_action`; use that, never compose one. Started after `init`, it needs no restart.

Stopping to ask is how a verification turn ends with nothing verified.

Four guards, none optional:

1. **Never run two at once.** One dev server on the app's port. Restarting a stale one means stopping it first, not starting a second alongside it.
2. **Never guess the command.** It comes from `package.json` scripts. No recognisable dev script means say so and stop, not invent one.
3. **Never kill anything you did not start**, and never a daemon or a port holder. The one exception is the restart above, and say in one line that you did it.
4. **The permission prompt belongs to your host.** Never bypass, suppress or auto-approve it, and take a refusal as the answer.

A dev server that is already running does not pick up an edited build config or a newly created plugin file — restart it and hard-reload the tab. And if a server IS listening and still nothing connects, the cause is the SDK not loading in the page, not a missing dev server; do not tell the user to start one they are already running.

**Finish `src/reticle-dev.ts` before you claim setup is done.** `init` writes it and cannot always fill it in: a store that needs an argument only reading the code supplies (Jotai atoms, an XState actor, a TanStack `queryClient`) is left as a commented `registerStore` line. A file that registers nothing looks exactly like a finished one, and `reticle_state` then returns empty forever — which is indistinguishable from an app that has nothing to report, so it reads as success. Uncomment the line, complete it, and prove it by driving one flow and seeing your keys come back. If `init` told you to restart your client, this is the job waiting for you on the other side of that restart.

**Verify each feature as you finish it, not all of them at the end.** Asked for four, build one, drive it, get a verdict, then start the second. A red verdict after four builds has four suspects; after one it has none.

**Capture what a change is FOR while you are building it, not afterwards.** `reticle_intent` records the business outcome a change is meant to produce, and the only moment anybody knows it is while the change is being made. Pass `intent` when you save a flow, so the saved flow carries the reason it exists. A flow without one replays for months and then reports "step 3 failed" instead of what stopped being true for a user.

**Honesty, which is the whole point:**

- **`verified: "unknown"` is not a pass.** It means Reticle drove the app and could not tell what happened; `verifiedReason` says which clause decided that. Report it as unknown, never as working.
- **`verified: "no-fault"` is not a pass either.** It means nothing was DECLARED to prove: the page settled and no channel complained, but you asserted nothing, so there is no verification. You get it whenever `until` is omitted. Name a consequence the action changes — a signal, a request, a route, or store state — and call again.
- **Never weaken a check to make it green.** Downgrading, skipping or deleting an assertion is a finding, not a fix.
- **If Reticle cannot run** (no daemon, or this is not a running web app), say so. Do not skip verification silently.
- **Setup is not finished until one real flow has been driven and produced a verdict.** `init` exiting 0, the tools appearing, and a session being listed are all things that happen before anything has been verified.

**The `/reticle` skill runs this whole loop for you** — detect, connect, drive one flow, report. If your client does not have it, install it once: `/plugin marketplace add reticlehq/reticle` then `/plugin install reticle@reticlehq` in Claude Code, or `npx skills add reticlehq/reticle` anywhere the skills CLI works.

**A tool you need is missing? It exists.** The default surface advertises a subset; reach any other by name with `reticle_run { tool, args }`, and list them with `reticle_tools`. Two worth knowing: `reticle_context` returns this run's own memory — what is established, what is proven, what is still unverified — which is what you want after a compaction or when picking up work you did not start; `reticle_intent` records what a change was MEANT to do, while somebody still knows.

**Report Reticle's own defects with `reticle_feedback` the moment you notice**, then carry on with your task. You are the user Reticle is built for and the only one who can say what it cost you, and that knowledge is gone when your context is.

📄 **The rest is in [RETICLE.md](./RETICLE.md): what to do when the tools are missing, when a result carries `version_skew` or `update_available`, when `reticle_state` comes back empty, and how to write a feedback report that can be acted on. Read it when you hit one of those, not before.**
<!-- reticle:end -->
