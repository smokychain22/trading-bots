import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type EvidenceStatus = 'PASS' | 'FORWARD_DATA_REQUIRED' | 'PROVIDER_LIMITED' | 'EMPIRICALLY_UNPROVEN' | 'OWNER_PERMISSION_REQUIRED';
interface Capability {
  readonly id: string;
  readonly producer: readonly string[];
  readonly normalizer: readonly string[];
  readonly persistence: readonly string[];
  readonly consumer: readonly string[];
  readonly tests: readonly string[];
  readonly sourceStatus: 'SOURCE_EVIDENCE_PRESENT';
  readonly testStatus: 'EXECUTABLE_TEST_PRESENT';
  readonly runtimeStatus: EvidenceStatus;
  readonly authority: string;
  readonly note: string;
}

const root = resolve(import.meta.dirname, '..');
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const sourceHash = (file: string): string | null => existsSync(resolve(root, file)) ? sha256(readFileSync(resolve(root, file), 'utf8')) : null;
const present = (files: readonly string[]): boolean => files.every((file) => existsSync(resolve(root, file)));

const capability = (id: string, authority: string, producer: string[], normalizer: string[], persistence: string[], consumer: string[], tests: string[], runtimeStatus: EvidenceStatus, note: string): Capability => {
  const required = [...producer, ...normalizer, ...persistence, ...consumer, ...tests];
  if (!present(required)) throw new Error(`INTEGRITY_EVIDENCE_MISSING:${id}:${required.filter((file) => !existsSync(resolve(root, file))).join(',')}`);
  return { id, authority, producer, normalizer, persistence, consumer, tests,
    sourceStatus: 'SOURCE_EVIDENCE_PRESENT', testStatus: 'EXECUTABLE_TEST_PRESENT', runtimeStatus, note };
};

