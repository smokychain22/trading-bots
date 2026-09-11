# THETA strategy implementation gap audit

As of 2026-09-12, canonical base `317f8b2`. This audit reconciles the new strategy package with existing Production code. The PDF material is specification input. Broker truth, lifecycle accounting, AEGIS, empirical promotion, and execution locks remain stronger runtime invariants.

| Strategy requirement | Existing implementation | Gap | Action |
|---|---|---|---|
| Whole-chain economic objective | `economic-chain.ts`, lifecycle ledger, `management-action-frontier.ts` | Empirical continuation EV is unavailable | REUSE, keep EV UNKNOWN |
| Five business branches | Six-family `strategy_router.py` and typed TS contract | Business names and promotion state were implicit | EXTEND with `strategy-package.ts`, map Q/H/A/C/D, keep R as management |
| Immutable strategy version | `core.strategy_version` and version references | No canonical validated branch config | BUILD typed immutable config and SHA-256 hash, reuse table |
| Hard versus soft evidence | `decision-evidence.ts` | Feature destination taxonomy incomplete in runtime | EXTEND registry/docs, do not add AND gates |
| Underlying selection | `universe-policy.ts` liquidity prefilter | No evidence-backed composite score | BUILD Pareto contract, DEFER learned ranking |
| Contract lattice | Alpaca contract/chain ingestion and THETA-Q lattice | Branch-level lattice config absent | EXTEND with branch configs, no single-delta shortcut |
| Entry decision | `new-risk-orchestrator.ts`, Pareto frontier, AEGIS, sizing, execution quality | Two UNKNOWN-to-zero paths | REPAIR, positive known economics required |
| Management | `management-input-state.ts`, `management-action-frontier.ts` | Empirical action values and several provider features unknown | REUSE, DEFER values, preserve full alternatives |
| Roll | Atomic `OPTION_ROLL` writer | Runtime policy cannot value roll yet | REUSE accounting, RESEARCH_ONLY policy |
| Assignment, expiry | Broker classifier and atomic lifecycle writer | No safe bridge between them | BUILD confirmed-evidence-only bridge |
| Recovery and CC | Python recovery/CC rankers and TS action frontier | Empirical recovery/CC value unavailable | REUSE, SHADOW only |
| Position sizing | Python `sizing.py` | Monotonicity coverage incomplete | REUSE and PORT invariant tests from Claude |
| Global WAIT | `decision-evidence.ts` | Best/second/best-rejected evidence absent | EXTEND evidence contract |
| Strategy response | Existing per-model Node to Python contracts | No aggregate strategy/action-value result shape | BUILD v1 contract, always non-executing |
| Decision receipt | Persisted receipt JSON | Invalidation and next-trigger envelope not yet wired | DEFER to next persistence migration, current receipt remains canonical |
| Drift/promotion | Research docs and promotion gates | No resolved independent OOS dataset | RESEARCH_ONLY |
| Full broker lifecycle automation | Atomic writer covers expiry, assignment, close, roll, CC, stock disposal | Close/roll/CC action assemblers are not attached to always-on worker | DEFER until management values and worker host exist |

## Duplicate modules avoided

- No second router. `strategy_router.py` remains the applicability engine.
- No new management action enum. `ManagementFrontierAction` and Python `CandidateAction` remain authoritative in their layers.
- No new sizing engine. `sizing.py` remains quantitative truth.
- No duplicate action-value model. Current values stay UNKNOWN until data exists.
- No YAML runtime loader. `strategy-package.ts` is the single validated config source, which avoids drift between YAML and runtime constants.

## Claude `8fa0909` review

| Item | Classification | Decision |
|---|---|---|
| `feature_taxonomy.py` | SUPERSEDED | Current TypeScript hard/soft evidence contract is Production-owned. Useful taxonomy is captured in provider and constitution docs. |
| `strictness_diagnostics.py` | DEFER | Sound research shape, but no resolved opportunity outcomes or canonical persistence target yet. |
| `champion_challenger.py` | RESEARCH_ONLY | Sound separation of promotion from per-cycle routing. Current configs remain unpromoted and non-executable. |
| `action_value_distribution.py` | PORT | Its UNKNOWN-first distributional shape is represented in `strategy-evaluation-contract.ts`. |
| `opportunity_capture.py` | DEFER | Requires empirical positive-EV labels that do not exist. |
| `strategy_routing_shadow.py` | DEFER | Requires replay and reconstructed counterfactual outcomes. |
| `promotion_checker.py` changes | ACCEPT_CONCEPT | Ablation and regime stability are required by the promotion policy, but the branch file is not merged wholesale because it is based on a divergent research history. |
| sizing invariant tests | PORT | Monotonic and zero-capacity tests were adapted to current `sizing.py`. |
| `management_policy.py` | REJECT | Duplicates the action vocabulary and converts missing penalties to zero. |
| applicability matrix | PORT | Current applicability and missing regime dimensions are recorded in the router document. |

Claude follow-up `811da56` was also reviewed after the pre-push fetch. Its UNKNOWN-to-zero
repair is correct, and the same invariant is enforced in the canonical TypeScript strategy
contract. Its research strategy registry and config are not ported because
`strategy-package.ts` now owns the Production schema and a second registry would create
configuration drift. Its drift-status and execution-survival promotion gates are accepted
as promotion requirements, with activation still operator-governed.

No file from the Claude branch was blindly merged.
