import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(directory: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path, extensions));
    else if (extensions.some((extension) => path.endsWith(extension))) found.push(path);
  }
  return found;
}

const rel = (path: string): string => relative(root, path).replaceAll('\\', '/');
const source = (path: string): string => readFileSync(path, 'utf8');
const productionFiles = [...walk(join(root, 'src'), ['.ts']), ...walk(join(root, 'tools'), ['.ts', '.mjs', '.ps1'])];

const filesMatching = (pattern: RegExp, files: readonly string[] = productionFiles): string[] =>
  files.filter((path) => pattern.test(source(path))).map(rel).sort();

test('every order mutation call site in all of src/ and tools/ is the PaperOrderCoordinator, nothing else', () => {
  // A call is `.submitOrder(` etc.; declarations (`async submitOrder(`) have no leading dot.
  assert.deepEqual(filesMatching(/\.\s*(submitOrder|cancelOrder|replaceOrder)\s*\(/), ['src/execution/paper-order-coordinator.ts']);
});

test('only the broker adapter performs an HTTP order mutation (POST/PATCH/DELETE on /v2/orders)', () => {
  const mutating = /method:\s*['"](POST|PATCH|DELETE)['"]|-Method\s+['"]?(Post|Patch|Delete)\b/i;
  const touchesOrders = productionFiles.filter((path) => {
    const text = source(path);
    return text.includes('/v2/orders') && mutating.test(text);
  }).map(rel).sort();
  assert.deepEqual(touchesOrders, ['src/execution/broker.ts']);
});

test('exactly one production construction site builds the PaperOrderCoordinator', () => {
  assert.deepEqual(filesMatching(/new\s+PaperOrderCoordinator\s*\(/), ['src/theta/autonomous-runtime.ts']);
});

test('the management selector has exactly one implementation and only declared consumers', () => {
  assert.deepEqual(filesMatching(/export\s+function\s+buildManagementActionFrontier\s*\(/), ['src/theta/management-action-frontier.ts']);
  const callers = filesMatching(/\bbuildManagementActionFrontier\s*\(/).filter((path) => path !== 'src/theta/management-action-frontier.ts');
  // production runtime, the production bootstrap policy provider, and the shadow comparison policy.
  assert.deepEqual(callers, ['src/theta/autonomous-runtime.ts', 'src/theta/paper-bootstrap-management-policy.ts', 'src/theta/shadow-management-policy.ts']);
});

test('the entry selector has exactly one implementation and the execution layer never selects strategy', () => {
  assert.deepEqual(filesMatching(/export\s+function\s+buildCanonicalStrategyFrontier\s*\(/), ['src/theta/canonical-strategy-frontier.ts']);
  const executionFiles = walk(join(root, 'src', 'execution'), ['.ts']);
  for (const path of executionFiles) {
    const text = source(path);
    assert.doesNotMatch(text, /\bbuildCanonicalStrategyFrontier\s*\(/, `${rel(path)} must consume the frontier, not recompute it`);
    assert.doesNotMatch(text, /\bbuildManagementActionFrontier\s*\(/, `${rel(path)} must consume management decisions, not choose them`);
  }
});

test('research modules never import the execution layer or construct broker authority', () => {
  for (const path of walk(join(root, 'src', 'research'), ['.ts'])) {
    const text = source(path);
    // Type-only imports (e.g. `import type { BrokerActivity }`) carry no authority; value imports do.
    assert.doesNotMatch(text, /^import\s+(?!type\b)[^;]*from\s+['"][./]*\/execution\/(paper-order-coordinator|broker)\.js['"]/m,
      `${rel(path)} value-imports the order coordinator or broker adapter`);
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // prose may name the adapter
    assert.doesNotMatch(code, /AlpacaPaperBrokerAdapter/, `${rel(path)} references the mutating broker adapter`);
  }
});

test('structuralSizing has exactly one definition and no max(1) quantity floor exists in decision code', () => {
  assert.deepEqual(filesMatching(/\bfunction\s+structuralSizing\s*\(/), ['src/theta/canonical-strategy-frontier.ts']);
  const decisionFiles = productionFiles.filter((path) => /src\/(theta|execution)\//.test(rel(path)) && path.endsWith('.ts'));
  const offenders = decisionFiles.filter((path) => /Math\.max\(\s*1\s*,[^)]*(quantity|qty)/i.test(source(path))).map(rel);
  assert.deepEqual(offenders, [], 'a forced minimum quantity of one is forbidden');
});

test('production decision directories import only a pinned set of research modules (a new research->production edge is a reviewed change)', () => {
  const pinned = ['aegis-stress-baseline-maturity', 'branch-research-readiness', 'canonical-event-export', 'cross-strategy-common-horizon-contract',
    'defined-risk-locked-plan', 'empirical-model-registry', 'point-in-time-evidence', 'production-shadow-runtime', 'profit-taking-experiment', 'risk-policy-empirical-study',
    'shadow-evidence-runtime', 'strategy-quality-shadow-diagnostics', 'theta-entry-model-readiness'];
  const found = new Set<string>();
  const dirs = ['src/theta', 'src/execution', 'src/worker'].flatMap((dir) => walk(join(root, dir), ['.ts']));
  for (const path of [...dirs, join(root, 'src', 'index.ts')]) {
    for (const match of source(path).matchAll(/from\s+'(?:\.\.?\/)+research\/([^']+?)\.js'/g)) found.add(match[1] as string);
  }
  assert.deepEqual([...found].sort(), [...pinned].sort());
});

test('AEGIS has one Python authority; only the declared TypeScript callers invoke the bridge', () => {
  const callers = filesMatching(/aegis_contract\.py/, walk(join(root, 'src'), ['.ts']));
  assert.deepEqual(callers, ['src/research/production-shadow-runtime.ts',
    'src/theta/database-independent-shadow-observation.ts', 'src/theta/theta-shadow-once.ts']);
});

test('the production base AEGIS inputs are fail-closed: every measure is null and every applicability is REQUIRED until real evidence derives otherwise', () => {
  const text = source(join(root, 'src', 'research', 'production-shadow-runtime.ts'));
  const block = text.slice(text.indexOf('aegisInputs:{'), text.indexOf('aegisInputs:{') + 700);
  for (const key of ['tickerConcentrationPct', 'sectorConcentrationPct', 'correlationClusterExposurePct', 'portfolioCapitalAtRiskPct',
    'inventoryCapacityUsedPct', 'assignmentCapacityUsedPct', 'recoveryCapacityUsedPct', 'liquidityAcceptable', 'executionQualityAcceptable',
    'providerState', 'stressGapDetected', 'stressIvShockDetected', 'stressSpreadWideningDetected']) {
    assert.match(block, new RegExp(`${key}:null`), `${key} must start UNKNOWN (null), never a permissive value`);
  }
  assert.match(block, /stressIvShockApplicability:'REQUIRED'/);
  assert.doesNotMatch(block, /PAPER_COLD_START_NOT_APPLICABLE|NOT_APPLICABLE/, 'the loosening marker is applied only per candidate from valid current evidence');
});

test('the duplicate legacy trade-update store has no production importer (quarantined; the live path is the coordinator store)', () => {
  assert.deepEqual(filesMatching(/postgres-trade-update-store(?:\.js)?['"]/, [...walk(join(root, 'src'), ['.ts']), ...walk(join(root, 'api'), ['.ts']),
    ...walk(join(root, 'tools'), ['.ts', '.mjs'])]), []);
});

test('the covered-call commitment reader is fed the CURRENT-impact blocking fact count, never the raw count of historical external facts', () => {
  const runtime = source(join(root, 'src', 'theta', 'autonomous-runtime.ts'));
  assert.match(runtime, /readCommittedShortCallContracts\(pool,\{[^}]*entryBlockingFactCount:reconciliation\.entryBlockingFactCount/);
  assert.doesNotMatch(runtime, /readCommittedShortCallContracts\(pool,\{[^}]*externalOrUnknownCount/,
    'settled historical account activity must not block every covered call and stock sale forever');
  const reader = source(join(root, 'src', 'execution', 'management-chain-inflight.ts'));
  assert.doesNotMatch(reader, /externalOrUnknownCount/);
});
