# THETA Method Extraction Registry

Durability artifact. Registers the architectural patterns/methods worth preserving as
research ideas for THETA's design, generalized from patterns rather than attributed to
specific unverified repositories (see `GITHUB_METHOD_CORPUS.md`'s provenance note).
Each entry states the pattern, why it's relevant to THETA, and its current maturity in
this repository.

| Pattern | Description | Relevance to THETA | Maturity in this repo |
|---|---|---|---|
| Alpaca lifecycle/reconciliation failure modes | Broker lifecycle events (assignment, expiry, exercise, partial fill, corporate actions) must be reconciled against activities/positions before new risk is allowed, not assumed from the order state alone | Directly matches TRD LIFE-001/CA-001..005 and `docs/PHASED_PLAN.md` Phase 1's "reconciliation-before-autonomy" gate | SPECIFIED at the TRD level; Codex-owned implementation, not yet built |
| Preflight veto pipeline | A staged sequence of hard vetoes evaluated before any soft scoring, each with its own reason code, short-circuiting before economics are even computed | Exactly the structure of `theta_q_baseline.py::_hard_veto_reasons` / `theta_h_baseline.py`'s equivalent | IMPLEMENTED |
| Deterministic replay | A frozen historical decision can be replayed byte-for-byte using pinned versions, without re-fetching mutable live state | TRD DATA-003; `DATASET_AND_LABEL_CONTRACT.md` §1's version-pinning requirement | SPECIFIED |
| VRP mechanism (volatility risk premium) | The structural reason premium-selling can have positive expectancy — implied vol tends to exceed subsequently realized vol on average, though not reliably in every regime | Underpins the entire THETA-Q/H premium-selling thesis; also the reason H-Q-02 explicitly rejects "high IV alone is sufficient" — VRP existing on average does not mean every high-IV instance is a mispriced opportunity | Conceptual grounding for `vrp_proxy` feature family in `feature_families.json`; no fitted VRP model exists |
| Target-DTE fetching | Querying the option chain for contracts nearest a target DTE rather than a fixed calendar expiration, so the DTE window stays consistent as time passes | Matches `LatticeConfig`'s DTE-window enforcement in `theta_q_lattice.py` | IMPLEMENTED |
| Schema-first features | Defining the feature contract (names, types, provenance, freshness requirement) before writing any model, so every feature is traceable to a `feature_definition` | Matches FEAT-001 and `feature_families.json`'s own structure | IMPLEMENTED (as data) |
| Kill switch / ARM gate / exit supremacy | A global disable switch that blocks new risk-taking instantly, an explicit "arm" step required before autonomous action, and a rule that exit/risk-reduction logic can never be blocked by the same gate that blocks new entries | Matches AEGIS's `HOLD_ONLY`/`HARD_VETO` states in `AEGIS_SIZING_EXECUTION_CONTRACT.md` — exit supremacy specifically means a `HARD_VETO` state must still allow closing/reducing existing risk, not just block new entries | SPECIFIED; not yet distinguished explicitly in this repo's AEGIS contract — flagged as a refinement in `PHASE2_4_CORRECTION_AUDIT.md` |
| Future-poison leak testing | An automated test that deliberately injects a future/forward-looking value into a feature pipeline and asserts the model detects or is unaffected by it, rather than relying only on code review to catch leakage | Directly applicable to `severe_drawdown_spec.py`'s leakage guard (already has a positive test — `test_leakage_guard_ignores_points_beyond_dataset_cutoff`) | Partially IMPLEMENTED (one model); not yet a repo-wide testing pattern |
| Honest failed-baseline retention | Keeping a record of every baseline/challenger that was tried and rejected, not just the winner, specifically to support selection-bias correction (DSR/PBO) later | Matches `experiments.json`'s design (every experiment retained regardless of outcome, once run) | IMPLEMENTED (as a registry design; no experiment has been run yet to actually retain) |
| Hash-pinned provenance | Every data snapshot referenced by a decision carries a content hash or equivalent identity, so a replay can verify it reconstructed from the exact same inputs | Matches `DATASET_AND_LABEL_CONTRACT.md` §1's provenance-chain requirement | SPECIFIED |
| Conservative fill models | Backtested fills assume worse-than-midpoint execution, calibrated against realistic spread/slippage, never an optimistic assumption | Matches the execution/fill model entry in `MODEL_REGISTRY.md` and the charter's midpoint-fill prohibition | SPECIFIED; no fill model implemented |
| Quote-aware replay | A backtest replays using the actual quote sequence available at each historical timestamp, not a single end-of-day close price standing in for intraday conditions | Relevant to `theta_h_baseline.py`'s gap-risk diagnostics specifically (2-5 DTE is exactly where close-to-close bars understate real gap risk, per H-H-01's `failure_mode`) | SPECIFIED (named as a requirement in H-H-01); no quote-aware backtester exists |
| Composable risk checks | Independent risk-family checks combined by taking the strictest applicable state, never fused into one blended score | Matches `AEGIS_SIZING_EXECUTION_CONTRACT.md` §5 | SPECIFIED |
| Probabilistic/soft regime modeling | Representing regime as continuous probabilities across states rather than a single hard classification | Named as a future challenger to `regime_v0.py` in `MODEL_REGISTRY.md`'s regime-model entry | Not implemented; `regime_v0.py` is hard-classification only |

## Status

Every pattern above is either already reflected in this repository's implemented code
(marked IMPLEMENTED) or registered as a SPECIFIED future direction. None is presented
as having been copied from a specific third-party repository — per the central rule in
`GITHUB_METHOD_CORPUS.md`, these are method descriptions, not attributed code.
