export const phase8BuildReadinessVersion = 'theta-phase8-build-readiness-v1' as const;

export type Phase8ImplementationState = 'READY' | 'READY_FOR_DATA' | 'BLOCKED_SOURCE';

export interface Phase8Capability {
  readonly id: string;
  readonly state: Phase8ImplementationState;
  readonly sourceFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly persistence: string;
  readonly consumer: string;
  readonly reason: string;
}

const capability = (id: string, state: Phase8ImplementationState, sourceFiles: readonly string[],
  testFiles: readonly string[], persistence: string, consumer: string, reason: string): Phase8Capability =>
  ({ id, state, sourceFiles, testFiles, persistence, consumer, reason });

/**
 * Executable Phase 8 denominator. READY means code, persistence and a consumer
 * exist. READY_FOR_DATA means the same pipeline is built but its empirical
 * result honestly requires future observations. BLOCKED_SOURCE is reserved for
 * a missing code-solvable link and makes the aggregate build gate fail.
 */
export const phase8Capabilities: readonly Phase8Capability[] = [
  capability('EPISODE_MODEL', 'READY_FOR_DATA', ['src/research/shadow-episode-contract.ts','src/research/whole-chain-outcome-builder.ts'],
    ['tests/shadow-episode-contract.test.ts','tests/whole-chain-outcome-builder.test.ts'], 'local observation spool and resolved outcome tables', 'Command 5A maturation and outcome resolver', 'Contracts are complete. Real managed episodes must arrive.'),
  capability('CANDIDATE_FUNNEL_CAPTURE', 'READY', ['src/theta/q-entry-funnel.ts'], ['tests/phase2-q-funnel.test.ts'],
    'bounded Q funnel in cycle evidence and runtime diagnostic', 'runtime behavior and Phase 8 filter analysis', 'Sequential and masking-free gate evidence is produced per cycle.'),
  capability('ACCEPTED_REJECTED_WAIT_CAPTURE', 'READY_FOR_DATA', ['src/research/shadow-evidence-runtime.ts','src/research/wait-regret-dataset.ts'],
    ['tests/shadow-evidence-runtime.test.ts','tests/wait-regret-dataset.test.ts'], 'canonical frontier archive, local observation spool and research datasets', 'outcome maturation and regret analysis', 'All dispositions are representable. Future labels remain required.'),
  capability('OUTCOME_MATURATION', 'READY_FOR_DATA', ['src/research/outcome-resolver.ts','src/research/command5a-local-maturation.ts'],
    ['tests/outcome-resolver.test.ts','tests/command5a-local-maturation.test.ts'], 'resolved outcome tables and immutable local dataset batches', 'entry, WAIT, strategy and management research', 'Maturation is runnable and idempotent. Outcomes must occur later.'),
  capability('COUNTERFACTUAL_ENGINE', 'READY_FOR_DATA', ['src/research/management-counterfactual-analysis.ts','src/research/strategy-choice-outcome-builder.ts'],
    ['tests/management-counterfactual-analysis.test.ts','tests/strategy-choice-outcome-builder.test.ts'], 'research artifacts only', 'offline challenger evaluation', 'Identifiability stays explicit. Broker authority is false.'),
  capability('FILTER_REGRET', 'READY_FOR_DATA', ['src/theta/q-filter-analysis.ts'], ['tests/q-filter-analysis.test.ts'],
    'bounded filter diagnostics in Q funnel plus offline matured labels', 'strictness and false-reject research', 'Gate cohorts are built. Regret rates remain null until valid labels exist.'),
  capability('MARGINAL_GATE_ANALYSIS', 'READY', ['src/theta/q-filter-analysis.ts','src/theta/q-entry-funnel.ts'],
    ['tests/q-filter-analysis.test.ts','tests/phase2-q-funnel.test.ts'], 'bounded Q funnel summary', 'runtime diagnostics and offline ablation', 'Unique blockers and interactions are measured without rerunning authority.'),
  capability('DECISION_EXPLAINABILITY', 'READY', ['src/theta/decision-explainability.ts','src/theta/postgres-theta-cycle-store.ts'],
    ['tests/decision-explainability-v2.test.ts'], 'trade.decision.receipt_json', 'operator evidence and later outcome analysis', 'Underlying, strategy, expiry, strike, now and size explanations are persisted from canonical evidence.'),
  capability('STRATEGY_COUNTERFACTUALS', 'READY_FOR_DATA', ['src/research/cross-strategy-common-horizon-contract.ts','src/research/strategy-choice-outcome-builder.ts'],
    ['tests/cross-strategy-common-horizon-contract.test.ts','tests/strategy-choice-outcome-builder.test.ts'], 'local common-horizon datasets', 'Q/H/D shadow comparator', 'Comparison is shadow-only and needs future common-horizon observations.'),
  capability('FEATURE_UTILIZATION_AUDIT', 'READY', ['src/theta/decision-critical-evidence-registry.ts','src/theta/optionomics-feature-destinations.ts'],
    ['tests/decision-critical-evidence-registry.test.ts','tests/optionomics-feature-destinations.test.ts'], 'versioned source registry', 'architecture and unknown audits', 'Provider, role, persistence and consumer are explicit.'),
  capability('FEATURE_ABLATION', 'READY_FOR_DATA', ['bots/theta/quant/research/ablation.py','bots/theta/quant/research/entry_feature_ablation.py'],
    ['bots/theta/tests/quant/test_entry_feature_ablation.py'], 'versioned research result bundles', 'offline model evaluation', 'Tooling exists. Promotion needs PIT-safe outcomes.'),
  capability('SIZING_COUNTERFACTUALS', 'READY_FOR_DATA', ['src/research/sizing-challenger-replay.ts'], ['tests/sizing-challenger-replay.test.ts'],
    'research replay artifacts', 'offline sizing policy comparison', 'Canonical quantity is unchanged. Alternative quantities need outcomes.'),
  capability('TCA_CAPTURE', 'READY_FOR_DATA', ['src/research/execution-dataset-contract.ts','src/execution/confirmed-fill-tca.ts'],
    ['tests/execution-dataset-contract.test.ts','tests/confirmed-fill-tca.test.ts'], 'execution price events and research datasets', 'fill and cost analysis', 'Decision and pre-submit quotes are ready. Real fills are required.'),
  capability('PROFIT_CHALLENGERS', 'READY_FOR_DATA', ['src/research/profit-taking-challenger-runner.ts','src/research/profit-taking-replay.ts'],
    ['tests/profit-taking-challenger-runner.test.ts','tests/profit-taking-replay.test.ts'], 'shadow management evidence and replay artifacts', 'management policy research', 'All challengers remain non-authoritative pending episodes.'),
  capability('LOSS_CAUSE_AND_ACTIONS', 'READY_FOR_DATA', ['src/research/loss-cause-integration-contract.ts','src/research/loss-roll-experiment.ts'],
    ['tests/loss-cause-integration-contract.test.ts','tests/loss-roll-experiment.test.ts'], 'management snapshots and research cohorts', 'management challenger comparison', 'Known causes are retained. Unknown is never forced into an action.'),
  capability('ROLL_ASSIGNMENT_RECOVERY_CC', 'READY_FOR_DATA', ['src/research/management-outcome-schema.ts','src/research/recovery-survival-dataset.ts','src/theta/whole-chain-economics.ts'],
    ['tests/phase2-chain-assignment-economics.test.ts','tests/recovery-survival-dataset.test.ts','tests/recovery-covered-call-experiment.test.ts'],
    'management snapshots, chain ledger and research datasets', 'whole-chain management research', 'Mechanics are built. Real lifecycle events are still needed.'),
  capability('WHOLE_CHAIN_ACCOUNTING', 'READY', ['src/theta/whole-chain-economics.ts','src/theta/postgres-whole-chain-components-repository.ts'],
    ['tests/whole-chain-economics.test.ts','tests/db/whole-chain-components-repository.test.ts'], 'economic chain component ledger', 'management and research outcome builders', 'Costs and rolls remain explicit within one chain.'),
  capability('WAIT_AND_DECISION_REGRET', 'READY_FOR_DATA', ['src/research/wait-regret-dataset.ts','src/theta/q-filter-analysis.ts'],
    ['tests/wait-regret-dataset.test.ts','tests/q-filter-analysis.test.ts'], 'immutable research datasets', 'strictness and policy evaluation', 'Denominators are defined. Future outcomes remain required.'),
  capability('CALIBRATION_AND_OOS', 'READY_FOR_DATA', ['src/research/calibration-evaluation-contract.ts','src/research/purge-embargo-contract.ts'],
    ['tests/calibration-evaluation-contract.test.ts','tests/purge-embargo-contract.test.ts'], 'model registry and reproducibility bundles', 'offline empirical evaluation', 'No model is promoted without sufficient chronological evidence.'),
  capability('PROMOTION_GOVERNANCE', 'READY_FOR_DATA', ['src/theta/empirical-policy-promotion.ts','src/research/promotion-evidence-assembler.ts'],
    ['tests/empirical-policy-promotion.test.ts','tests/promotion-evidence-assembler.test.ts'], 'immutable promotion evidence', 'champion/challenger governance', 'Promotion stays blocked until evidence gates pass.'),
  capability('DAILY_LEARNING_LOOP', 'READY_FOR_DATA', ['tools/theta-command5a-runtime.ts','tools/windows/theta-local-worker.ps1'],
    ['tests/command5a-windows-worker-wiring.test.ts','tests/command5a-local-maturation.test.ts'], 'SQLite WAL scheduler and research spool', 'schedule, observe, mature and health loop', 'The locked supervisor runs the non-authoritative learning loop.'),
  capability('DATASET_REPRODUCIBILITY', 'READY', ['src/research/reproducibility-bundle.ts','src/storage/research-durable-store.ts'],
    ['tests/reproducibility-bundle.test.ts','tests/research-durable-store.test.ts'], 'content-hashed immutable bundles and SQLite WAL', 'dataset and model evaluation tools', 'Inputs, versions, cutoffs and hashes are verified.'),
  capability('RESEARCH_IDEMPOTENCY', 'READY', ['src/storage/local-research-history-spool.ts','src/storage/local-observation-job-scheduler.ts'],
    ['tests/local-research-history-spool.test.ts','tests/command5a-local-scheduling.test.ts'], 'unique content-addressed local rows', 'all Command 5A writers', 'Identical retries are no-ops and conflicts fail.'),
  capability('STORAGE_BOUNDEDNESS', 'READY', ['src/storage/data-platform/dataset-registry.ts','src/storage/storage-dataset-policy.ts'],
    ['tests/storage-budget.test.ts','tests/contract-path-storage-budget.test.ts'], 'Postgres metadata plus SQLite/Parquet archive', 'storage control plane', 'Research history is kept off the transactional hot path.'),
  capability('CRITICAL_PATH_ISOLATION', 'READY', ['src/research/production-shadow-runtime.ts','src/theta/postgres-theta-cycle-store.ts'],
    ['tests/phase4-storage-gate-wiring.test.ts','tests/command5a-windows-worker-wiring.test.ts'], 'typed research failure receipts', 'trading and management runtime', 'Research failure cannot authorize, duplicate or block broker management.'),
] as const;

