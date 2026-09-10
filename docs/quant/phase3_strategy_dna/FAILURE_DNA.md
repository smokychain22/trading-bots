# THETA Failure DNA Catalog

Durability artifact. Persists the failure-mode catalog previously produced only as
conversational output. Each entry is a named failure pattern THETA's design must guard
against — cross-referenced to the specific architectural rule, hypothesis, or test
that already guards against it in this repository, where one exists. Entries with no
existing guard are marked explicitly as open gaps, not silently assumed covered.

| ID | Failure pattern | Mechanism | Existing guard in this repo | Status |
|---|---|---|---|---|
| F1 | High-WR / negative-skew | A policy shows an attractive win rate while the rare losses are large enough to make it EV-negative overall | `BreakEvenWR`/`EdgeBuffer` (`FORMULA_REGISTRY.md`); `PF_net` reported alongside WR always | Guarded (formula-level) |
| F2 | Closed-WR inventory mask | Leg/closed-trade WR excludes open unresolved inventory, hiding drawdown | H-H-02, H-A-03 (RETAIN); TRD OUT-001..004; `WholeChainPnL` | Guarded |
| F3 | Overtrading | Acting on marginal candidates that don't clear a genuine EV bar, eroding returns via costs | `OpportunityCaptureRate` diagnostic (flags both too-high and too-low capture rates) | Guarded (diagnostic only, no enforcement threshold registered) |
| F4 | Concentration / regime collapse | Excess exposure to one ticker/sector/regime that all fail together | AEGIS risk families §2 in `AEGIS_SIZING_EXECUTION_CONTRACT.md` (ticker/sector/portfolio) | SPECIFIED, not yet implemented in `bots/theta/quant/` |
| F5 | Convex premium burn | Repeatedly selling premium into a structurally worsening position, extending losses rather than cutting them | H-R-03's alternatives-comparison requirement (RETAIN) | Guarded (architecturally) |
| F6 | Short-vol tail risk | Underestimating the true tail of a short-premium book during a volatility spike | `severe_drawdown_spec.py`; THETA-A archetype's tail-quality component in `ownership_v0.py` | Spec IMPLEMENTED, fitted model BLOCKED_BY_DATA |
| F7 | Copy-execution failure | A follower's fills systematically differ from the source signal's assumed fills | Not modeled in this repo — THETA v1 has no copy-trading surface (`docs/IMPLEMENTATION_AUDIT.md`'s copy-trading scope clarification); see F21-F24 below for the fuller copy-trading-specific set, retained for future reference only | Out of scope for THETA v1 |
| F8 | Assignment capital trap | Capital locked in an underwater assigned position indefinitely, unable to redeploy | H-A-02 (RETAIN, bound-must-exist), H-A-04 (TEST, which bound) | Guarded (architecturally), sizing of the bound itself open |
| F9 | Roll-loss hiding | A rolled position's old realized loss is absorbed into the new trade's numbers, hiding the original loss | Charter non-negotiable rule: "a roll is close-old + open-new... immutable and cannot be absorbed"; `NetRollCredit` vs. `RollUtility` distinction | Guarded |
| F10 | Immediate-CC regret | Selling a covered call immediately post-assignment, capping upside before any recovery chance | H-C-02 (RETAIN) | Guarded |
| F11 | Small-N false confidence | Treating a thin sample as validated evidence | `shared_evidence_requirement` in `experiments.json`/`hypotheses.json` (raw N vs. independent-cluster N, 300+/500+ threshold) | Guarded |
| F12 | Leverage-amplified DD | Position sizing that scales exposure beyond what capital/risk caps actually support | `AEGIS_SIZING_EXECUTION_CONTRACT.md` §3 (`final_qty = min()` of every cap, never `max(1, qty)`) | Guarded |
| F13 | Event gap | An earnings/macro event gaps price through a strike overnight, defeating a model that assumed continuous pricing | `theta_h_baseline.py`'s overnight-gap diagnostics/hard veto; `earnings_distance_days` hard veto in `theta_q_baseline.py` | Guarded |
| F14 | Liquidity / spread failure | Wide spreads or stale quotes make the assumed entry/exit economics unrealistic | `SPREAD_TOO_WIDE`/`QUOTE_STALE`/`SPREAD_UNKNOWN` hard vetoes in `theta_q_baseline.py` | Guarded |
| F15 | Correlated-ticker cluster | Multiple "independent" positions that are actually one correlated bet | AEGIS sector/cluster risk family (`AEGIS_SIZING_EXECUTION_CONTRACT.md` §2) | SPECIFIED, not yet implemented |
| F16 | Model regime drift | A model calibrated in one regime silently degrades when the regime shifts | `regime_v0.py`'s 5-axis taxonomy; MODEL-003's per-cohort (not global) calibration monitoring requirement | Guarded (architecturally); drift-monitoring implementation not yet built |
| F17 | Provider-UNKNOWN-as-zero | A missing/stale provider field silently coerced to zero instead of flagged UNKNOWN | Enforced throughout every model in this repo (`Optional[...] = None`, never a numeric default); `OPT-002/003` | Guarded |
| F18 | Midpoint-fill illusion | Backtesting or evaluating economics as if every order fills at the quoted midpoint | `AEGIS_SIZING_EXECUTION_CONTRACT.md` §4 (conservative-fill requirement); charter non-negotiable rule | Guarded (as a rule); no fill model implemented yet |
| F19 | Lookahead / survivorship leakage | Using data unavailable at decision time, or a universe that silently excludes names that later became unacceptable | `DATASET_AND_LABEL_CONTRACT.md` §1/§3; `severe_drawdown_spec.py`'s implemented leakage guard | Guarded (spec + one implementation); universe-construction discipline SPECIFIED, not yet built |
| F20 | Engineering quality mistaken for strategy evidence | A well-engineered, well-tested repository is treated as evidence its strategy is profitable | `evidence_class_enum`'s explicit `E_ENGINEERING` tier, distinct from any evidence of actual edge; restated in `../phase4_method_corpus/UNSAFE_PATTERN_REGISTRY.md` | Guarded (taxonomy-level) |

## F21-F24: copy-trading-specific failure modes (registered for completeness, out of scope for THETA v1)

These four were named in this engagement's history as copy-trading-specific failure
modes. THETA v1 has no copy-trading surface (confirmed in
`docs/IMPLEMENTATION_AUDIT.md`'s scope clarification) — they are retained here only so
a future bot or a future THETA copy-trading feature does not have to rediscover them,
not because they apply to any current THETA archetype:

- **F21 — Copy-slippage accumulation:** `CopySlippage = FollowerFill -
  MasterComparableFill` compounding across many followers/trades until the copied
  strategy's realized economics diverge materially from the source's.
- **F22 — Copy-decay:** `CopyDecay(age)` — a followed signal's edge (if any) degrading
  as more of the market becomes aware of or reacts to the same signal source.
- **F23 — Join-existing-position mismatch:** a follower joining a position already
  open at the source (rather than only new entries), producing a different risk/reward
  profile than the source ever actually held — this is why "join existing positions"
  defaults OFF in any future copy-trading design.
- **F24 — Follower tracking error:** `FollowerTrackingError = FollowerEconomicPnL -
  ScaledMasterEconomicPnL`, i.e. the follower's realized outcome diverging from a
  naively scaled version of the source's outcome even before slippage/decay are
  isolated as specific causes.

## Status

Narrative/cross-reference artifact. F1-F20 reference existing repository rules,
hypotheses, or explicitly-flagged gaps; none introduce a new claim. F21-F24 are
recorded as out-of-scope reference material per the durabilization instruction's
routing rule (`FUTURE_BOT_ROUTING.md`), not as active THETA requirements.
