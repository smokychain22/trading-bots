# Future Bot Routing — Non-THETA Evidence Disposition

Durability artifact. THETA is the only bot in scope for v1 (`CLAUDE.md`) — PULSE,
NEXUS, VEGA, EVENT, and ATLAS are named in the canonical documents but explicitly out
of scope; no code should be scaffolded for them. This file exists solely so that when
expert evidence or a GitHub-corpus method finding describes behavior that is
profitable-sounding but structurally not a THETA pattern (e.g. intraday 0DTE timing, a
purely directional swing thesis, a vol-relative-value trade with no premium-selling
Wheel structure), it is routed to a label rather than either (a) silently discarded, or
(b) incorrectly forced into a THETA hypothesis where it doesn't belong.

## Routing table

| Non-THETA pattern | Routes to | Why it does not belong in THETA |
|---|---|---|
| Directional swing thesis (multi-day/week directional conviction trades, not premium-selling) | ATLAS | THETA is an assignment-aware premium-selling Wheel bot; a directional swing thesis has a different risk/reward shape and a different exit discipline entirely. |
| Neutral/range premium selling outside the Wheel structure (e.g. iron condors/butterflies without an assignment-acceptance path) | NEXUS | THETA's lifecycle assumes CSP→assignment→stock→CC is an acceptable full chain; a neutral structure with no assignment path is a different strategy family. |
| Volatility relative-value (e.g. trading the vol surface itself — skew, term structure — rather than selling premium against an ownership thesis) | VEGA | THETA's ownership model requires being willing to actually hold the underlying; a pure vol-RV trade has no such requirement and may have no underlying-ownership component at all. |
| Catalyst/event repricing (trading a specific scheduled or anticipated event's expected move) | EVENT | THETA explicitly treats near-term earnings as a hard-veto exclusion in its baseline (`EARNINGS_TOO_NEAR` in `theta_q_baseline.py`) — a strategy that specifically trades into that exclusion window is a distinct archetype, not a THETA variant. |
| Intraday/0DTE timing | PULSE | THETA's DTE windows (30-60 conventional, 2-5 for the Hold-the-Strike challenger) are both materially longer than 0DTE; intraday session-level timing (see `COMPONENT_LIBRARY.md`'s SESSION row) is out of scope for THETA's decision cadence entirely. |

## Discipline

**Do not contaminate THETA with unrelated profitable-sounding behavior.** An expert
whose `borrowed_prior` mixes a THETA-relevant Wheel/premium-selling pattern with an
unrelated directional or event-driven pattern should have only the THETA-relevant
portion cataloged in `EXPERT_REGISTRY.md`/`STRATEGY_DNA_MATRIX.md` — the rest is routed
here, not merged into a THETA hypothesis just because it came from the same source.
None of the 11 experts currently in `expert_sources.json` have been identified as
needing this split; this file exists for the discipline to be visible before it is
needed, and for any future non-THETA finding (from a later GitHub-corpus study or a new
expert source) to have an explicit landing place.

## Status

Routing policy only — no bot beyond THETA is scaffolded, specified in code, or
implemented as a result of this file. Every routing target (PULSE/NEXUS/VEGA/EVENT/
ATLAS) remains a name only, per `CLAUDE.md`'s explicit scope boundary.
