export const premarketCertificationVersion = 'theta-premarket-certification-v1' as const;

export interface PremarketCertificationGroup {
  readonly id: string;
  readonly testFiles: readonly string[];
}

export const premarketCertificationGroups: readonly PremarketCertificationGroup[] = [
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
  { id: 'RESTART_LEASE_AND_STORAGE', testFiles: [
    'tests/resident-worker.test.ts', 'tests/runtime-request-lease.test.ts', 'tests/local-worker-auto-export.test.ts',
    'tests/local-research-history-spool.test.ts', 'tests/local-research-archive-health.test.ts',
    'tests/canonical-frontier-local-archive.test.ts',
  ] },
] as const;

export const expectedPremarketCertificationGroupIds = premarketCertificationGroups.map((group) => group.id);
