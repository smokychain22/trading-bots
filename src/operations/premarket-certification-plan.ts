export const premarketCertificationVersion = 'theta-presession-total-certification-v2' as const;

export interface PremarketCertificationGroup {
  readonly id: string;
  readonly testFiles: readonly string[];
}

export type PremarketCertificationState = 'PASS' | 'FAIL' | 'EXTERNAL_BLOCKED' | 'FORWARD_DATA_REQUIRED';
export interface PremarketCertificationClassification { readonly state: PremarketCertificationState; readonly detail: string }

export function classifyExactCi(rows: readonly { readonly headSha?: string; readonly status?: string;
  readonly conclusion?: string; readonly url?: string }[], sourceSha: string): PremarketCertificationClassification {
  const exact = rows.find((row) => row.headSha === sourceSha);
  if (exact?.status === 'completed' && exact.conclusion === 'success') {
    return { state: 'PASS', detail: exact.url ?? 'EXACT_CI_PASS' };
  }
  if (exact?.status === 'completed') {
    return { state: 'FAIL', detail: `EXACT_CI_${(exact.conclusion ?? 'FAILED').toUpperCase()}` };
  }
  if (exact !== undefined) {
    return { state: 'FORWARD_DATA_REQUIRED', detail: `EXACT_CI_${(exact.status ?? 'PENDING').toUpperCase()}` };
  }
  return { state: 'FORWARD_DATA_REQUIRED', detail: 'EXACT_CI_NOT_YET_OBSERVED' };
}

export function classifyLockedWorker(status: Readonly<Record<string, unknown>>,
  sourceSha: string): PremarketCertificationClassification {
  const safelyRunning = status.taskState === 'Running' && status.runtimeShaAligned === true
    && status.healthShaAligned === true && status.executionGate === 'LOCKED';
  const sourceAligned = status.runtimeSha === sourceSha && status.workspaceSha === sourceSha;
  if (safelyRunning && sourceAligned) return { state: 'PASS', detail: 'ONE_CURRENT_SOURCE_ALIGNED_LOCKED_WORKER' };
  if (safelyRunning) return { state: 'FORWARD_DATA_REQUIRED', detail: 'HEALTHY_LOCKED_WORKER_AWAITS_EXACT_CI_CUTOVER' };
  return { state: 'FAIL', detail: 'WORKER_NOT_SAFELY_RUNNING' };
}

export const premarketCertificationGroups: readonly PremarketCertificationGroup[] = [
  { id: 'CONFIGURATION_AND_EVIDENCE_AUTHORITY', testFiles: [
    'tests/presession-configuration-registry.test.ts', 'tests/decision-critical-evidence-registry.test.ts',
    'tests/runtime-policy-authority.test.ts', 'tests/false-safe-defaults.test.ts',
    'tests/optionomics-feature-destinations.test.ts', 'tests/qualified-soft-feature-evidence.test.ts',
    'tests/v18-final-acceptance.test.ts',
  ] },
  { id: 'PROVIDER_CONTRACT_AND_FUZZ', testFiles: [
    'tests/alpaca-provider.test.ts', 'tests/optionomics-provider.test.ts', 'tests/option-contract.test.ts',
    'tests/option-chain-ingestion.test.ts', 'tests/trusted-option-quote.test.ts',
    'tests/execution-option-quote.test.ts', 'tests/alpaca-corporate-action-evidence.test.ts',
    'tests/macro-event-policy.test.ts',
    'tests/provider-boundary-fuzz.test.ts',
  ] },
  { id: 'DATABASE_CHAOS_AND_AMBIGUOUS_COMMIT', testFiles: [
    'tests/runtime-postgres-client.test.ts', 'tests/runtime-postgres-pool.test.ts',
    'tests/postgres-execution-commit-reconciliation.test.ts', 'tests/database-resilient-observation-cycle.test.ts',
  ] },
  { id: 'Q_H_D_A_C_ENGINEERING', testFiles: [
    'tests/theta-q-contract.test.ts', 'tests/hold-strike-shadow-candidate-generator.test.ts',
    'tests/defined-risk-locked-plan.test.ts', 'tests/defined-risk-management-replay.test.ts',
    'tests/canonical-strategy-frontier.test.ts', 'tests/strategy-account-policy-compatibility.test.ts',
    'tests/recovery-covered-call-cohort.test.ts', 'tests/covered-call-lattice.test.ts',
  ] },
  { id: 'DECISION_BRAIN_COMPARATOR_AND_WAIT', testFiles: [
    'tests/strategy-router-contract.test.ts', 'tests/regime-contract.test.ts',
    'tests/adaptive-decision-brain.test.ts', 'tests/common-horizon-economics.test.ts',
    'tests/cross-strategy-common-horizon-contract.test.ts',
  ] },
  { id: 'AEGIS_AND_SIZING', testFiles: [
    'tests/aegis-alpaca-iv-stress.test.ts', 'tests/aegis-iv-stress.test.ts',
    'tests/aegis-spread-stress.test.ts', 'tests/aegis-stress-baseline-maturity.test.ts',
    'tests/master-paper-plan-assembly.test.ts', 'tests/new-risk-orchestrator.test.ts',
  ] },
  { id: 'MANAGEMENT_LIFECYCLE_AND_ACCOUNTING', testFiles: [
    'tests/production-paper-management-candidate-source.test.ts', 'tests/paper-bootstrap-management-policy.test.ts',
    'tests/management-action-frontier.test.ts', 'tests/management-invariants.test.ts',
    'tests/assignment-orchestrator.test.ts', 'tests/covered-call-orchestrator.test.ts',
    'tests/whole-chain-economics.test.ts', 'tests/p2g-lifecycle-simulator.test.ts',
  ] },
  { id: 'OUTCOMES_EXPERIMENTS_AND_GOVERNANCE', testFiles: [
    'tests/profit-taking-experiment.test.ts', 'tests/profit-taking-replay.test.ts',
    'tests/loss-roll-experiment.test.ts', 'tests/loss-state-vector.test.ts',
    'tests/outcome-resolver.test.ts', 'tests/resolved-outcome-engine.test.ts',
    'tests/theta-entry-outcome-dataset.test.ts', 'tests/theta-entry-model-readiness.test.ts',
    'tests/managed-episode-outcome-distribution.test.ts', 'tests/managed-episode-path-features.test.ts',
    'tests/whole-chain-component-evidence.test.ts', 'tests/empirical-policy-promotion.test.ts',
    'tests/management-policy-promotion-ladder.test.ts',
  ] },
  { id: 'RESTART_LEASE_AND_STORAGE', testFiles: [
    'tests/resident-worker.test.ts', 'tests/runtime-request-lease.test.ts', 'tests/local-worker-auto-export.test.ts',
    'tests/local-research-history-spool.test.ts', 'tests/local-research-archive-health.test.ts',
    'tests/canonical-frontier-local-archive.test.ts',
  ] },
] as const;

export const expectedPremarketCertificationGroupIds = premarketCertificationGroups.map((group) => group.id);
