# THETA AEGIS Quant Contract — Risk, Sizing, Execution

Durability artifact (see `PHASE2_MASTER_SPEC.md`). AEGIS itself is Codex-owned
(`bots/theta/app/src/risk/` per `docs/OWNERSHIP.md`) — this file records the
**quant-side contract** AEGIS must be evaluable against: the risk-state vocabulary,
sizing invariants, and execution assumptions the quant models above depend on and that
Claude reviews Codex's AEGIS implementation against. It does not implement AEGIS.

## 1. Risk contract states

```
ALLOW_FULL | ALLOW_REDUCED | DEFINED_RISK_ONLY | HOLD_ONLY | HARD_VETO
```

Each state, plus a reason-code list (per `ReasonCode` in `models/common.py`), must
accompany every candidate evaluation and every management decision — a quant model
never overrides a `HARD_VETO` or a `HOLD_ONLY` state by producing a favorable score;
the risk gate is checked before, and independently of, any economic ranking (mirrors
`theta_q_baseline.py::evaluate`'s own structure: hard vetoes are checked first and
short-circuit before any ownership/economics scoring happens).

## 2. Risk families (evaluated independently, never merged into one score)

- **Per-trade:** the candidate-level hard vetoes already implemented in
  `theta_q_baseline.py`/`theta_h_baseline.py` (spread, quote freshness, open
  interest/volume, earnings proximity, contract standardness, non-zero broker-allowed
  quantity).
- **Ticker:** per-underlying exposure limits — not yet implemented in the quant layer;
  a live check against current portfolio state (§1 of `DATASET_AND_LABEL_CONTRACT.md`).
- **Sector/cluster:** correlated-ticker exposure aggregation — named in the
  cross-cutting failure-DNA catalog (`F14` correlated-ticker cluster, see
  `../phase3_strategy_dna/FAILURE_DNA.md`) as a failure mode to guard against; no
  implementation exists yet in this repo.
- **Portfolio:** aggregate capital-at-risk, aggregate collateral committed, portfolio
  drawdown state — feeds `portfolio_concentration` (already a registered feature
  family, `USABLE_NOW_BACKTEST_SIMULATED_BOOKKEEPING` in backtest context per
  `feature_families.json`).
- **Inventory:** open assigned-stock/CC/CSP inventory across the book — the same
  concern `WholeChainPnL`'s open-MTM component tracks per-position, aggregated to the
  book level here.
- **Execution:** spread/liquidity/quote-freshness conditions at the moment of intended
  order placement — distinct from the per-trade entry-time liquidity check, since
  conditions can change between candidate evaluation and actual order placement.
- **System/data quality:** provider degraded-mode state (Optionomics/Alpaca) — an
  `UNKNOWN` feature anywhere in a decision's required inputs should be capable of
  forcing at least `ALLOW_REDUCED` or stricter, never silently treated as neutral.
- **New, cross-bot exposure (unbuilt):** the multi-bot platform's future need to
  aggregate exposure across THETA and any sibling bot (PULSE/NEXUS/VEGA/EVENT/ATLAS)
  before any of those exist — flagged here as a known future requirement, not
  designed further since those bots are out of scope for v1 (`CLAUDE.md`).

## 3. Sizing contract

Field names as already implemented in `theta_q_baseline.py`/`theta_h_baseline.py` and
their tests:

```
raw_qty -> collateral_cap_qty -> risk_cap_qty -> concentration_cap_qty
        -> liquidity_cap_qty -> inventory_cap_qty -> final_qty
```

- **`final_qty = 0` is a legitimate, expected, and frequently correct sizing outcome**
  — never `max(1, qty)`. Enforced today by
  `test_quantity_zero_is_reachable_and_never_floored_to_one` and
  `test_below_floor_ownership_zeroes_quantity_without_hard_veto` in the existing test
  suite; this contract restates the rule so it is visible in the durability package,
  not only in test names.
- Every cap is a required, versioned input (`SizingPolicy` in `theta_q_baseline.py` has
  no defaulted threshold) — no cap value is hard-coded in this repo's models.
- The final quantity is `min()` of every applicable cap, never a weighted average or a
  softened combination that could produce a size larger than any single binding
  constraint allows.
- No martingale or loss-doubling sizing, under any circumstance, for any archetype —
  restated here as an explicit sizing-contract item, not left implicit.

## 4. Execution contract

- **Limit-order-first:** no assumption anywhere in this repo's models of a guaranteed
  or midpoint fill — `theta_q_baseline.py`'s hard veto on stale/unknown quotes exists
  precisely so a decision is never made against a fill assumption the market state
  can't actually support.
- **Idempotency:** every order intent must be deterministically identifiable (a
  Codex-owned execution-engine concern, per `docs/OWNERSHIP.md`'s `app/src/execution/`
  row) so a retried or duplicated submission cannot double an economic exposure the
  quant layer sized once.
- **Ambiguous-order reconciliation:** an order whose fill/rejection state cannot be
  confirmed must never be silently retried assuming failure or assuming success —
  `UNKNOWN != zero` applies here exactly as it does to any other missing field: an
  ambiguous order state blocks new risk-taking until reconciled, it does not default to
  either outcome.
- **Conservative fill modeling (backtest/research only):** any backtester built against
  this contract must use a conservative fill assumption (e.g. worse-of-bid/ask-adjusted
  by realistic slippage, informed by the execution/fill model in `MODEL_REGISTRY.md`
  once it exists) rather than assuming execution at the quoted mid or at the candidate's
  displayed premium — this is the single most common inflation source named in the
  Phase 4 method corpus's rejected-pattern list (see
  `../phase4_method_corpus/UNSAFE_PATTERN_REGISTRY.md`).

## 5. Composability

Per the Phase 4 method corpus's "preserve" list, risk checks are composable — each
family in §2 is evaluated independently and the resulting state is the **strictest**
one that applies (e.g. a portfolio-level `HOLD_ONLY` cannot be overridden by a
favorable per-trade check) — never a single fused risk score that could let a strong
per-trade signal compensate for a portfolio-level breach.

## 6. Status

Everything in this file is SPECIFIED. No AEGIS implementation exists in
`bots/theta/quant/` (correctly so — it is Codex's module per `docs/OWNERSHIP.md`); this
contract exists so that when Codex's AEGIS implementation lands, Claude's adversarial
review has a concrete, pre-registered checklist to review it against rather than
reconstructing these invariants from memory at review time.
