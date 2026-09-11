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
