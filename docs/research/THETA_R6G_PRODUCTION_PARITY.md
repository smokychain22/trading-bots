# THETA R6G research to Production parity

Reviewed source: `claude/theta-r1-real-state` at `4ffbd49c7dde0b5bc734c42742a968732563e93c`.

The Python records remain research contracts. PostgreSQL migrations 018 and 019 plus the TypeScript runtime remain the Production evidence authority. No research file can activate a strategy or submit an order.

| Claude research field | Production field | Compatible | Unit | Null semantics | Timestamp semantics | Action |
|---|---|---:|---|---|---|---|
| `RecordLineage.as_of` | candidate `decision_time`, provenance `asOf` | Yes | UTC timestamp | Required | Point in time available to decision | MATCH |
| `provider_timestamp` | provenance `providerTimestamp` | Yes | UTC timestamp | `null` means provider did not supply it | Must be no later than `asOf` | MATCH |
| `ingestion_timestamp` | provenance `ingestionTimestamp` | Yes | UTC timestamp | Required | Must be no earlier than `asOf` | MATCH |
| `strategy_version_id` | `strategy_version` | Yes | version ID/string | Required | Frozen at decision | MATCH |
| `feature_set_version` | `feature_version` | Yes | version ID/string | Required | Frozen at decision | MATCH |
| `cost_model_version` | `cost_model_version` | Yes | version ID/string | Required | Frozen at decision | MATCH |
| `risk_limit_version` | `risk_version` | Yes | version ID/string | Required | Frozen at decision | MATCH |
| contract identity | `contract_json.contractSymbol` | Yes | OCC symbol | Required for option candidate | Exact identity at decision | MATCH |
| lifecycle chain ID on every candidate | Candidate rows do not have a chain before entry | No | UUID | Pre-entry chain is legitimately absent | Chain begins only after a selected entry becomes an episode | REPAIR_AND_PORT downstream only |
| `CandidateSet.candidates` | `trade.candidate_set` plus PIT candidate rows | Yes | records | Empty is valid | One immutable decision cycle | MATCH |
| `SelectedCandidate` | `trade.decision.selected_candidate_id` | Yes | UUID | `null` means WAIT/PASS | Same decision timestamp | MATCH |
| `ShadowCandidate` | `trade.shadow_opportunity` and PIT candidate status | Yes | record | Counterfactual values remain unknown | Same decision timestamp | MATCH |
| `ManagementSnapshot` | `trade.management_input_snapshot` | Yes | record | Missing provider/model fields stay `null` and are named | Reconciliation anchored | MATCH |
| `ManagementActionSet` | `trade.management_action_frontier` | Yes | action frontier | Empirical utility remains unknown | Same management snapshot | MATCH |
| `EconomicEpisode` | `research.theta_outcome_label` plus economic ledger | Partial | USD, ratios, days | Unresolved stays unresolved | Label availability is separate from feature time | PORT incrementally |
| `ExecutionEvidence.filled` | broker fills plus quote observations | Partial | boolean/fill quantities | Counterfactual fill probability remains unknown | Broker time for fills, observation time for quotes | REPAIR_AND_PORT |
| `LifecycleEvent` | lifecycle transition/application tables | Yes | event | Provider reference may be absent only for non-broker actions | Broker-confirmed event time | MATCH |

Research target definitions in `research_targets.py` are accepted as frozen research names. They are RESEARCH_ONLY until real data, sample sufficiency, untouched OOS, calibration, tails, and execution survival are established. The R6G documentation is PORTED. The Python dataclasses are DEFERRED because duplicating the Production schema would create two authorities.

## R6H follow-up review

Claude branch `a7449396cdca74463845dad52906f1ef43f48ec2` repairs the parallel-schema concern above. Its dataset contracts now mirror migration 018, its loader verifies nested leakage, ordering, identity, timestamps and hashes, and its readiness state machine prevents a model fit from skipping descriptive audit, walk-forward, or untouched OOS gates.

| Work | Decision | Reason |
|---|---|---|
| `dataset_contracts.py` R6H rewrite | PORT | Mirrors the Production export instead of defining a second authority. |
| `production_export_loader.py` | PORT | Adds a fail-closed research intake boundary. |
| `dataset_readiness.py` | PORT | Keeps empirical readiness cumulative and threshold-driven. |
| R6H research documentation | PORT | Records parity, integrity and audit requirements without claiming results. |
| R6G pre-rewrite dataset shape | SUPERSEDED | Replaced by the migration-018-aligned R6H contract. |
| Any strategy promotion | REJECT | No real resolved dataset exists. |

The TypeScript runtime and PostgreSQL schema remain authoritative. The Python loader consumes their exported artifact and cannot activate execution.
