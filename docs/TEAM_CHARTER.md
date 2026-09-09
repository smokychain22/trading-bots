# THETA / trading-bots Team Charter

Official repository: https://github.com/smokychain22/trading-bots

This is the canonical implementation repository for the user's options-trading bot
platform. **The user is a non-coder.** Codex and Claude Code work as one
engineering/quant team with complementary, non-duplicating responsibilities. This
charter is the shared source of truth both agents work from — `CLAUDE.md` (Claude's
entry point) and `AGENTS.md` (Codex's entry point) both point here rather than
restating it, so it can't drift into two different versions of the truth.

Role-specific detail lives elsewhere: `docs/OWNERSHIP.md` (module-by-module split),
`docs/QUANT_IMPLEMENTATION_MAP.md` (Claude's quant surface), and
`docs/ENGINEERING_IMPLEMENTATION_MAP.md` (Codex's engineering surface). This document
is the rules both roles operate under, not a description of either role alone.

## Canonical specifications

Already supplied and authoritative (in `docs/specs/`, plus the research register at
`docs/research/RESEARCH_REGISTER.md` for offline evidence):

- THETA TRD v1.1 FINAL — frozen technical build authority
- THETA PRD v1.1 FINAL — product workflows, may not redefine TRD semantics
- THETA Backend/Database Schema v1.1 FINAL — physical implementation of the TRD
- PostgreSQL bootstrap schema — starting point, not the migration system
- Alpaca research, Optionomics research, profitable-options-trader / Expert Strategy
  DNA research, formulas/mathematics/strategy research and failure-DNA material —
  offline research priors, never runtime dependencies

## Runtime providers (v1)

1. **Alpaca** — broker/account truth, executable option/underlying market state,
   contracts, positions, orders, fills, activities, assignment/exercise/expiration,
   corporate actions.
2. **Optionomics** — IV, skew, term structure, volatility surface, options flow/UOA,
   event/earnings context, historical/research intelligence.

**Do not add another runtime API/provider without an explicit architecture decision
and an ablation proving incremental value.** This includes QuantWheel — confirmed by
direct reading of the blueprint lineage (`docs/IMPLEMENTATION_AUDIT.md` §6) to be
positioned as a possible future feature-flagged adapter only after a diagnosed
deficiency, never a required dependency.

## Lifecycle

```
CSP → CLOSE / EXPIRE / ROLL / ASSIGN → STOCK → RECOVERY_WAIT / COVERED_CALL → EXIT / CALLED_AWAY
```

## Performance objective

70–80% Managed Episode WR is a **research target for validated high-confidence
cohorts, not a guaranteed result.** The primary economic objective is positive
after-cost expectancy with acceptable profit factor, average win/loss, drawdown,
ES/CVaR, capital-days, assignment/inventory risk, recovery duration,
execution/slippage, and calibration. **Never optimize only for win rate.**

## Non-negotiable financial rules

Never:
- treat option delta as realized win probability
- assume midpoint fills
- hide unrealized assigned-stock losses
- erase losses when rolling
- automatically sell a covered call immediately after every assignment
- force quantity ≥ 1
- silently convert `UNKNOWN` data to zero
- use Optionomics as executable-price truth
- blindly retry an ambiguous Alpaca order
- use a market order simply because model confidence is high
- modify parameters merely until a backtest reaches 70–80%
- treat a backtest as proof of live profitability
- leak future data into features
- commit secrets or brokerage credentials

Quantity zero is valid. `WAIT` is valid. `RECOVERY_WAIT` is valid. Assignment can be
intentional. A roll is close-old-exposure + open-new-exposure — old realized losses
remain immutable.

## Teamwork rules

Codex and Claude work from the same canonical specifications. Before changing another
agent's module:
1. Inspect the latest code and git history.
2. Understand why it exists.
3. Preserve public interfaces unless a justified change is necessary.
4. Explain conflicts instead of silently rewriting architecture.

Every substantial change requires: tests, reproducibility, a clear reason, the
relevant requirement/issue reference, and a local git commit.

**Do not push to GitHub unless the user explicitly requests it. The user controls
remote pushes.**

If the other agent has already implemented something: **review it instead of
independently rebuilding the same thing.**

### Disagreement protocol

1. Preserve the current baseline.
2. Create a challenger/alternative.
3. Test both.
4. Compare evidence.
5. Keep the objectively better solution.

## Ablation protocol (required for any alpha/strategy change)

Compare BASELINE vs. BASELINE + NEW_FEATURE, holding all other variables constant.
Report together, with no cherry-picking:

- N and effective independent N
- Managed Episode WR
- Whole-Chain WR (where applicable)
- EV after cost
- Profit Factor
- Avg Win / Avg Loss
- Max DD
- ES/CVaR
- Capital-days
- Calibration/Brier
- Slippage/fill quality

## Public-repository security

**This repository may be public.** Never commit: `.env`, Alpaca API key/secret,
Optionomics API key, Discord/private webhooks, brokerage account identifiers, raw
private account data, database backups, private user credentials, production model
secrets, or proprietary live thresholds/weights intended to remain private. Use
`.env.example` with empty values only — see the note in `CLAUDE.md` about not
inventing variable names ahead of the config schema that actually needs them.

**Open item for the user, not decided unilaterally:** the four canonical spec
documents in `docs/specs/` (TRD/PRD/Schema/bootstrap) were committed when this repo
was assumed private. They contain the full Expert Strategy DNA reconstruction and
formula set — design IP, not credentials, so they aren't covered by the "never
commit" list above, but the user may still want them to stay private even if the code
itself goes public. Nothing has been pushed, so nothing is exposed yet; this is worth
a decision before the first push, not before every commit.

## Deployment access

`docs/VERCEL_ACCESS.md` covers Vercel CLI access rules (credentials handling,
permitted operations, restrictions on production changes/deletions). Same
never-print/never-commit discipline as the secrets rules above.

## Agent handoff format

When completing meaningful work, summarize:

```
OWNER:
TASK:
FILES CHANGED:
WHAT WAS IMPLEMENTED:
TESTS RUN:
TEST RESULTS:
KNOWN LIMITATIONS:
RISKS:
WHAT THE OTHER AGENT SHOULD REVIEW:
NEXT RECOMMENDED TASK:
```

Then make a clean local commit.

**The objective of both agents is not to agree with each other. The objective is a
trading system whose logic, data, accounting, execution, statistics, and risk can
survive independent scrutiny.**
