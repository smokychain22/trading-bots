# THETA Phase 4 — AEGIS + Sizing + Portfolio/Capital Brain

Profitability Brain Completion Program, Phase 4. All citations at
`claude/theta-unified-takeover`. Read-only for Codex-owned files; nothing in
`bots/theta/app/`, `src/execution/`, `aegis*`, `sizing*`, or the canonical
frontier/decision-authority files was modified.

## 4A — One sizer: real finding, not a defect

`theta_q_baseline.py:_quantity()` (line 304) and `theta_h_baseline.py`'s own
`_quantity()` (line 176) each compute an internal `min()` over a **narrower**
cap subset (risk_budget/collateral/concentration/broker_allowed — 3-4 caps)
than `sizing.py:compute_sizing()`'s canonical 9-cap set. At first read this
looks like a duplicate sizing authority. It is not: `new-risk-orchestrator.ts`'s
own pipeline comment (line 30) states the real stage order explicitly —
`... THETA-Q CANDIDATE LATTICE -> PARETO FRONTIER -> AEGIS -> OPPORTUNITY
FRONTIER -> SIZING -> EXECUTION QUALITY ...` — SIZING is a distinct, later
stage. `theta_q_baseline.py._quantity()`'s result feeds only that module's
own internal candidate-economics/ranking output; the broker-facing quantity
in the final receipt is `sizingResult.data.quantity` from
`sizing-contract.ts`/`sizing.py.compute_sizing()` (confirmed:
`new-risk-orchestrator.ts:197-198`, `quantityReason` cites
`selected.sizing.quantity`/`selected.sizing.bindingConstraint` directly, and
line 921's `Q_ZERO` classification reads `sizingResult.data.quantity`).

**Classification: KEEP both, not a duplicate authority — but flag the
naming collision.** A method literally named `_quantity()` inside the Q
baseline returning a *different* number than the system's actual final
quantity is exactly the kind of confusing semantics Phase 1's hygiene rules
target. Not renamed (Codex-owned Python file); documented here so a future
reader doesn't conflate the two.

## 4B — Binding constraint persistence

Confirmed real and complete per Command 1's earlier audit:
`trade.canonical_strategy_candidate_evidence` persists `bindingConstraint`,
`sizingReasons`, `quantity` per candidate (not just the winner).

## 4C — Capital state distinctions

`src/theta/account-exposure.ts`'s `deriveAccountExposure` is confirmed (via
`portfolio-capital-analytics.ts`'s own docstring, line 6-9) as the canonical
single-snapshot collateral/exposure/concentration authority. The research
layer (`portfolio-capital-analytics.ts`) assigns every position to exactly
one of `PUT_COLLATERAL | ASSIGNMENT_RESERVED_CAPITAL |
DEFINED_RISK_MAX_LOSS_CAPITAL | STOCK_INVENTORY_CAPITAL |
PENDING_ORDER_RESERVE | OTHER_KNOWN_COMMITMENT` — mutually exclusive, so
summed totals never double-count (explicit design note: covered stock is
always `STOCK_INVENTORY_CAPITAL` regardless of CC-coverage state, never a
second dollar commitment). This is a real, already-built answer to 4C's
concern — no new code needed.

## 4D-4G — re-confirmed from prior-session audits, no new gap found

AEGIS's 12-family worst-wins fold, exit supremacy, `_threshold_assessment()`
soft/hard-cap mechanics, and per-family reason-code structure were already
directly verified against source in Commands 1 and 5C-7 of this session.
Re-reading confirms no drift. `THETA-AEGIS-COMPOUND-STRESS-UNVERSIONED`
remains the one real, already-filed gap (the `stress_count >= 2` literal is
still unregistered).

## 4H — Account drawdown framework: genuinely absent, built as a research contract

Searched `src/`, `bots/theta/quant/` for any `NORMAL/CAUTION/DEFENSIVE/
PAUSE_NEW_RISK`-shaped account-level regime state — none exists. Built
`src/research/account-drawdown-regime-research.ts` — explicitly
`brokerAuthority: false`, never consumed by any runtime path, every
threshold in `AccountDrawdownRegimeThresholdPolicy` documented as an
unvalidated research candidate (per the program's own instruction: research
thresholds, don't invent Production ones). `UNKNOWN` drawdown is never
defaulted to `NORMAL` (adversarial test proves this). 5 new tests, all
passing.

## 4I — No-martingale tests: genuinely missing, now added

`bots/theta/tests/quant/` had zero tests with "martingale"/"streak"/"revenge"
in scope before this pass (confirmed via grep). Added
`test_sizing_no_martingale.py` (5 tests): structurally proves
`SizingPolicy`/`SizingInputs` carry no loss-history-shaped field at all (not
just "no test exercises it" — the dataclass fields themselves contain no
such field), proves quantity is deterministic across repeated calls, proves
a tighter cap can only reduce-or-hold quantity (monotonicity), and
re-confirms `quantity=0` is reachable and never floored to 1. Does not
modify `sizing.py` itself.

## Verification

`tsc` clean. Node full suite + Python full suite run separately (see commit).
