import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 2 management-authority guards. Complements (does not duplicate) tests/architecture-authority-guards.test.ts, which
// already pins: one buildManagementActionFrontier implementation + declared callers, only the PaperOrderCoordinator mutates
// orders, and the execution layer never calls a frontier builder. These additionally pin who may PROPOSE, who may PRICE the
// economics, and that a proposer can never become the final management action.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) return [];
  const path = join(directory, entry);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
});
const rel = (path: string): string => relative(root, path).replaceAll('\\', '/');
const code = (path: string): string => readFileSync(path, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const srcFiles = walk(join(root, 'src'));
const matching = (pattern: RegExp, files: readonly string[] = srcFiles): string[] =>
  files.filter((path) => pattern.test(code(path))).map(rel).sort();

const proposers = [
  // Q (conventional entry), H (hold-strike), D (defined risk) entry / strategy envelope
  'src/theta/theta-q-contract.ts', 'src/theta/new-risk-orchestrator.ts', 'src/theta/strategy-package.ts',
  'src/theta/strategy-decision-envelope.ts', 'src/theta/strategy-evaluation-contract.ts', 'src/theta/strategy-router-contract.ts',
  // A (assignment / recovery)
  'src/theta/assignment-orchestrator.ts', 'src/theta/assignment-assembly.ts', 'src/theta/assignment-contract.ts',
  'src/theta/assignment-utility.ts', 'src/theta/recovery-orchestrator.ts', 'src/theta/recovery-contract.ts', 'src/theta/recovery-state.ts',
  // C (covered call)
  'src/theta/covered-call-lattice.ts', 'src/theta/covered-call-orchestrator.ts', 'src/theta/covered-call-contract.ts',
  // economics helpers a proposer may consume
  'src/theta/roll-incremental-utility.ts', 'src/theta/common-horizon-economics.ts', 'src/theta/loss-state-vector.ts',
  'src/theta/thesis-invalidation.ts',
].filter((path) => existsSync(join(root, path)));

test('AUTHORITY: strategy modules (Q, A, C, H, D) and their economics helpers never import or call the execution layer', () => {
  assert.ok(proposers.length >= 15, 'the proposer set must really exist');
  for (const path of proposers) {
    const text = code(join(root, path));
    assert.doesNotMatch(text, /from\s+['"](?:\.\.?\/)+execution\//, `${path} must not import the execution layer`);
    assert.doesNotMatch(text, /\.\s*(submitOrder|cancelOrder|replaceOrder)\s*\(/, `${path} must not mutate orders`);
    assert.doesNotMatch(text, /PaperOrderCoordinator|AlpacaPaperBrokerAdapter|decideAdaptiveLimit/, `${path} must not touch order authority`);
    assert.doesNotMatch(text, /\bbuildManagementActionFrontier\s*\(/, `${path} must not decide the final management action`);
  }
});

test('AUTHORITY: only the frontier module constructs a ManagementActionFrontier (the sole final management decision object)', () => {
  assert.deepEqual(matching(/contractVersion\s*:\s*managementActionFrontierVersion/), ['src/theta/management-action-frontier.ts']);
  // The only code that may RETURN a policy-evidence object is a ManagementPolicyEvidenceProvider; both are pinned.
  const decisionFiles = srcFiles.filter((path) => /^src\/(theta|execution|worker)\//.test(rel(path)));
  assert.deepEqual(matching(/authority\s*[:=]\s*['"](?:PAPER_BOOTSTRAP_MANAGEMENT_POLICY|EMPIRICALLY_PROMOTED_MANAGEMENT_POLICY)['"]/, decisionFiles),
    ['src/theta/autonomous-runtime.ts', 'src/theta/paper-bootstrap-management-policy.ts', 'src/theta/promoted-management-policy-provider.ts']);
  // ... and only the frontier ever validates and accepts that evidence.
  assert.deepEqual(matching(/MANAGEMENT_POLICY_SELECTION_NOT_ARGMAX/), ['src/theta/management-action-frontier.ts']);
});

test('AUTHORITY: the plan compiler consumes frontier evidence and never re-prices or re-selects economics', () => {
  const compiler = code(join(root, 'src/execution/management-paper-plan-assembly.ts'));
  assert.doesNotMatch(compiler, /forwardRollCashFlow|forwardContinuationCashFlow|evaluateRollCandidates|evaluateAssignmentUtility|buildCommonHorizonComparison|evaluatePaperBootstrapManagementPolicy|sunkRealizedEconomics/);
  assert.doesNotMatch(compiler, /import\s+(?!type\b)[^;]*\bfrom\s+['"][^'"]*management-action-frontier\.js['"]/,
    'only type imports from the frontier: the compiler cannot call it');
  // the open-leg target comes only from the selected action's persisted evidence
  assert.match(compiler, /execution\.targetContract/);
  assert.doesNotMatch(compiler, /rollCandidate|ccCandidate|candidatesFor/);
});

test('AUTHORITY: the execution layer never imports an economics or policy module (it executes bounded plans only)', () => {
  const banned = /from\s+['"][^'"]*\/(?:roll-incremental-utility|assignment-utility|common-horizon-economics|paper-bootstrap-management-policy|shadow-management-policy|promoted-management-policy-provider|covered-call-lattice|recovery-state|thesis-invalidation)\.js['"]/;
  for (const path of walk(join(root, 'src', 'execution'))) {
    assert.doesNotMatch(code(path), banned, `${rel(path)} must not choose economics`);
  }
});

test('AUTHORITY: forward-economics helpers have only the declared policy consumers', () => {
  const importers = (module: string) => matching(new RegExp(`from\\s+['"][^'"]*/${module}\\.js['"]`));
  assert.deepEqual(importers('roll-incremental-utility'), ['src/theta/paper-bootstrap-management-policy.ts']);
  assert.deepEqual(importers('assignment-utility'), ['src/theta/paper-bootstrap-management-policy.ts']);
  const common = importers('common-horizon-economics');
  assert.deepEqual(common.filter((p) => !['src/theta/assignment-utility.ts', 'src/theta/paper-bootstrap-management-policy.ts',
    'src/theta/roll-incremental-utility.ts', 'src/theta/covered-call-lattice.ts'].includes(p)), []);
});

test('AUTHORITY: research challengers and the shadow policy have no path into the final management selection', () => {
  const importers = (module: string) => matching(new RegExp(`from\\s+['"][^'"]*/${module}\\.js['"]`));
  assert.deepEqual(importers('shadow-management-policy'), ['src/theta/autonomous-runtime.ts'],
    'only the runtime may host the shadow store, and it persists shadow evidence for research');
  for (const path of ['src/theta/management-action-frontier.ts', 'src/theta/paper-bootstrap-management-policy.ts',
    'src/theta/promoted-management-policy-provider.ts', 'src/execution/management-paper-plan-assembly.ts']) {
    const text = code(join(root, path));
    assert.doesNotMatch(text, /shadow-management-policy|profit-taking-(experiment|replay)|challengerPolicies|FIXED_\d+/, path);
  }
  // the shadow evidence type itself can never carry an executable decision
  const shadow = code(join(root, 'src/theta/shadow-management-policy.ts'));
  assert.match(shadow, /shadowPreferredAction:\s*null/);
  assert.match(shadow, /productionPolicyEvidence:\s*null/);
  assert.match(shadow, /executionAuthorized:\s*false/);
  assert.match(shadow, /policyReadiness:\s*'NOT_EMPIRICALLY_PROMOTED'/);
  // the runtime reads the shadow store write-only: it never feeds a shadow field into the frontier call
  const runtime = code(join(root, 'src/theta/autonomous-runtime.ts'));
  assert.doesNotMatch(runtime, /buildManagementActionFrontier\s*\([^)]*shadow/i);
  assert.doesNotMatch(runtime, /shadowPreferredAction|challengerPolicies/);
});

test('AUTHORITY: the management policy provider type admits only two authorities, and the empirical one needs an explicit promotion', () => {
  const runtime = code(join(root, 'src/theta/autonomous-runtime.ts'));
  assert.match(runtime, /authority:\s*'PAPER_BOOTSTRAP_MANAGEMENT_POLICY'\s*\|\s*'EMPIRICALLY_PROMOTED_MANAGEMENT_POLICY'/);
  const promoted = code(join(root, 'src/theta/promoted-management-policy-provider.ts'));
  assert.match(promoted, /validateExplicitPromotion\(artifact\)\.length>0\)return null/);
});

const NOW = '2026-09-14T15:00:00.000Z';
test('AUTHORITY: A and C candidates (SELL_STOCK / SELL_CC) are proposals; with held stock the entry frontier selects none of them', () => {
  const contract = normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016C00210000', occSymbol: 'AAPL261016C00210000', optionType: 'CALL',
    strike: 210, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 189.9, underlyingAsk: 190.1,
    underlyingLast: 190, underlyingTimestamp: NOW, bid: 1.2, ask: 1.3, bidSize: 20, askSize: 18, lastTradePrice: 1.25, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS',
    iv: 0.28, delta: 0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: 0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS',
    feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
  }, NOW);
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  const routing = parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 's', timestamp: NOW,
    policyVersion: 'r1', results: families.map((strategyFamily) => ({ strategyFamily, eligible: ['THETA_A', 'THETA_C'].includes(strategyFamily),
      eligibilityState: ['THETA_A', 'THETA_C'].includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test' }], policyVersion: 'r1' })) });
  const frontier = buildCanonicalStrategyFrontier({
    snapshotId: 's', timestamp: NOW, strategyVersion: 'v', contracts: [contract], routing,
    stock: { underlying: 'AAPL', shares: 100, currentPrice: 190, brokerCostBasisPerShare: 195, wholeChainEconomicBasisPerShare: 195 },
    assignmentCapacityQty: 2, buyingPower: 100_000, brokerAllowedQty: 10,
    sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2,
      correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
    aegisNewRiskState: 'ALLOW_FULL', eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
    optionomicsContext: { state: 'UNKNOWN' },
  });
  const proposed = frontier.branches.flatMap((branch) => branch.candidates.map((c) => c.action));
  assert.ok(proposed.some((action) => action === 'SELL_CC' || action === 'SELL_STOCK' || action === 'RECOVERY_WAIT'),
    'A / C do propose candidates');
  assert.equal(frontier.primaryAction, 'MANAGEMENT_AUTHORITY');
  assert.equal(frontier.selectedCandidateId, null, 'no A / C proposal becomes the selection');
  assert.equal(frontier.selectedQuantity, 0);
  assert.equal(frontier.executionAuthorized, false);
  assert.equal(frontier.empiricalEconomicsReady, false);
  // the entry frontier action vocabulary contains no option-closing or rolling verb
  const entrySource = code(join(root, 'src/theta/canonical-strategy-frontier.ts'));
  const actionUnion = /export type CanonicalFrontierAction =([^;]+);/.exec(entrySource)?.[1] ?? '';
  assert.doesNotMatch(actionUnion, /CLOSE|ROLL|ASSIGN|EXPIRE|CALL_AWAY/, 'Q / A / C entry proposals cannot close or roll an option');
});