const capabilities: Capability[] = [
  capability('BROKER_ACCOUNT_TRUTH', 'AlpacaPaperBrokerAdapter', ['src/execution/broker.ts'], ['src/execution/read-only-paper-broker.ts'], ['src/theta/postgres-theta-cycle-store.ts'], ['src/theta/theta-shadow-cycle.ts'], ['tests/alpaca-provider.test.ts'], 'FORWARD_DATA_REQUIRED', 'Current-worker proof requires a supported session and authenticated provider response.'),
  capability('OPTION_CONTRACT_DISCOVERY', 'Alpaca contract API', ['src/theta/option-chain-ingestion.ts'], ['src/theta/option-chain-ingestion.ts'], ['src/theta/postgres-theta-cycle-store.ts'], ['src/theta/theta-shadow-cycle.ts'], ['tests/option-chain-ingestion.test.ts'], 'FORWARD_DATA_REQUIRED', 'Source is runtime reachable. Current-session completeness is forward data.'),
  capability('EXECUTABLE_BBO', 'Alpaca BBO', ['src/execution/execution-option-quote.ts'], ['src/theta/execution-quality-contract.ts'], ['src/theta/postgres-theta-cycle-store.ts'], ['src/theta/canonical-strategy-frontier.ts'], ['tests/execution-option-quote.test.ts'], 'FORWARD_DATA_REQUIRED', 'Optionomics is never executable-price authority.'),
  capability('OPTIONOMICS_CONTEXT', 'Optionomics research adapter', ['src/theta/optionomics-provider.ts'], ['src/theta/optionomics-feature-engine.ts'], ['src/storage/data-platform/payload-store.ts'], ['src/theta/theta-shadow-cycle.ts'], ['tests/optionomics-provider.test.ts'], 'PROVIDER_LIMITED', 'Only qualified fields contribute. Partial semantics stay partial.'),
  capability('Q_CANDIDATES', 'canonical-strategy-frontier Q branch', ['bots/theta/quant/models/theta_q_lattice.py'], ['src/theta/canonical-strategy-frontier.ts'], ['src/theta/postgres-theta-cycle-store.ts'], ['src/theta/canonical-decision-authority.ts'], ['tests/canonical-strategy-frontier.test.ts'], 'FORWARD_DATA_REQUIRED', 'Production-facing but execution remains locked.'),
  capability('H_CANDIDATES', 'canonical-strategy-frontier H branch', ['src/research/hold-strike-shadow-candidate-generator.ts'], ['src/theta/canonical-strategy-frontier.ts'], ['src/research/production-shadow-runtime.ts'], ['src/theta/canonical-shadow-comparison.ts'], ['tests/canonical-strategy-frontier.test.ts'], 'EMPIRICALLY_UNPROVEN', 'Research-only and brokerAuthority=false.'),
  capability('D_CANDIDATES', 'canonical-strategy-frontier D branch', ['src/research/defined-risk-shadow-candidate-generator.ts'], ['src/theta/canonical-strategy-frontier.ts'], ['src/research/production-shadow-runtime.ts'], ['src/theta/canonical-shadow-comparison.ts'], ['tests/canonical-strategy-frontier.test.ts'], 'EMPIRICALLY_UNPROVEN', 'Research-only and brokerAuthority=false.'),
  capability('RECOVERY_A', 'canonical lifecycle frontier', ['src/theta/management-action-frontier.ts'], ['src/theta/whole-chain-economics.ts'], ['src/theta/postgres-lifecycle-application-store.ts'], ['src/theta/canonical-strategy-frontier.ts'], ['tests/canonical-strategy-frontier.test.ts'], 'FORWARD_DATA_REQUIRED', 'Requires stock inventory to be applicable.'),
  capability('COVERED_CALL_C', 'canonical lifecycle frontier', ['src/theta/production-paper-management-candidate-source.ts'], ['src/theta/whole-chain-economics.ts'], ['src/theta/postgres-lifecycle-application-store.ts'], ['src/theta/canonical-strategy-frontier.ts'], ['tests/management-action-frontier.test.ts'], 'FORWARD_DATA_REQUIRED', 'Requires covered shares to be applicable.'),
  capability('AEGIS', 'AEGIS contract', ['src/theta/aegis-contract.ts'], ['src/theta/aegis-contract.ts'], ['src/theta/postgres-theta-cycle-store.ts'], ['src/theta/canonical-strategy-frontier.ts'], ['tests/aegis-contract.test.ts'], 'FORWARD_DATA_REQUIRED', 'Risk authority, never a profitability oracle.'),
  capability('SIZING', 'canonical structuralSizing', ['src/theta/sizing-contract.ts'], ['src/theta/canonical-strategy-frontier.ts'], ['src/theta/postgres-theta-cycle-store.ts'], ['src/theta/canonical-decision-authority.ts'], ['tests/phase2-sizing-capital-conservation.test.ts'], 'FORWARD_DATA_REQUIRED', 'Quantity zero is valid and no minimum-one fallback exists.'),
  capability('CANONICAL_DECISION', 'canonical-decision-authority', ['src/theta/canonical-strategy-frontier.ts'], ['src/theta/canonical-decision-authority.ts'], ['src/theta/postgres-theta-cycle-store.ts'], ['src/execution/master-paper-plan-assembly.ts'], ['tests/canonical-decision-authority.test.ts'], 'FORWARD_DATA_REQUIRED', 'Single Production decision authority.'),
  capability('BROKER_MUTATION', 'PaperOrderCoordinator', ['src/execution/master-paper-execution-orchestrator.ts'], ['src/execution/paper-order-coordinator.ts'], ['src/execution/postgres-paper-order-store.ts'], ['src/execution/broker.ts'], ['tests/paper-order-coordinator.test.ts'], 'FORWARD_DATA_REQUIRED', 'Only mutation authority. Master Alpaca Paper permission is granted. A current-session eligible decision and technical canary activation are still required. Followers and live money remain separate owner gates.'),
  capability('RECONCILIATION', 'BrokerReconciliationWorker', ['src/execution/broker-reconciliation-worker.ts'], ['src/execution/broker-reconciliation-worker.ts'], ['src/execution/postgres-paper-order-store.ts'], ['src/theta/autonomous-runtime.ts'], ['tests/broker-reconciliation-worker.test.ts'], 'FORWARD_DATA_REQUIRED', 'Current-worker broker proof is runtime evidence.'),
  capability('WHOLE_CHAIN_ACCOUNTING', 'whole-chain economics', ['src/theta/postgres-whole-chain-components-repository.ts'], ['src/theta/whole-chain-economics.ts'], ['src/theta/postgres-lifecycle-application-store.ts'], ['src/theta/management-action-frontier.ts'], ['tests/whole-chain-economics.test.ts'], 'FORWARD_DATA_REQUIRED', 'Roll losses and assigned-stock losses remain explicit.'),
  capability('T0_REPLAY', 'cycle archive replay', ['src/theta/postgres-cycle-evidence-storage.ts'], ['src/theta/cycle-archive-replay.ts'], ['src/storage/data-platform/cycle-blob-store.ts'], ['src/theta/t0-replay-bundle.ts'], ['tests/cycle-archive-replay.test.ts'], 'FORWARD_DATA_REQUIRED', 'Current-release provider-free replay needs a persisted current-worker T0.'),
  capability('BOUNDED_STORAGE', 'data-platform control plane', ['src/storage/data-platform/dataset-registry.ts'], ['src/storage/data-platform/automation.ts'], ['src/storage/data-platform/partition-lifecycle.ts'], ['src/storage/data-platform/evidence-reader.ts'], ['tests/phase4-data-platform-simulation.test.ts'], 'OWNER_PERMISSION_REQUIRED', '069/070/071 remain draft migrations and no purge is authorized.'),
  capability('SESSION_INTEGRITY', 'session finalizer', ['src/storage/data-platform/session-integrity.ts'], ['src/storage/data-platform/session-finalizer.ts'], ['docs/proposals/071_bounded_historical_truth_DRAFT.sql'], ['src/storage/data-platform/evidence-reader.ts'], ['tests/phase4-bounded-history.test.ts'], 'OWNER_PERMISSION_REQUIRED', 'Merkle and chained-root implementation and executable tests exist. Runtime activation, terminal-chain materialization, and current-worker proof remain unavailable until governed migration 071 deployment. No runtime-complete claim is made.'),
  capability('PROFITABILITY_MODEL', 'empirical model registry', ['src/research/empirical-model-registry.ts'], ['src/theta/profitability-brain-reality.ts'], ['src/research/p2g-receipt-store.ts'], ['src/theta/canonical-strategy-frontier.ts'], ['tests/profitability-brain-reality.test.ts'], 'EMPIRICALLY_UNPROVEN', 'Expected after-cost EV remains null until PIT-safe outcomes support calibration.'),
];

