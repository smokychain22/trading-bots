# THETA Claude Long-Run V4 Final Receipt

Covers `THETA_CLAUDE_CONTINUE_WP67_TO_WP100_V4.md`: historical dedupe +
v1→v6 bridge, WP67 through WP100. See
`THETA_CLAUDE_OVERNIGHT_EXECUTION_LEDGER.md` for the full per-package
evidence trail and the WP100 final-state table this receipt summarizes.

```
BRANCH=claude/theta-overnight-quant
STARTING_SHA=a2d15eed6bb3e2b9be8636376681b6b489184371
FINAL_SHA=3101b572a15ddd8f38c4af0bcc712e3fc11d36d9
REMOTE_PUSH_VERIFIED=YES (origin/claude/theta-overnight-quant == local HEAD, confirmed via git fetch + rev-parse)

RAW_EXPORT_DIRS=666
UNIQUE_DATASET_HASHES=109
UNIQUE_EPISODES=302 (unique candidate sets / decisions)
UNIQUE_CANDIDATES=7550
DUPLICATE_BACKUP_COPIES=557 (666 raw - 109 unique)

V1_TO_V6_BRIDGE=IMPLEMENTED_LENIENT_RESEARCH_ONLY (research/historical_v1_to_v6_bridge.py; git-history-proven purely-additive v1->v6 lineage across all 6 version-bump commits; source_hash_verified=False for every one of the 109 unique archived files -- attempted, documented, not silently worked around; classified BLOCKED_CODEX, not treated as tampering or as verified)
UNMAPPABLE_FIELDS=NONE_FOUND (every field actually present in the recovered archive falls inside the proven v1-v6 lineage; a field outside that lineage is structurally ignored, never guessed at -- proven in test_adversarial_matrix.py)

WP25_STATUS=EMPIRICAL_INSUFFICIENT_SAMPLE (real deduped population exists; 0% selection rate, 100% identical rejection reason -- zero outcome variance to analyze)
WP26_STATUS=BLOCKED_DATA (feature ablation needs a resolved outcome label; none exists anywhere in the recovered archive)
WP59_STATUS=COMPLETE_SOURCE (every canonical benchmark ID classified into exactly one of the 4 required states; no bare RUNNER_NOT_IMPLEMENTED stub remains)

BENCHMARK_RUNNERS_IMPLEMENTED=15 (B0 [data available], B3, B4, B5, B6, BQ-1, BQ-2, BQ-3, BR-1, BR-2, BA-1, BA-2, BA-3, BC-1, BC-2 [all 14 data-unavailable against real data])
BENCHMARK_RUNNERS_DATA_BLOCKED=14 (the same 14 mechanic-implemented IDs above, all RUNNER_IMPLEMENTED_DATA_UNAVAILABLE against the real archive -- 0 feasible candidates, 0 lifecycle events, no delta field)

WP67_100_COMPLETE=34 of 34 work packages attempted (67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100)
WP67_100_BLOCKED=0 (WP79/WP80 were RECONCILED_EXISTING, not blocked; WP87 is EMPIRICAL_INSUFFICIENT_SAMPLE, a completed real run with a negative result, not a blocked package)

REAL_EMPIRICAL_RUNS=1 (WP87's Phase 6 real campaign against the full deduplicated historical archive -- see docs/research/THETA_CLAUDE_PHASE6_REAL_EXPERIMENT_RECEIPT.md)
UNIQUE_EMPIRICAL_N=0 (0 selected candidates, 0 resolved outcomes anywhere in the recovered archive -- the real run's honest result)
OOS_RUNS=0 (nothing to split -- zero labeled rows)
CALIBRATION_RUNS=0 (nothing to calibrate -- zero labeled rows; the calibration MACHINERY itself is real, tested, and reconciled at WP55)
DSR_RUNS=0 (nothing to run DSR over -- zero real trial return series exist; the DSR machinery itself is real, tested, and reconciled at WP61)
PBO_RUNS=0 (same as DSR -- machinery reconciled at WP62, no real data to run it on)

CODEX_HANDOFFS=1 generalized generator + 1 registry-driven generator (research/codex_handoff_pack.py, research/future_capture_contract.py's build_codex_handoff()); concrete handoffs are generated on demand per required future-capture field (assignment_event, exercise_event, expiration_outcome, filled, fill_price, management_action_taken, management_outcome, whole_chain_state -- 8 required fields, each independently testable via build_codex_handoff())

FULL_PYTHON=PASS (1224 passed, 11 subtests passed, 0 fail -- python -m pytest bots/theta/tests -q)
TYPECHECK=NOT_APPLICABLE (0 TypeScript/JavaScript files touched this entire session, verified via git diff --name-only against the frozen starting SHA)
LINT=NOT_APPLICABLE (same reason -- no TS/JS touched; no Python lint configured/required by this repo's own conventions)
SECURITY=PASS (no .env/credential files touched; no secret-shaped strings found across the full session diff)

ORDER_SUBMISSIONS=0
BROKER_MUTATIONS=0
LIVE_AUTHORIZATION=NOT_GRANTED
```

## Stop condition

Valid stop condition **(A)**: WP67–100 attempted and all independent
source-solvable work exhausted. Every remaining gap named in this pass
(the v1 archive hash-verification discrepancy; `B1`/`B2`/`BH-1`'s missing
multi-stage lifecycle simulation; `research_cli.py`'s
`features`/`dataset-build`/`filter-value` integration; the "strategy cap"
sizing dimension that does not exist anywhere in the router/sizing model
today) is a genuine, named, owner/Codex-facing decision or a
substantially larger, separately-scoped engineering effort — not
something source-solvable left undone in this pass.
