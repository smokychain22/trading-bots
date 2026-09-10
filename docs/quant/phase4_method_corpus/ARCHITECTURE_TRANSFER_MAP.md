# THETA Architecture Transfer Map

Durability artifact. Maps each preserved method pattern in `METHOD_EXTRACTION_REGISTRY.md`
to the specific THETA subsystem it would inform if/when implemented, so a future
implementer has a concrete landing spot rather than a generic "this seems useful"
association.

| Pattern | Target subsystem | Landing spot |
|---|---|---|
| Alpaca lifecycle/reconciliation failure modes | Broker integration | Codex `bots/theta/app/src/providers/alpaca/` + `app/src/lifecycle/` (per `docs/OWNERSHIP.md`) |
| Preflight veto pipeline | Every entry/management decision point | Already the shape of `theta_q_baseline.py`/`theta_h_baseline.py`; the pattern to preserve when the CC ranker and roll evaluator are eventually built (`MODEL_REGISTRY.md`) |
| Deterministic replay | Immutable decision truth | Codex's `FusionSnapshot`/decision-record layer (`docs/PHASED_PLAN.md` Phase 3); Claude's `DATASET_AND_LABEL_CONTRACT.md` §1 version-pinning contract |
| VRP mechanism | THETA-Q entry rationale | Conceptual grounding only — feeds the *rationale* for `ownership_acceptability`/`p_severe_drawdown` screening in `theta_q_baseline.py`, not a separate module |
| Target-DTE fetching | Contract selection | `theta_q_lattice.py`'s DTE-window grid construction |
| Schema-first features | Feature engineering | `research/data/feature_families.json`; any future feature added to this repo should follow the same schema-first discipline |
| Kill switch / ARM gate / exit supremacy | AEGIS | `AEGIS_SIZING_EXECUTION_CONTRACT.md` — exit-supremacy refinement flagged as a gap in `PHASE2_4_CORRECTION_AUDIT.md` |
| Future-poison leak testing | Test suite discipline | `bots/theta/tests/quant/` — extend the pattern already used in `test_severe_drawdown_and_recovery_specs.py`'s leakage guard test to every future label/model |
| Honest failed-baseline retention | Experiment registry | `research/data/experiments.json` — already designed for this; needs to actually be exercised once experiments run |
| Hash-pinned provenance | Immutable decision truth | Same landing spot as deterministic replay |
| Conservative fill models | Backtester (not yet built) | `MODEL_REGISTRY.md`'s execution/fill model entry |
| Quote-aware replay | Backtester (not yet built) | Same, specifically informing THETA-H's gap-risk validation (H-H-01) |
| Composable risk checks | AEGIS | `AEGIS_SIZING_EXECUTION_CONTRACT.md` §2/§5 |
| Probabilistic/soft regime modeling | Regime model | `regime_v0.py`'s future challenger, per `MODEL_REGISTRY.md` |

## Discipline

This map records *where a pattern would go*, not a commitment to build it now. Building
ahead of the current phase in `docs/PHASED_PLAN.md` is prohibited by `CLAUDE.md`'s
working agreements regardless of how well-motivated a pattern looks in isolation.

## Status

Cross-reference only.