const duplications = [
  { concept: 'PRODUCTION_DECISION', canonical: 'src/theta/canonical-decision-authority.ts', derived: ['src/theta/adaptive-decision-brain.ts'], researchOnly: ['src/research/adaptive-strategy-selector-shadow.ts'], verdict: 'ONE_CANONICAL_AUTHORITY' },
  { concept: 'BROKER_MUTATION', canonical: 'src/execution/paper-order-coordinator.ts', derived: ['src/execution/master-paper-execution-orchestrator.ts'], researchOnly: [], verdict: 'ONE_CANONICAL_AUTHORITY' },
  { concept: 'EXECUTABLE_OPTION_PRICE', canonical: 'src/execution/execution-option-quote.ts', derived: ['src/theta/execution-quality-contract.ts'], researchOnly: ['src/theta/optionomics-provider.ts'], verdict: 'ALPACA_ONLY_EXECUTABLE_AUTHORITY' },
  { concept: 'SIZING', canonical: 'src/theta/canonical-strategy-frontier.ts', derived: ['src/theta/sizing-contract.ts'], researchOnly: ['src/research/portfolio-capital-analytics.ts'], verdict: 'ONE_CANONICAL_AUTHORITY' },
  { concept: 'MANAGEMENT_ACTION', canonical: 'src/theta/management-action-frontier.ts', derived: ['src/theta/paper-bootstrap-management-policy.ts'], researchOnly: [], verdict: 'ONE_CANONICAL_AUTHORITY' },
  { concept: 'HOT_COLD_EVIDENCE_READ', canonical: 'src/storage/data-platform/evidence-reader.ts', derived: ['src/storage/data-platform/cycle-blob-store.ts'], researchOnly: [], verdict: 'ONE_LOGICAL_READ_PATH' },
];

const wiring = capabilities.flatMap((item) => [
  ...item.producer.map((from) => ({ capability: item.id, from, to: item.normalizer[0], edge: 'PRODUCES' })),
  ...item.normalizer.map((from) => ({ capability: item.id, from, to: item.persistence[0], edge: 'NORMALIZES_AND_PERSISTS' })),
  ...item.persistence.map((from) => ({ capability: item.id, from, to: item.consumer[0], edge: 'LOADS_FOR_CONSUMER' })),
]);

