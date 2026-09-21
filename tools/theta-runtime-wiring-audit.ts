import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

type Classification = 'CANONICAL_LIVE_AUTHORITY' | 'CANONICAL_LIVE_SUPPORT' | 'PAPER_ONLY_AUTHORITY'
  | 'PAPER_ONLY_SUPPORT' | 'SHADOW_EVIDENCE' | 'RESEARCH_ONLY' | 'DORMANT';
type Effect = 'SELECTED_CANDIDATE' | 'QUANTITY' | 'AEGIS' | 'BROKER_ORDER';
interface ComponentSpec { component: string; definitions: readonly string[]; classification: Classification;
  effects: readonly Effect[]; decisionAuthority?: boolean; brokerAuthority?: boolean }

const specs: readonly ComponentSpec[] = [
  { component: 'THETA-Q', definitions: ['bots/theta/quant/models/theta_q_baseline.py', 'src/theta/theta-q-contract.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE', 'QUANTITY'] },
  { component: 'THETA-H', definitions: ['bots/theta/quant/models/theta_h_baseline.py'], classification: 'SHADOW_EVIDENCE', effects: [] },
  { component: 'THETA-R', definitions: ['bots/theta/quant/models/regime_v0.py', 'src/theta/regime-contract.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'THETA-A', definitions: ['bots/theta/quant/models/assignment_model.py', 'src/theta/assignment-orchestrator.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: [] },
  { component: 'THETA-C', definitions: ['bots/theta/quant/models/covered_call_ranker.py', 'src/theta/covered-call-orchestrator.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: [] },
  { component: 'THETA-D', definitions: ['src/research/defined-risk-economics.ts'], classification: 'RESEARCH_ONLY', effects: [] },
  { component: 'ownership_v0', definitions: ['bots/theta/quant/models/ownership_v0.py', 'src/theta/ownership-contract.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'strategy_router', definitions: ['bots/theta/quant/models/strategy_router.py', 'src/theta/strategy-router-contract.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'theta_q_lattice', definitions: ['bots/theta/quant/models/theta_q_lattice.py'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'opportunity_frontier', definitions: ['bots/theta/quant/models/opportunity_frontier.py', 'src/theta/opportunity-frontier-contract.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'pareto_frontier', definitions: ['bots/theta/quant/models/pareto_frontier.py', 'src/theta/pareto-frontier-contract.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'canonical-strategy-frontier', definitions: ['src/theta/canonical-strategy-frontier.ts', 'src/theta/canonical-decision-authority.ts'], classification: 'CANONICAL_LIVE_AUTHORITY', effects: ['SELECTED_CANDIDATE', 'QUANTITY'], decisionAuthority: true },
  { component: 'AEGIS', definitions: ['bots/theta/quant/models/aegis.py', 'src/theta/aegis-contract.ts', 'src/theta/account-exposure.ts'], classification: 'CANONICAL_LIVE_AUTHORITY', effects: ['AEGIS', 'QUANTITY'] },
  { component: 'sizing', definitions: ['bots/theta/quant/models/sizing.py', 'src/theta/sizing-contract.ts'], classification: 'CANONICAL_LIVE_AUTHORITY', effects: ['QUANTITY'] },
  { component: 'execution quality', definitions: ['bots/theta/quant/models/execution_quality.py', 'src/theta/execution-quality-contract.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: ['BROKER_ORDER'] },
  { component: 'FusionSnapshot', definitions: ['src/market/fusion-snapshot.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'universe discovery', definitions: ['src/theta/universe-discovery.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'underlying ranking', definitions: ['src/theta/universe-policy.ts', 'src/theta/underlying-selector-contract.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'Optionomics feature engine', definitions: ['src/theta/optionomics-feature-engine.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: ['SELECTED_CANDIDATE'] },
  { component: 'Alpaca provider', definitions: ['src/theta/alpaca-provider.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: ['BROKER_ORDER'] },
  { component: 'event-state', definitions: ['src/theta/event-risk-state.ts'], classification: 'SHADOW_EVIDENCE', effects: [] },
  { component: 'management-action-frontier', definitions: ['src/theta/management-action-frontier.ts'], classification: 'PAPER_ONLY_AUTHORITY', effects: ['BROKER_ORDER'] },
  { component: 'management policy', definitions: ['src/theta/paper-bootstrap-management-policy.ts', 'src/theta/promoted-management-policy-provider.ts'], classification: 'PAPER_ONLY_AUTHORITY', effects: ['BROKER_ORDER'] },
  { component: 'assignment', definitions: ['src/theta/assignment-orchestrator.ts', 'src/execution/broker-lifecycle-application.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: ['BROKER_ORDER'] },
  { component: 'expiry', definitions: ['src/execution/broker-fill-lifecycle-router.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: ['BROKER_ORDER'] },
  { component: 'recovery', definitions: ['src/theta/recovery-orchestrator.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: ['BROKER_ORDER'] },
  { component: 'covered calls', definitions: ['src/theta/covered-call-orchestrator.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: ['BROKER_ORDER'] },
  { component: 'roll handling', definitions: ['src/theta/roll-incremental-utility.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: ['BROKER_ORDER'] },
  { component: 'call-away', definitions: ['src/execution/broker-fill-lifecycle-router.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: [] },
  { component: 'whole-chain ledger', definitions: ['src/theta/whole-chain-economics.ts', 'src/theta/whole-chain-component-evidence.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: [] },
  { component: 'capital-days', definitions: ['src/research/portfolio-capital-analytics.ts'], classification: 'RESEARCH_ONLY', effects: [] },
  { component: 'TCA', definitions: ['src/execution/transaction-cost-analysis.ts', 'src/execution/confirmed-fill-tca.ts'], classification: 'SHADOW_EVIDENCE', effects: [] },
  { component: 'outcome labels', definitions: ['src/research/r6-outcome-labels.ts', 'src/research/resolved-outcome-engine.ts'], classification: 'SHADOW_EVIDENCE', effects: [] },
  { component: 'R6 exports', definitions: ['src/research/postgres-dataset-export.ts'], classification: 'RESEARCH_ONLY', effects: [] },
  { component: 'walk-forward', definitions: ['bots/theta/quant/research/validation.py'], classification: 'RESEARCH_ONLY', effects: [] },
  { component: 'DSR', definitions: ['bots/theta/quant/research/selection_bias.py'], classification: 'RESEARCH_ONLY', effects: [] },
  { component: 'PBO', definitions: ['bots/theta/quant/research/selection_bias.py'], classification: 'RESEARCH_ONLY', effects: [] },
  { component: 'ablation', definitions: ['bots/theta/quant/research/ablation.py'], classification: 'RESEARCH_ONLY', effects: [] },
  { component: 'promotion framework', definitions: ['src/theta/empirical-policy-promotion.ts', 'src/theta/management-policy-promotion-ladder.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: [] },
  { component: 'resident worker', definitions: ['src/worker/resident-worker.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: ['BROKER_ORDER'] },
  { component: 'autonomous runtime', definitions: ['src/theta/autonomous-runtime.ts'], classification: 'PAPER_ONLY_AUTHORITY', effects: ['BROKER_ORDER'] },
  { component: 'reconciliation', definitions: ['src/execution/broker-reconciliation-worker.ts', 'src/execution/lifecycle-reconciliation.ts'], classification: 'PAPER_ONLY_AUTHORITY', effects: ['BROKER_ORDER'] },
  { component: 'action-plan assembly', definitions: ['src/execution/master-paper-plan-assembly.ts'], classification: 'PAPER_ONLY_AUTHORITY', effects: ['BROKER_ORDER'] },
  { component: 'paper order coordinator', definitions: ['src/execution/paper-order-coordinator.ts'], classification: 'PAPER_ONLY_AUTHORITY', effects: ['BROKER_ORDER'], brokerAuthority: true },
  { component: 'Postgres persistence', definitions: ['src/theta/postgres-theta-cycle-store.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: [] },
  { component: 'Aiven authority', definitions: ['src/database/target-validation.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: [] },
  { component: 'Neon archive', definitions: ['src/database/legacy-recovery-inventory.ts'], classification: 'RESEARCH_ONLY', effects: [] },
  { component: 'local receipts', definitions: ['src/research/p2g-receipt-store.ts'], classification: 'PAPER_ONLY_SUPPORT', effects: [] },
  { component: 'Vercel web/control plane', definitions: ['src/app.ts', 'src/index.ts'], classification: 'CANONICAL_LIVE_SUPPORT', effects: [] },
];

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const absolute = path.join(root, entry);
    const relative = path.relative(process.cwd(), absolute).replaceAll('\\', '/');
    if (['node_modules', 'dist', '.git', '__pycache__', '.venv'].some((part) => relative.split('/').includes(part))) continue;
    if (statSync(absolute).isDirectory()) result.push(...sourceFiles(absolute));
    else if (/\.(ts|py|tsx)$/.test(entry)) result.push(relative);
  }
  return result;
}

// Generated releases, local evidence, dependency caches and downloaded worktrees are
// deliberately outside this static source inventory. A text mention is not a call path.
const files = ['src', 'bots', 'api']
  .filter((directory) => existsSync(path.join(process.cwd(), directory)))
  .flatMap((directory) => sourceFiles(path.join(process.cwd(), directory)));
const contents = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const testFiles = existsSync(path.join(process.cwd(), 'tests'))
  ? sourceFiles(path.join(process.cwd(), 'tests')) : [];
const testContents = new Map(testFiles.map((file) => [file, readFileSync(file, 'utf8')]));
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const rows = specs.map((spec) => {
  const definedIn = spec.definitions.filter((file) => existsSync(path.join(process.cwd(), file)));
  const importTokens = definedIn.map((file) => path.basename(file).replace(/\.(ts|py|tsx)$/, '').replaceAll('_', '-'));
  const textualReferences = files.filter((file) => !definedIn.includes(file)
    && importTokens.some((token) => (contents.get(file) ?? '').replaceAll('_', '-').includes(token)));
  const testReferences = testFiles.filter((file) => importTokens.some((token) =>
    (testContents.get(file) ?? '').replaceAll('_', '-').includes(token)));
  return { component: spec.component, version: { sourceRevision, contractVersion: null },
    declaredClassification: definedIn.length === 0 ? 'DORMANT' as const : spec.classification,
    definedIn, textualReferences, testReferences, referenceEvidence: 'TEXT_MATCH_ONLY' as const,
    runtimeImported: 'UNVERIFIED_STATIC_SCAN' as const,
    runtimeReachability: 'UNVERIFIED_STATIC_SCAN' as const,
    providerDependency: 'NOT_TRACED_BY_STATIC_SCAN' as const,
    databaseDependency: 'NOT_TRACED_BY_STATIC_SCAN' as const,
    currentEvidenceStatus: 'SOURCE_PRESENT_NOT_RUNTIME_PROOF' as const,
    knownBlockers: ['DYNAMIC_IMPORT_AND_DECISION_TRACE_REQUIRED'],
    declaredCanAffectSelectedCandidate: spec.effects.includes('SELECTED_CANDIDATE'),
    declaredCanAffectQuantity: spec.effects.includes('QUANTITY'), declaredCanAffectAegis: spec.effects.includes('AEGIS'),
    declaredCanAffectBrokerOrder: spec.effects.includes('BROKER_ORDER'),
    declaredDecisionAuthority: spec.decisionAuthority === true,
    declaredBrokerAuthority: spec.brokerAuthority === true };
});
const decisionAuthorities = rows.filter((row) => row.declaredDecisionAuthority);
const brokerAuthorities = rows.filter((row) => row.declaredBrokerAuthority);
if (decisionAuthorities.length !== 1 || decisionAuthorities[0]?.definedIn.length === 0) {
  throw new Error(`Expected exactly one defined canonical decision authority, found ${decisionAuthorities.length}`);
}
if (brokerAuthorities.length !== 1 || brokerAuthorities[0]?.definedIn.length === 0) {
  throw new Error(`Expected exactly one defined broker mutation authority, found ${brokerAuthorities.length}`);
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 'theta-runtime-static-inventory-v3', generatedAt: new Date().toISOString(), sourceRevision,
  canonicalDecisionAuthority: decisionAuthorities[0]?.component,
  canonicalBrokerMutationAuthority: brokerAuthorities[0]?.component, components: rows }, null, 2)}\n`);