export interface Phase8BuildReadinessReceipt {
  readonly contractVersion: typeof phase8BuildReadinessVersion;
  readonly buildReady: boolean;
  readonly empiricalStatus: 'READY_FOR_DATA' | 'BLOCKED_SOURCE';
  readonly readyCount: number;
  readonly readyForDataCount: number;
  readonly blockedSourceCount: number;
  readonly capabilities: readonly Phase8Capability[];
  readonly orderSubmissions: 0;
  readonly brokerMutations: 0;
  readonly followerSubmissions: 0;
  readonly liveAuthorization: 'NOT_GRANTED';
}

export function buildPhase8BuildReadinessReceipt(): Phase8BuildReadinessReceipt {
  const ids = phase8Capabilities.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('PHASE8_CAPABILITY_ID_DUPLICATE');
  for (const entry of phase8Capabilities) {
    if (entry.sourceFiles.length === 0 || entry.testFiles.length === 0 || !entry.persistence.trim() || !entry.consumer.trim()) {
      throw new Error(`PHASE8_CAPABILITY_EVIDENCE_INCOMPLETE:${entry.id}`);
    }
  }
  const blockedSourceCount = phase8Capabilities.filter((entry) => entry.state === 'BLOCKED_SOURCE').length;
  return {
    contractVersion: phase8BuildReadinessVersion,
    buildReady: blockedSourceCount === 0,
    empiricalStatus: blockedSourceCount === 0 ? 'READY_FOR_DATA' : 'BLOCKED_SOURCE',
    readyCount: phase8Capabilities.filter((entry) => entry.state === 'READY').length,
    readyForDataCount: phase8Capabilities.filter((entry) => entry.state === 'READY_FOR_DATA').length,
    blockedSourceCount,
    capabilities: phase8Capabilities,
    orderSubmissions: 0, brokerMutations: 0, followerSubmissions: 0, liveAuthorization: 'NOT_GRANTED',
  };
}