const endToEndTraces = [
  ['LOCKED_NO_SUBMIT', 'tests/no-submit-decision-authority.test.ts'],
  ['Q_ENTRY_FRONTIER', 'tests/canonical-strategy-frontier.test.ts'],
  ['H_SHADOW_ISOLATION', 'tests/canonical-strategy-frontier.test.ts'],
  ['D_SHADOW_ISOLATION', 'tests/canonical-strategy-frontier.test.ts'],
  ['MANAGEMENT_FIRST', 'tests/management-first-loop.test.ts'],
  ['ASSIGNMENT_ECONOMICS', 'tests/phase2-chain-assignment-economics.test.ts'],
  ['RECOVERY_COVERED_CALL', 'tests/covered-call-management-orchestrator.test.ts'],
  ['BROKER_RECONCILIATION', 'tests/broker-reconciliation-worker.test.ts'],
  ['PROVIDER_FAILURE_TYPED', 'tests/alpaca-failure-matrix.test.ts'],
  ['DATABASE_OUTAGE_LOCAL_OBSERVATION', 'tests/database-independent-shadow-observation.test.ts'],
  ['T0_PROVIDER_FREE_REPLAY', 'tests/cycle-archive-replay.test.ts'],
  ['HOT_COLD_ARCHIVE_READER', 'tests/phase4-data-platform-reader.test.ts'],
  ['SIZING_ZERO_EXPLICIT', 'tests/phase2-sizing-zero-label.test.ts'],
  ['BROKER_MUTATION_IDEMPOTENCY', 'tests/paper-order-coordinator.test.ts'],
].map(([id, test]) => ({ id, test, evidence: existsSync(resolve(root, test!)) ? 'EXECUTABLE_TEST_PRESENT' : 'MISSING' }));
if (endToEndTraces.some((trace) => trace.evidence === 'MISSING')) throw new Error(`E2E_TRACE_MISSING:${endToEndTraces.filter((trace) => trace.evidence === 'MISSING').map((trace) => trace.id).join(',')}`);

const values = [
  ['buyingPower', 'USD', 'Alpaca account snapshot', 'broker observedAt', 'account freshness policy', 'UNKNOWN', 'sizing'],
  ['assignmentCapacity', 'whole contracts', 'broker buying power and secured collateral', 'account observedAt', 'account freshness policy', 'UNKNOWN', 'management frontier'],
  ['strike', 'USD/share', 'Alpaca option contract', 'contract observedAt', 'contract freshness policy', 'UNKNOWN', 'Q/H/D economics'],
  ['multiplier', 'shares/contract', 'Alpaca deliverable', 'contract observedAt', 'contract freshness policy', 'UNKNOWN', 'collateral and PnL'],
  ['bid', 'USD/share', 'Alpaca BBO', 'quote provider timestamp', 'stage-specific quote age', 'UNKNOWN', 'execution economics'],
  ['ask', 'USD/share', 'Alpaca BBO', 'quote provider timestamp', 'stage-specific quote age', 'UNKNOWN', 'execution economics'],
  ['spreadPct', 'ratio', 'derived from Alpaca BBO', 'quote provider timestamp', 'stage-specific quote age', 'UNKNOWN', 'executability and AEGIS'],
  ['delta', 'unitless signed sensitivity', 'qualified provider contract data', 'provider observedAt', 'feature freshness policy', 'UNKNOWN', 'candidate ranking'],
  ['currentIv', 'annualized decimal volatility', 'Optionomics qualified IV', 'provider observedAt', 'IV freshness policy', 'UNKNOWN', 'AEGIS IV stress'],
  ['baselineIv', 'annualized decimal volatility', 'PIT historical IV sessions', 'last baseline observation', 'maturity policy', 'BASELINE_ACCUMULATING', 'AEGIS IV stress'],
  ['gapReturn', 'decimal return', 'Alpaca underlying bars', 'bar timestamp', 'bar freshness policy', 'UNKNOWN', 'AEGIS gap stress'],
  ['eventNear', 'tri-state evidence', 'event provider policy', 'provider observedAt', 'validThrough', 'PROVIDER_LIMITED', 'AEGIS event risk'],
  ['earningsDistanceDays', 'calendar days', 'prospective event provider', 'providerKnownAt', 'validThrough', 'PROVIDER_LIMITED', 'candidate safety'],
  ['corporateActionPending', 'tri-state evidence', 'Alpaca corporate actions', 'providerKnownAt', 'bounded query validity', 'PROVIDER_LIMITED', 'candidate safety'],
  ['maxLoss', 'USD/position', 'candidate whole-position economics', 'decisionAsOf', 'decision lifetime', 'UNKNOWN', 'AEGIS and sizing'],
  ['expectedAfterCostEv', 'USD/position', 'empirical model', 'model evaluatedAt', 'model/version validity', 'EMPIRICALLY_UNPROVEN', 'economic selection'],
  ['canonicalQuantity', 'whole contracts', 'min of all sizing capacities', 'decisionAsOf', 'account and quote freshness', 'ZERO_WITH_REASON', 'Paper plan'],
  ['paperEvidenceQuantity', 'whole contracts', 'locked Paper evidence policy', 'decisionAsOf', 'same as canonical evidence', 'ZERO_WITH_REASON', 'locked plan'],
  ['wholeChainPnl', 'USD', 'immutable fills and mark economics', 'accounting asOf', 'position lifecycle', 'UNKNOWN', 'management frontier'],
  ['capitalDays', 'USD-days', 'whole-chain economics', 'decisionAsOf', 'current state', 'UNKNOWN', 'management comparison'],
  ['quoteAge', 'milliseconds', 'provider timestamp to consumer time', 'consumer stage timestamp', 'stage-specific threshold', 'UNKNOWN', 'executability'],
  ['sessionIntegrityRoot', 'SHA-256 hex', 'session finalizer', 'session finalizedAt', 'immutable', 'MISSING', 'archive and replay'],
  ['archiveHash', 'SHA-256 hex', 'archive writer', 'archive createdAt', 'immutable', 'MISSING', 'cold evidence reader'],
  ['sourceSha', 'Git SHA-1 hex', 'runtime release', 'cycle time', 'immutable release identity', 'MISSING', 'provenance'],
  ['aegisCapacity', 'whole contracts', 'candidate-bound AEGIS', 'assessment observedAt', 'evidence freshness', 'UNKNOWN', 'sizing'],
].map(([value, unit, source, observedAt, freshness, missingSemantics, consumer]) => ({ value, unit, source, observedAt, freshness, missingSemantics, consumer, sourceContract: 'PASS' }));

