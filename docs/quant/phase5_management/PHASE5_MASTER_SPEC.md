# THETA Phase 5 — Management Policy Master Spec

**Status of this document:** research/specification artifact for "CLAUDE PARALLEL QUANT
PHASE 5." Like the Phase 2-4 durabilization package, this persists specification work
directly to the repository rather than leaving it conversational. Conflict precedence
is unchanged: TRD v1.1 FINAL > PRD v1.1 FINAL > Backend/Database Schema v1.1 FINAL >
PostgreSQL bootstrap > canonical blueprint (v5.4) > this repo's own research corpus >
expert inference > any external code. RETAIN/CORRECT/TEST/REJECT used throughout;
every item carries a maturity label.

## 0. Input-availability finding (blocking Section A only)

**The "newly supplied legacy developer options-flow bot" referenced in this task's
instructions was not found.** Before writing anything, this pass searched: this
repository's full working tree and git history; `~/Downloads` (where the canonical
THETA spec documents, including `Independent_AI_Options_Bots_Blueprint_v5_4_...pdf`,
were previously found and confirmed present); `~/Documents` and its subfolders
(`Codex/`, `AMC/`, `LLC MORSABA/`, `TRENDTREKLLC/`, `agentPass/`,
`repodiet-e2e-test-admin/`); and a keyword search for flow/UOA/sweep/cooldown/mirrored-
account/TP-SL-style source code across both trees. No matching bot source file exists
on disk, and none was attached to this conversation.

**This pass does not fabricate an audit of code it has never read.** Section A below
("Legacy Bot Audit") is therefore produced at the *category* level only — reasoning
about the named behavior categories (flow/UOA filtering, sweeps, cooldowns, mirrored
accounts, etc.) as general trading-bot engineering patterns, exactly as the Phase 4
method corpus generalized GitHub patterns rather than attributing them to unverified
repositories. No specific implementation detail, threshold, or design choice is
attributed to the legacy bot's actual code, because none has been observed.

**To get a real Section A audit:** supply the actual source (file path this session can
read, or paste the code/description directly) in a follow-up message. Everything in
Sections B-M below does not depend on that file and is delivered in full now.

## 1. Section A — Legacy Bot Audit (category-level only, per finding above)

