# THETA Strategy DNA — Component Library

Durability artifact. Normalizes the DNA modules the Phase 3 research programme
organizes expert evidence and hypotheses around. This is a **classification
vocabulary**, not new evidence — each module below is populated only with references
to hypotheses/experts/models that already exist in this repository's committed
registries, per the "single source of truth per concept" rule (Part H of this
durabilization instruction).

| DNA module | What it covers | Populated by (existing registry entries) | Maturity |
|---|---|---|---|
| SELECTIVITY | How pickily a policy screens candidates before considering entry at all | H-Q-01/H-Q-02 (ownership/severe-drawdown screening vs. premium-blind selection) | TEST |
| OWNERSHIP | Whether the underlying is acceptable to own under the strike, independent of entry mechanics | THETA-Q archetype in full; `ownership_v0.py` | v0 IMPLEMENTED, formula TEST |
| ENTRY | DTE/delta/structure selection at entry | `theta_q_baseline.py`, `theta_q_lattice.py`, `theta_h_baseline.py` | IMPLEMENTED (transparent baselines) |
| VOLATILITY | IV rank/percentile, term structure, skew as entry/management context | `feature_families.json` volatility family; explicitly never a standalone gate (UNIV-002, H-Q-02) | Feature-level IMPLEMENTED, model-level SPECIFIED |
| SESSION | Intraday timing of entry/management actions | Not modeled in this repository — THETA operates on a daily/multi-day decision cadence per the TRD lifecycle; session-level timing is out of scope for THETA and belongs to PULSE (0DTE/intraday), per `FUTURE_BOT_ROUTING.md` | Out of scope for THETA |
| DTE | Days-to-expiration regime selection (30-60 DTE conventional vs. 2-5 DTE Hold-the-Strike) | THETA-Q vs. THETA-H archetype split; `LatticeConfig`'s DTE window enforcement | IMPLEMENTED |
| MONEYNESS | Strike selection relative to spot (delta bands, ATM/near-ATM) | `theta_q_lattice.py`'s multi-band grid; `theta_h_baseline.py`'s ATM/near-ATM diagnostics | IMPLEMENTED |
| PROFIT CAPTURE | Early-close vs. hold-to-expiry management timing | H-R-01/H-R-02 (contradictory pair) | TEST |
| LOSS MANAGEMENT | How a losing short position is handled before resolution | Folds into H-R-01/H-R-02/H-R-03 — this repo does not register a separate stop-loss-style DNA module distinct from the roll/close/hold comparison, since a fixed stop-loss threshold would itself need to clear the same alternatives-comparison bar H-R-03 requires | TEST (via H-R-03) |
| ROLL | Whether/when to roll rather than close/hold/assign | H-R-03 (RETAIN, alternatives-comparison requirement); `RollUtility`/`NetRollCredit` | RETAIN (architecture) / SPECIFIED (formula, no evaluator) |
| ASSIGNMENT | Whether assignment is accepted vs. mechanically avoided | H-A-01 (RETAIN) | RETAIN (architecture), BLOCKED_BY_DATA (fitted probability) |
| RECOVERY | Post-assignment wait-vs-exit discipline | H-A-02 (RETAIN, bound-must-exist), H-A-04 (TEST, which bound) | RETAIN + TEST split; spec IMPLEMENTED (`recovery_spec.py`), fitted curve BLOCKED_BY_DATA |
| COVERED CALL | Post-assignment monetization strategy | H-C-01, H-C-02 (both RETAIN) | RETAIN (architecture), SPECIFIED (ranker not built) |
| POSITION SIZING | Quantity determination given caps and ownership/risk state | `AEGIS_SIZING_EXECUTION_CONTRACT.md` §3; `SizingPolicy` in `theta_q_baseline.py`/`theta_h_baseline.py` | IMPLEMENTED (hard-cap sizing); confidence-weighted sizing SPECIFIED |
| REGIME | Trend/Volatility/Event/Liquidity/Stress conditioning | `regime_v0.py` | IMPLEMENTED (v0, hard classification) |
| WAIT | The explicit no-action outcome, always retained as a valid candidate | `CandidateAction.WAIT`; `WAIT_MARKER` in `theta_q_lattice.py` | IMPLEMENTED |
| EXECUTION | Fill/slippage realism at order time | `AEGIS_SIZING_EXECUTION_CONTRACT.md` §4 | SPECIFIED |
| TAIL RISK | Severe-drawdown and gap exposure | `severe_drawdown_spec.py`; `theta_h_baseline.py`'s gamma/overnight-gap diagnostics | Spec IMPLEMENTED, fitted model BLOCKED_BY_DATA |

## Discipline

**Expert evidence generates hypotheses only.** No DNA module above is populated with a
number, threshold, or claim that did not already exist in a committed registry before
this file was written. **Expert consensus may never override negative OOS EV** — this
is a standing rule restated here because the component-library framing (grouping
multiple experts' priors into one module) creates exactly the kind of surface where an
apparent consensus across experts could be mistaken for validated evidence; it is not,
regardless of how many `D_EXPERT_DNA` sources agree.

## Status

Classification/organizational artifact only — SPECIFIED as a taxonomy, IMPLEMENTED
insofar as it points at already-IMPLEMENTED registries and code.