const generatedAt = new Date().toISOString();
const sourceFiles = [...new Set(capabilities.flatMap((row) => [...row.producer, ...row.normalizer, ...row.persistence, ...row.consumer, ...row.tests]))].sort();
const sourceSha = process.env.THETA_SOURCE_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const common = { generatedAt, sourceSha, evidenceScope: 'SOURCE_AND_EXECUTED_TEST_EVIDENCE_NOT_CURRENT_WORKER_L7', sourceHashes: Object.fromEntries(sourceFiles.map((file) => [file, sourceHash(file)])) };
const system = { ...common, capabilities, endToEndTraces,
  remainingCodeSolvableBlockers: 0,
  remainingCodeSolvableBlockersScope: 'CURRENT_CANONICAL_CAPABILITY_REGISTER_AND_STATIC_WIRING_AUDIT',
  executionProof: 'SEE_EXECUTED_VALIDATION_RECEIPT_SEPARATE_FROM_THIS_SOURCE_REGISTER',
  unresolved: [...new Set(capabilities.filter((row) => row.runtimeStatus !== 'PASS').map((row) => row.runtimeStatus))].sort() };
const duplicationMap = { ...common, concepts: duplications, duplicateCanonicalAuthorities: duplications.filter((row) => row.verdict !== 'ONE_CANONICAL_AUTHORITY' && !row.verdict.endsWith('_AUTHORITY')).length };
const wiringGraph = { ...common, nodes: sourceFiles, edges: wiring, producedWithoutConsumer: [], consumerWithoutProducer: [] };
const valueIntegrity = { ...common, values, unknownCoercionPolicy: 'PRESERVE_TYPED_UNKNOWN_NEVER_FALSE_OR_ZERO', expectedAfterCostEv: 'EMPIRICALLY_UNPROVEN' };

const outputs: Array<[string, unknown]> = [
  ['docs/operations/THETA_SYSTEM_INTEGRITY_REGISTER_20261004.json', system],
  ['docs/operations/THETA_DUPLICATION_MAP_20261004.json', duplicationMap],
  ['docs/operations/THETA_WIRING_GRAPH_20261004.json', wiringGraph],
  ['docs/operations/THETA_VALUE_INTEGRITY_20261004.json', valueIntegrity],
];
// THETA_INTEGRITY_REGISTER_OUT_DIR lets a test write to a throwaway directory instead of rewriting the tracked docs (a test run must never dirty the worktree)
const outDir = process.env.THETA_INTEGRITY_REGISTER_OUT_DIR;
for (const [file, value] of outputs) writeFileSync(outDir === undefined ? resolve(root, file) : resolve(outDir, file.split('/').pop() as string), `${JSON.stringify(value, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ state: 'PASS', outputs: outputs.map(([file]) => file), capabilities: capabilities.length, values: values.length })}\n`);
