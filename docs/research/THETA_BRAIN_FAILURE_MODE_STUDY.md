# THETA brain failure-mode study, 2026-09-30

Scope: design patterns from primary sources. None of these projects is a THETA
runtime dependency or evidence of THETA profitability. The current Production
entry authority remains `buildCanonicalStrategyFrontier` and existing-position
authority remains `management-action-frontier.ts`. H and D are research-only.

| Source | Useful pattern | THETA application | Deliberately rejected |
| --- | --- | --- | --- |
| [Qlib workflow](https://github.com/microsoft/qlib/blob/main/docs/component/workflow.rst) | Loosely coupled data, model, and evaluation components with recorded runs | Keep research experiments identified by dataset, policy, source SHA, and result | Importing Qlib or giving its model a broker action |
| [LEAN engine](https://github.com/QuantConnect/Lean/blob/master/Engine/Engine.cs) | Separate feed, transaction, and results handlers | Keep candidate choice separate from the broker mutation coordinator | A second live trading engine |
| [NautilusTrader architecture](https://github.com/nautechsystems/nautilus_trader/blob/develop/docs/concepts/architecture.md) | Common core and ordered events for backtest and live contexts | Replay the persisted T0 with the canonical frontier, preserve source timing | Assuming simulated fills equal broker fills |
| [Feast point-in-time joins](https://docs.feast.dev/getting-started/concepts/point-in-time-joins) | Join feature values as of the decision timestamp | Keep `observedAt`, availability and decision time distinct for research and serving | Adding a feature-store service before it solves a measured gap |
| [FinRL pipeline](https://finrl.readthedocs.io/en/latest/start/introduction.html) | Separate training, testing, and trading | Keep calibration and challenger fitting offline | Online policy mutation or an RL order selector |
| [MLflow registry](https://mlflow.org/docs/latest/ml/model-registry/workflow) | Versioned models, run lineage and explicit promotion | Retain immutable model/policy identity and owner-gated promotion | Adding MLflow before resolved outcomes exist |
| [Hidden Technical Debt in ML Systems](https://research.google/pubs/hidden-technical-debt-in-machine-learning-systems/) | Watch for entanglement, undeclared consumers, feedback and configuration debt | Test the handoff and decision invariants, not only individual calculations | More compensating scores or extra decision authorities |

## Current failure-mode findings

| Mode | Evidence and consequence | Protection or current state |
| --- | --- | --- |
| Research branch earns Paper `GLOBAL_WAIT` | The frontier previously tested `applicable.length > 0`, so an H-only or D-only cycle could claim the Paper branch was evaluated | Fixed by requiring an applicable, evaluated Q branch. H/D-only regression tests assert `SYSTEM_HOLD` with `PAPER_BRANCH_NOT_APPLICABLE`. |
| Provider-order-dependent bounded D set | The first 1,000 D pairs previously depended on option-chain page order | Puts now sort by stable expiry, strike and symbol before bounded enumeration. A 1,035-pair reorder test checks identical candidate IDs and frontier hash. The bounded result still says enumeration was truncated. |
| Conflicting plan and frontier quantities | Plan assembly previously accepted an OPEN frontier whose selected candidate had quantity zero or less than the frontier quantity | Handoff now returns `CANONICAL_SIZING_LINEAGE_INVALID`, and also rejects branch/action or `GLOBAL_WAIT` contradictions. |
| Invalid Paper cap escapes as an exception | The cap parser could throw before returning a typed plan blocker | Invalid cap is `PAPER_EVIDENCE_RISK_CAP_INVALID`. A genuine cap of zero remains `PAPER_EVIDENCE_QUANTITY_ZERO`. |
| Correction cascade or duplicate authority | The [authority map](THETA_BRAIN_AUTHORITY_V1.md) and `tests/phase5-authority-structure.test.ts` define the known entry, management and mutation boundaries | Retain current owners. A comprehensive static consumer graph has not been certified, so this is not a blanket absence claim. |
| Training-serving skew, selection bias, model feedback | No promoted entry EV model or resolved independent whole-chain population is available | Keep model outputs research-only. Persist T0, near misses and alternatives, then test PIT-equivalent features and OOS outcomes before promotion. |
| Duplicate OCC input masquerades as two independent alternatives | The frontier counted the same exact contract twice, including in Q's second-best and D's pair denominator | Identical normalized observations now collapse by OCC symbol within each branch. Conflicting observations fail only the affected branch with `CONFLICTING_CONTRACT_OBSERVATIONS`, never an earned Paper WAIT. Tests cover Q and D. |
| Decision hash cannot detect all raw-input tampering after deduplication | A repeated contract no longer changes the decision frontier, so frontier-hash-only T0 verification missed an added input copy | New v3 T0 bundles hash the frozen contract input multiset separately and reject tampering. Historical v2 bundles remain readable, but cannot claim the stronger input-multiset check. |
| Missing universe size reported as zero | `zero-trade-diagnostic.ts` defaulted an absent diagnostic value to 0 | Missing or invalid observed universe size now stays null. A read-only diagnostic regression covers the actual projection path. |
| Invalid management ledger aggregate becomes zero | Management assembly used zero fallbacks for five SQL aggregates despite the loader's `COALESCE` contract | Missing or malformed aggregate values now fail the assembly boundary with `MANAGEMENT_LEDGER_AGGREGATE_INVALID:<field>`. A true SQL zero remains zero. This is source-level protection, not current-worker proof. |
| Incomplete Python Pareto response masquerades as a dominated candidate | The legacy new-risk orchestrator and cross-symbol shadow comparator accepted a well-shaped response that omitted a requested candidate. The missing result then became `PARETO_DOMINATED` or `survivesFrontier=false`. | Both call sites now require exact snapshot, timestamp and requested candidate-ID coverage. Missing, extra, duplicate, or invalid dominator IDs fail the model boundary, not the candidate's economics. This is source-level shadow/legacy protection, not a change to canonical Paper selection. |
| Quadratic dominance payload on broad chains | An offline 2,601-contract stress produced 3.38 million witness IDs, about 1.2 GB heap, and a roughly 16-second frontier | Exact Pareto count/rank remains intact while each candidate carries at most 32 sorted witness IDs plus an explicit omitted count. Objective vectors are reused, and the global pass no longer repeats branch-local dominance. Offline synthetic probes now completed at 2,601 / 5,000 / 10,000 contracts in about 0.57 / 1.12 / 3.01 seconds and about 161 / 176 / 313 MB heap. These are source-machine measurements, not market latency guarantees. |

The source-level [authority graph](THETA_BRAIN_AUTHORITY_GRAPH.json) and
[failure-mode register](THETA_BRAIN_FAILURE_MODE_REGISTER.json) are review
artifacts with CI checks. They do not prove current-worker reachability or
empirical profitability. The per-strategy feature manifest is governance
metadata consumed by the shadow registry, not a new entry/management gate.
Action oscillation, quantitative signal overlap, complete consumer data-flow,
and training-serving parity for a future promoted model remain open audits.

These source corrections address decision coherence. They do not
establish current-session L7 evidence, OPRA entitlement, empirical EV, a safe
first Paper order, or live-money readiness.
