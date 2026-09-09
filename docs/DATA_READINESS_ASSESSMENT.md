# Data & Feature Readiness Under PAPER-Only Alpaca

Owner: Claude (quant research + validation lead). Written in response to the user's
note that Alpaca is currently PAPER only, and no credentials were read, requested, or
touched to produce this — everything here comes from re-reading the TRD's own
provider-entitlement sections against what "PAPER only" does and doesn't tell us.

**Status: no Codex provider-capability check output exists in this repo yet** (checked
`git log`, the full working tree, and `origin/main` — nothing beyond this repo's own
docs commits). Section 4 is the checklist I'll apply the moment it lands; nothing
below depends on it existing yet.

## 1. What "PAPER only" actually tells us — and what it doesn't

TRD §8.2 separates two independent axes that are easy to conflate:

| Axis | What it governs | What we know |
|---|---|---|
| **Trading environment** | paper vs. live order execution, separate credentials/base URL (`paper-api.alpaca.markets` vs `api.alpaca.markets`) | **Known: PAPER.** No live orders are possible or intended right now regardless of anything else. |
| **Market-data entitlement tier** | Basic/indicative (delayed trades, modified quotes, `LIVE_AUTOTRADE = disabled` per TRD's own table) vs. OPRA + appropriate stock feed (execution-grade) | **Unknown.** A paper *trading* account can be paired with either data tier — they're separate subscriptions on Alpaca's side. This is exactly what a provider-capability check has to determine; it cannot be inferred from "the account is paper." |

So "PAPER only" confirms no live trading risk exists (consistent with this repo's
Phase 0/1 status regardless), but it does **not** by itself tell us whether BBO-driven
quant work (fill-probability modeling, adverse-selection features, execution research)
can eventually be validated against real quote quality, or is stuck on indicative data
until the account's data plan is upgraded. That answer has to come from Codex's
capability check, not from this note.

## 2. Feature-family readiness matrix (from TRD §13 / Appendix H)

Most of THETA's quant surface does **not** depend on Alpaca's market-data tier at all,
because Optionomics is a separate provider with its own entitlement, and because
backtesting research uses *historical* data (which both providers expose regardless of
live-quote tier), not live BBO. Breaking §13's feature families down:

| Feature family | Source | Usable now, independent of Alpaca's data tier? |
|---|---|---|
| Volatility (IV, RV, VRP proxy, skew/term/surface curvature) | Optionomics | **Yes.** Optionomics entitlement is separate from Alpaca's; gated only by the Optionomics API key/plan, not by Alpaca's trading account. |
| Flow/context (UOA, net premium) | Optionomics | **Yes**, same reasoning — and it's explicitly context-only, never execution truth, so tier doesn't matter for its intended use. |
| Events (earnings distance, corporate actions) | Optionomics + Alpaca corporate-actions REST | **Yes.** Corporate actions REST isn't gated by the options market-data tier. |
| Underlying (returns, trend, RV, drawdown, gap risk) | Alpaca stock bars | **Likely yes for research**, with a caveat: Alpaca's *stock* feed (SIP/IEX) is entitled separately from the *options* OPRA feed. Historical bars are commonly available even on lower tiers; Codex's check needs to confirm which stock feed this account actually gets. |
| Contract/Greeks (delta, gamma, theta, vega, IV, moneyness) | Alpaca chain snapshot, cross-checked via QuantLib | **Yes for historical/research use**, uncertain for anything claiming execution-grade precision — Alpaca's own docs distinguish "Basic" Greeks/IV snapshot quality from OPRA-backed pricing. |
| Execution (quote age, spread%, fill probability, adverse selection) | Alpaca live/paper BBO | **Blocked for anything claiming production-grade accuracy** until the data tier is confirmed. This is exactly what FILL-001 already anticipates: "until sufficient data exists, use a conservative versioned heuristic" — so this isn't a blocker for *building* the fill-probability model's structure, only for trusting its output as execution-realistic before paper/live TCA data accumulates. |
| Expert priors, regime | Offline corpus / derived | **Yes, fully independent of any provider.** |

**Conclusion: the PAPER-only status does not block quant/research work.** It mainly
affects how much confidence to put in anything that models *execution quality*
specifically (fill probability, adverse selection, spread capture) until Codex's
capability check confirms the actual data tier — and even then, TRD's own discipline
(VAL-001, FILL-002) already requires treating historical fills as uncertain/
conservative rather than assumed, so this isn't a new gap so much as a confirmation of
a rule the spec already enforces.

## 3. What this means for current-phase quant work

Per `docs/PHASED_PLAN.md`, Phase 6 (research/shadow validation) is Claude-led but
comes after Phases 1–5 (broker truth, Optionomics contracts, FusionSnapshot, THETA
mechanics, AEGIS/execution) — so no model code should be written yet, and none is
being written here. What *is* legitimately independent-of-secrets, phase-appropriate
research work right now:

- Keep the Expert Strategy DNA evidence register (TRD §14/§53, already captured in
  `docs/QUANT_IMPLEMENTATION_MAP.md` §2) current and ready to formalize into
  `research.expert_source`/`expert_profile`/`expert_observation` rows the moment
  Phase 2's schema exists — this needs no live data at all.
- Keep refining the benchmark/ablation matrix (§49, already in
  `docs/QUANT_IMPLEMENTATION_MAP.md` §5) — it's a design artifact, not code.
- Track exactly which capability answers are still open (§4 below) so review is fast
  once they land, instead of re-deriving the checklist at that point.

## 4. Review checklist for Codex's provider-capability results (apply when available)

Maps to Backend Schema `core.provider_capability` (`provider_connection_id,
capability_code, entitlement, status, checked_at, details_json`) and TRD Appendix J
("Provider Contract Verification Checklist"):

- [ ] **Alpaca `ACCOUNT_ENVIRONMENT`**: confirms `paper`, matches what the user told us — sanity check, not new information.
- [ ] **Alpaca `OPTIONS_TRADING_LEVEL`**: what level is actually approved on this paper account (Level 1/2/3)? Determines which strategy branches (THETA_DEFINED_RISK needs spreads) are even mechanically reachable.
- [ ] **Alpaca `MARKET_DATA_FEED` (options)**: Basic/indicative vs. OPRA. This is the single most consequential unknown from §1 above.
- [ ] **Alpaca `MARKET_DATA_FEED` (stock)**: which feed (SIP/IEX/other) — affects underlying-side feature confidence independent of the options answer.
- [ ] **Optionomics capability/rate-limit status**: confirms the 1,000 req/min shared allowance (TRD §9) and which feature families (`opt.get_symbol_analytics`, `opt.get_flow`, `opt.get_events`, `opt.get_history`) actually resolve against the live API Reference — per OPT-001, no adapter should bind to a guessed path, so this check is what turns "TRD's illustrative alias names" into a real, versioned `provider_operation_registry` row.
- [ ] **Null semantics**: does the capability check itself distinguish "not entitled" from "checked and unavailable" from "not yet checked" — these are three different `UNKNOWN`-adjacent states and matter for how downstream features get flagged (MKT-001).
- [ ] **Timestamps**: `checked_at` present and the check is re-runnable (entitlement can change), not a one-time assumption baked into config.

When this lands, I'll update this document's status line and fold the confirmed
entitlement tier into `docs/QUANT_IMPLEMENTATION_MAP.md`'s feature-family table so it
stops saying "likely" and "uncertain."