For each named category, a general classification is offered based on the category's
well-known engineering role in a directional options-flow bot, cross-referenced to
where an analogous concept already exists (or doesn't) in THETA's own registries.
**Every "RETAIN/CORRECT/TEST/REJECT/ROUTE_TO_*" below is a genuine judgment about the
*pattern named*, not a verified finding about a specific codebase.**

| Category | Classification (pattern-level) | Reasoning |
|---|---|---|
| Flow/UOA filtering | ROUTE_TO_PULSE / ROUTE_TO_ATLAS | Unusual-options-activity screening is a directional-conviction signal — it answers "is someone else making a large directional bet," which is PULSE/ATLAS's decision surface, not THETA's (THETA's entry gate is ownership/severe-drawdown quality, not third-party flow). See `H` below and `../phase3_strategy_dna/FUTURE_BOT_ROUTING.md`. |
| Sweeps | ROUTE_TO_PULSE / ROUTE_TO_ATLAS | Same reasoning — a sweep is a directional-urgency signal, not an ownership/premium-selling signal. |
| Opening activity | ROUTE_TO_PULSE / ROUTE_TO_ATLAS | Same category as UOA/sweeps. |
| Volume/OI | RETAIN (as a liquidity floor, not a directional signal) | THETA already uses volume/OI as a hard liquidity gate (`OPEN_INTEREST_INSUFFICIENT`/`VOLUME_INSUFFICIENT` in `theta_q_baseline.py`) — this is the one category with a direct, already-implemented THETA analogue, but repurposed for liquidity screening, not flow-following. |
| Premium thresholds | TEST | A minimum-premium floor (avoid trading contracts too cheap to be worth transaction cost) is a plausible THETA sizing/eligibility refinement, not yet in `SizingPolicy`/hard-veto set — worth registering as a hypothesis, not adopting from the legacy bot's specific number. |
| Moneyness | RETAIN (concept), CORRECT (mechanism) | THETA already screens moneyness via `log_moneyness`/`theta_q_lattice.py`'s delta bands — the *concept* transfers; a flow bot's moneyness filter (typically favoring far-OTM cheap lottery-ticket structures) is the opposite selection direction from THETA's premium-selling ATM/near-strike focus, so the specific mechanism does not transfer as-is. |
| Spread filters | RETAIN | Wide-spread exclusion is a liquidity-quality concept independent of strategy direction — THETA already has this (`SPREAD_TOO_WIDE`/`SPREAD_UNKNOWN`). |
| Session window | TEST | Whether THETA should restrict entries to a specific intraday window (vs. its current day-level decision cadence) is untested — likely low-value for a 30-60 DTE strategy, more relevant to PULSE's 0DTE cadence; registered as TEST rather than assumed irrelevant. |
| Cooldowns | TEST | A per-symbol or per-portfolio cooldown after a loss/rejection is a plausible overtrading guard (relates to `OpportunityCaptureRate`'s too-high-capture-rate warning) — not currently implemented in THETA, worth a hypothesis. |
| Historical win-rate gate | REJECT (as specified) | A gate that requires a symbol/setup to show a historical WR above some threshold before trading it again is exactly the kind of backward-looking, un-calibrated, Leg-WR-flavored heuristic THETA's whole metrics discipline exists to avoid (Leg WR alone proves nothing, H-H-02/H-A-03) — reject the *mechanism* as stated; a properly calibrated model-based version could be TEST, but that is a different thing from a raw win-rate gate. |
| Composite score | REJECT (as typically implemented), CORRECT (if decomposed) | A single blended score combining flow/liquidity/moneyness/etc. into one opaque number is exactly TRD CAND-003's "opaque scalar score alone is insufficient" anti-pattern, already rejected platform-wide (`UNSAFE_PATTERN_REGISTRY.md`'s "opaque uncalibrated scores" entry). The individual named components, reported separately and reason-coded (as `theta_q_baseline.py`/`ownership_v0.py` already do), are the corrected form. |
| Buying-power check | RETAIN (concept) | A hard check that available capital covers the position's requirement before sizing is a universal, uncontroversial safety requirement — analogous to THETA's own collateral/risk-budget caps in `AEGIS_SIZING_EXECUTION_CONTRACT.md` §3. |
| Limit order logic | RETAIN (concept), ROUTE_TO_CODEX (mechanism) | "Prefer limit orders over market orders" is a sound execution principle already stated in THETA's own execution contract (§4, "limit-order-first") — the actual order-placement mechanism belongs to Codex's execution engine (`app/src/execution/`), not the quant layer. |
| Fill reconciliation | RETAIN (concept), ROUTE_TO_CODEX (mechanism) | Confirming an order's actual fill state before trusting it as truth is the same discipline as THETA's "ambiguous-order reconciliation" rule (`AEGIS_SIZING_EXECUTION_CONTRACT.md` §4) — implementation is Codex-owned (`app/src/providers/alpaca/`, `app/src/lifecycle/`). |
| Partial fills | RETAIN (concept), ROUTE_TO_CODEX (mechanism) | Same reasoning — partial-fill handling is a broker-truth/execution-engine concern, already named as in-scope for Codex's Phase 1 exit gate (`docs/PHASED_PLAN.md`: "partial-fill... fixtures"). |
| TP/SL | CORRECT | The legacy bot's fixed take-profit/stop-loss mechanism is treated as exactly what this Phase 5 task calls it: a BASELINE to beat, not a design to retain — see `../phase2/BENCHMARK_AND_EXPERIMENT_REGISTRY.md`'s existing `B3`/`BR-2` fixed-capture benchmarks and Section 2 below. |
| Session-end flatten | TEST (relevance to THETA is doubtful) | Forcing all positions closed by session end is a 0DTE/intraday risk-management pattern (PULSE-relevant); THETA's multi-day-to-multi-week holding periods make an intraday flatten rule largely inapplicable — registered as TEST rather than assumed irrelevant, since a *portfolio-level* end-of-day risk check is a different, more general concept that could still matter. |
| Mirrored accounts | ROUTE_TO_ATLAS / ROUTE_TO_PULSE (out of scope for THETA v1) | This is a copy-trading concept — THETA v1 has no copy-trading surface (`docs/IMPLEMENTATION_AUDIT.md`'s scope clarification); the copy-trading failure-DNA catalog (F21-F24 in `../phase3_strategy_dna/FAILURE_DNA.md`) already exists for whichever future bot eventually needs this. |
| Global-symbol closes | TEST | "Close all positions in symbol X across every account/strategy on some trigger" is a portfolio-level risk primitive with a plausible THETA analogue (a severe-drawdown or thesis-invalidation trigger forcing an exit across every open position in that name) — worth a hypothesis, not a direct adoption. |
| Follower sizing | ROUTE_TO_ATLAS / ROUTE_TO_PULSE (out of scope for THETA v1) | Copy-trading concept, same disposition as mirrored accounts. |
| Secret storage | RETAIN (concept), ROUTE_TO_CODEX (mechanism) | Never storing credentials in code/logs, using a secrets manager or env-injected references, is a universal security requirement already stated in `CLAUDE.md`'s working agreements ("never commit `.env`... treat secret exposure as compromised") — mechanism belongs to Codex's `app/src/security/`/`app/src/config/`. |

## 2. Section B/G — TP/SL failure analysis overview

The legacy bot's fixed premium stop/target is treated exactly as this task's own
framing requires: **a benchmark policy, never a design.** THETA's existing benchmark
registry already contains the general form of this baseline — `B3` (fixed 25/50/75%
profit-take) and `BR-2` (fixed 50% specifically) for profit-taking, and the general
"fixed premium stop" is a new benchmark this pass registers explicitly (below) since
`benchmarks.json` did not previously name a stop-loss-specific ID (only profit-take and
hold-to-expiry extremes were registered — a gap already flagged in
`../PHASE2_4_CORRECTION_AUDIT.md` finding 5, extended here).

**Proposed new benchmark (not yet added to `benchmarks.json` — a recommendation for a
future session, per the "one source of truth, update deliberately" discipline):**
`BR-4` — "Fixed premium stop-loss," e.g. close if the option's price reaches some fixed
multiple of entry credit, regardless of DTE/moneyness/regime/ownership state. This is
the direct counterfactual the full management-hypothesis library in
`MANAGEMENT_HYPOTHESIS_LIBRARY.md` is designed to beat.

**Why a fixed TP/SL is expected to be structurally inadequate for THETA specifically**
(not asserted as fact — this is the hypothesis the empirical registry exists to test):
a fixed percentage stop ignores DTE (a 20% stop at 45 DTE and at 3 DTE represent very
different fractions of remaining extrinsic value), ignores whether the underlying
remains ownership-acceptable (a stop that fires on an acceptable name discards
optionality H-A-01 says is worth keeping), and ignores regime (the same stop threshold
plausibly should behave differently in a CRISIS stress state than in NORMAL). None of
this is a claim that a fixed TP/SL never works — it may turn out to be competitive in
some cohort — which is exactly why Section G's discipline (never tune to manufacture
70-80%; report the honestly-better cohort even if its WR is lower) applies here as much
as anywhere else in this repository.

## 3. Section H — Flow-logic routing (restated, generalized)

Per `../phase3_strategy_dna/FUTURE_BOT_ROUTING.md`'s existing discipline: flow/UOA/sweep
signals are **directional-conviction signals about what a third party is doing**, not
ownership-quality or premium-selling-thesis signals. They route primarily to PULSE
(intraday/0DTE cadence, where flow timing matters most) and ATLAS (directional swing,
where a large directional bet is itself an entry signal). **Flow must remain
contextual and never deterministic order truth** for THETA specifically — if a future
THETA refinement ever wants to use flow data at all, it could only ever be an
*additional soft context feature* (analogous to `flow_net_premium`/`uoa_score`, already
registered in `feature_families.json` as `treatment: "soft only"`), never a gate, never
a substitute for the ownership/severe-drawdown screen that is THETA's actual entry
discipline.

## 4. Section M — Risks and open questions (platform-level, this pass)

- **The legacy bot file gap (Section 0) is the primary open item** — every Section A
  finding above is a category-level judgment, not a verified code audit, and should be
  redone properly once the actual source is available.
- **Whether a competing-risk/hazard model (Section D) is the right formalism** for
  THETA's multi-way HOLD/CLOSE/ROLL/ASSIGN/EXPIRE decision, versus a simpler per-action
  multinomial classifier, is itself an open modeling-choice question — both are
  registered as candidate baselines in `MANAGEMENT_MODEL_SPECIFICATION.md`, neither is
  asserted correct.
- **Every empirical item in this Phase 5 package remains `BLOCKED_BY_DATA`** — no
  backtester exists (Phase 6 gate, unchanged since the Phase 2-4 pass).
- No new risk to THETA's frozen architecture, provider ownership, or financial
  invariants was introduced or proposed by this pass.
