# Claude `theta-r1-real-state` selective review

Compared against canonical `main` at `3b10195` after fetching the latest remote branch.
No commit was merged wholesale. `SUPERSEDED` means the behavior is already present on
main, often through a reviewed port with extra production fixes. `REPAIR_AND_PORT`
means useful intent exists but the implementation needs correction and focused tests.

| Commit | Classification | Reason |
|---|---|---|
| `2c97fde` | SUPERSEDED | Temporal consistency is integrated and tested on main. |
| `de0be4a` | SUPERSEDED | Alpaca clock/calendar reconciliation is integrated. |
| `c67f7f8` | SUPERSEDED | Event-state assembly is integrated. |
| `636f688` | SUPERSEDED | Reviewed AEGIS derivations are on main. |
| `4fc13cd` | SUPERSEDED | Position-intent-aware pending-order capital is on main. |
| `98eedfb` | SUPERSEDED | Explicit assignment capacity is on main. |
| `971aaa9` | DEFER | Cboe remains isolated research and is not needed for the first receipt. |
| `9e07688` | REJECT | Raw premium/collateral proxy is too weak for executable selection. |
| `d6b73cf` | SUPERSEDED | Main uses the later full economic frontier. |
| `78e2c4f` | SUPERSEDED | Management bridge and fail-closed orchestration are on main. |
| `d1081ee` | SUPERSEDED | Real subprocess management tests are on main. |
| `24a72f` | SUPERSEDED | Assignment orchestration contract is on main. |
| `e78078b` | SUPERSEDED | Recovery and covered-call opening contracts are on main. |
| `88b4376` | SUPERSEDED | Covered-call management orchestration is on main. |
| `1ee1334` | SUPERSEDED | Unified lifecycle management router is on main. |
| `e7e0bbc` | SUPERSEDED | Management opportunity evidence is on main. |
| `80b0559` | SUPERSEDED | Persistence interfaces and migrations 014-016 replace the request. |
| `0f19dbd` | SUPERSEDED | Restart-safe scheduler is on main with PostgreSQL leases. |
| `1e2bf39` | SUPERSEDED | Contract-derived multiplier rule is on main. |
| `2d040bf` | SUPERSEDED | Schema request is resolved by later migrations. |
| `2641c32` | SUPERSEDED | Full-H dimensional contract is on main. |
| `4777726` | SUPERSEDED | Per-candidate economics are exposed on main. |
| `4fe7f7c` | SUPERSEDED | Full economic cross-symbol frontier is on main. |
| `3bc369b` | SUPERSEDED | Strategy route receipt is on main. |
| `a25555b` | SUPERSEDED | Corrected GitHub research artifacts are on main. |
| `9f71cdd` | SUPERSEDED | Unknown capital-days fails closed on main. |
| `645b977` | SUPERSEDED | Unknown multiplier is non-executable on main. |
| `72a4bfc` | SUPERSEDED | Corrected research records are on main. |
| `9c0cb25` | SUPERSEDED | Positive after-cost economics is required on main. |
| `799bcf` | SUPERSEDED | Corrected research artifacts are on main. |
| `bb48aef` | SUPERSEDED | Open option MTM remains unknown on main. |
| `4c8fe61` | REPAIR_AND_PORT | Replay pieces are useful, but the walk-forward time contract and numerical edge cases need correction. |
| `4ea86c5` | DEFER | Review research specs after the executable Paper-readiness path. |
| `b277ca0` | REPAIR_AND_PORT | DSR hurdle mixes variance and standard-deviation units. |
| `424a54b` | REPAIR_AND_PORT | Ablation must be paired on the same observations and preserve independent N. |
| `0a4efb4` | REJECT | Midpoint fill assumptions cannot support THETA evidence. |
| `f182aa0` | REPAIR_AND_PORT | Zero correlation is treated as missing and drawdown recovery uses the wrong peak rule. |
| `7f3f610` | SUPERSEDED | Corrected research-only GEX matrix is on main as `be15d11`. |
| `531ae8b` | REPAIR_AND_PORT | The six named repairs are directionally correct and include regression tests. Port only with their R6 base modules after an isolated full review. |
| `9d3172e` | DEFER | Reproducibility and promotion checks are research-only and do not close the current Paper runtime input or empirical-data blockers. |
| `48b522a` `episode_economics.py` | SUPERSEDED | Its roll, multiplier, capital-day, and whole-chain invariants already exist in the production ledger contract and are enforced by the atomic lifecycle writer. |
| `48b522a` `management_policy.py` action taxonomy | REPAIR_AND_PORT | The action and global-WAIT taxonomies are useful and were ported as typed TypeScript contracts. `management_utility()` was not ported because it converts unknown penalty terms to zero. |
| `48b522a` `bs_reference.py` | RESEARCH_ONLY | Useful numerical fixture reference. Optionomics remains the production IV source and this solver is not a trading fallback. |
| `48b522a` `regime_report.py` | RESEARCH_ONLY | Correctly separates raw N and independent-chain N, but it does not close the live management-input or calibration gap. |
| `48b522a` flow and friend-bot documents | RESEARCH_ONLY | The anti-leakage and fail-open warnings are valid. No unvalidated flow threshold or claimed performance was adopted. |
| `b249625` | SUPERSEDED | Main already normalizes gamma, Vanna, and Charm heatmaps separately, verifies the metric echo, retains provider-unverified units/sign, and routes them as non-executable context. The proposed Python parser duplicates that boundary, accepts non-finite values, and its ablation registry splits subfeatures before a dataset exists. No duplicate engine was added. |
| `8f1be58` | REPAIR_AND_PORT | The exact-identity and UNKNOWN discipline are useful research patterns. The implementation was not ported because it can return `COMPOSITE_CANDIDATE` with missing BBO, uses absolute event-to-chain time so a pre-event chain can pass, and does not recursively redact dictionaries inside lists. No speculative webhook schema or execution authority was accepted. |
| `9c05da9` | RESEARCH_ONLY | Useful dated audit, but its main SHA and management-connectivity result are superseded. Canonical Production evidence now records REST and MCP HTTP 401, and management dispatch is connected by migration 037. The execution-quote conclusion remains NO. |
| `514cdf7` intelligence synthesis | ADAPT_NOW | The identified missing temporal observation layer is correct. It was independently implemented on main as immutable, versioned, research-only temporal deltas with strict time ordering, UNKNOWN propagation, source snapshot lineage, and no execution eligibility. |
| `514cdf7` external repository matrix | REJECT | It openly relies mostly on existence checks and README reads. The canonical `THETA_PROFESSIONAL_REFERENCE_PACK_2026-09-14.md` and `GITHUB_REPO_RESEARCH_LEDGER.md` already contain the stronger exact-SHA, file-level review required by the owner. |
| `715c97f` management dispatch | SUPERSEDED | Migration 037 and the typed management assembler connect the persisted frontier to close, stock exit, covered-call, and dependency-aware roll plans. |
| `715c97f` active action selection | REJECT | Feasibility alone does not prove `CLOSE_FULL` is economically preferable. `LET_EXPIRE` also requires exact OTM/session/broker lifecycle evidence, not DTE alone. Active selection remains blocked until a versioned policy supplies defensible economic and invalidation authority. |

No Claude commit was merged wholesale. The repaired branch now addresses the
previous six defects, but the repair commit depends on the unintegrated R6 base bundle.
Repaired point-in-time replay and
statistical metrics can be reviewed later with fixed reference fixtures. This does
not block the host-independent runtime or broker-truth work.

The production port is deliberately narrower than `48b522a`: hard gates and soft
evidence are distinct, global WAIT requires exhaustive evidence, every lifecycle state
has an explicit action frontier, and unknown economic terms remain null. The research
utility function's use of `or 0.0` for missing penalties was rejected because it would
make unknown risk look costless.

The 2026-09-15 review also resolved two external-repo questions. Cancellation
already re-reads Alpaca state before cancellation and immediately reconciles the
post-cancel broker state. Ambiguous cancellation remains unresolved until broker
reconciliation, so collateral cannot be released from an assumed cancel. Explicit
`SELL_TO_CLOSE` is represented in the canonical position-intent contract, but no
broker behavior was changed from a third-party README claim without an official
Alpaca contract or reproduced Paper evidence.
