# THETA pre-VPS capability registry

Status: Slice 2 of the pre-VPS master continuation directive. Machine-readable
companion: `src/research/pre-vps-capability-registry.ts` (24 entries, tested
for duplicate IDs and field completeness in `tests/pre-vps-capability-registry.test.ts`).

This is a first, honestly-scoped registry -- 24 of the highest-priority
capabilities across the entry, management, AEGIS, provider, and disaster-
recovery domains, not an exhaustive catalog of every function in the
codebase. Every entry's `currentState` reflects only what this engagement has
directly verified; anything not independently re-checked this pass says so
explicitly (`NOT_INDEPENDENTLY_VERIFIED`) rather than assuming REAL.

## How to read this registry

- `currentState: REAL` -- producer, consumer, and runtime path all confirmed to exist and connect.
- `currentState: PARTIAL` -- some of the path is real, but a documented gap remains.
- `currentState: STUB_DEFAULT` -- a real interface exists but the live call site supplies a default/no-op implementation.
- `currentState: QUARANTINED_NO_CALLERS` -- real, tested code with zero real Production callers.
- `currentState: NOT_INDEPENDENTLY_VERIFIED` -- plausible from a real function's existence, but this engagement has not directly traced its full producer->consumer->runtime path.

## Summary by maturity

| Maturity | Count | Notes |
| --- | --- | --- |
| PRODUCTION_REQUIRED | 19 | Includes 3 confirmed P0/P1 gaps (roll/CC candidate source, AEGIS system stress, cross-strategy comparison) |
| PAPER_BOOTSTRAP_REQUIRED | 1 | Disaster recovery backup/restore |
| RESEARCH_ONLY | 2 | This engagement's own hardened R8 research contracts |
| QUARANTINED | 1 | The array-based management architecture (`management-cycle.ts` + orchestrators) |
| SHADOW_REQUIRED | 0 this pass | Not yet populated -- see scope note below |
| DEPRECATED | 0 this pass | None identified yet |

## Full entries

See `src/research/pre-vps-capability-registry.ts::capabilityRegistry` for the
complete, structured 24-entry table (capabilityId, purpose, maturity,
firstPaperRequired, preVpsRequired, producer, dataSource, persistence,
consumer, runtimeReachable, authority, mechanicallyTested, providerTested,
noSubmitTested, empiricallyValidated, currentState, blocker, owner,
sourceFiles per entry). Key entries, summarized:

| capabilityId | currentState | blocker |
| --- | --- | --- |
| MARKET_CLOCK | REAL | none |
| BROKER_ACCOUNT | REAL | none |
| BROKER_POSITIONS | REAL | none |
| BROKER_OPEN_ORDERS | REAL | none |
| BROKER_ORDER_SUBMISSION | REAL (corrected this pass -- real, gated mutation exists at `src/execution/broker.ts:274-282`) | none |
| BROKER_RECONCILIATION | NOT_INDEPENDENTLY_VERIFIED | internals not read this pass |
| UNIVERSE_DISCOVERY | REAL | none |
| UNDERLYING_RANKING | PARTIAL | Production baseline is a simple avgDollarVolume placeholder; real research challengers exist but are not Production-integrated |
| OPTIONABILITY_CHECK | NOT_INDEPENDENTLY_VERIFIED | internals not re-read this pass |
| OPTION_CONTRACT_DISCOVERY | REAL | see CONTRACT_NOT_EXECUTABLE_ROOT_CAUSE investigation |
| EXECUTABLE_BBO | REAL | none |
| CONTRACT_MULTIPLIER_MAPPING | NOT_INDEPENDENTLY_VERIFIED (live) | **highest-priority open question** -- see `THETA_CONTRACT_NOT_EXECUTABLE_INVESTIGATION.md` |
| DELTA_STRIKE_DTE_LATTICE | NOT_INDEPENDENTLY_VERIFIED | Python lattice confirmed to exist, not re-read this pass |
| CORPORATE_ACTION_EVIDENCE | REAL | none |
| AEGIS_SECTOR_CORRELATION | PARTIAL | real only for the single-underlying-held case |
| AEGIS_SYSTEM_LIQUIDITY_STRESS | STUB_DEFAULT | **P0 (promoted, verified this pass by direct line-by-line `aegis.py` read):** any of 3 SYSTEM stress signals `None` -> `HOLD_ONLY`; `stressSpreadWideningDetected is None` ALSO independently forces the separate LIQUIDITY family to `HOLD_ONLY`. Worst-family-wins means `new_risk_state` is `HOLD_ONLY` or worse on every real Production AEGIS evaluation today -- zero new-risk-opening actions are ever permitted, unconditionally, independent of `CONTRACT_NOT_EXECUTABLE` |
| CROSS_STRATEGY_ECONOMIC_COMPARISON | PARTIAL | currently latent (only one branch's candidates ever coexist today), see the strategy router truth matrix |
| AEGIS_EVALUATION | PARTIAL | only reached after upstream Pareto survivors exist |
| SIZING_UNKNOWN_VS_EARNED_WAIT | REAL | fixed on `main`, not yet confirmed deployed to the pinned worker |
| PAPER_PLAN_ASSEMBLY | REAL | only 3 of 5 branches pass the SHADOW gate (by design) |
| ROLL_CC_CANDIDATE_VALUATION | STUB_DEFAULT | real, tested, structurally unreachable |
| ROLL_CC_CANDIDATE_SOURCE | STUB_DEFAULT | **P0**, confirmed across multiple passes; this pass's management-E2E fork further confirmed BOTH the array-based (`rollCandidates`/`ccCandidates`/`rollCcCandidates`) and singular (`rollCandidate`/`ccCandidate`) mechanisms are unpopulated -- blocking ROLL, ROLL_CC, AND SELL_CC, not just one action |
| QUARANTINED_MANAGEMENT_ARCHITECTURE | QUARANTINED_NO_CALLERS | architectural decision needed (adopt or retire) |
| WHOLE_CHAIN_ACCOUNTING | REAL | none |
| DISASTER_RECOVERY_BACKUP_RESTORE | REAL | active Codex work-in-progress, not independently re-verified (Aiven access) |
| CROSS_STRATEGY_RESEARCH_CONTRACT | REAL (research-only) | none |
| UNIVERSE_OPPORTUNITY_REGRET_SCHEMA | REAL (research-only) | zero real persisted rows observed |

## Scope note (explicitly deferred from this registry)

Not yet entered: individual DTE/strike/delta search internals beyond the
lattice module reference; Optionomics-specific capability entries (see
`THETA_PROVIDER_CAPABILITY_MATRIX.md` instead, which covers this in more
detail than a single registry row could); full whole-chain fee/TCA/capital-
days breakdown as separate entries (currently bundled under
`WHOLE_CHAIN_ACCOUNTING`); restart/reconciliation internals beyond disaster
recovery. These can be added as follow-up registry entries without
restructuring the schema.
