import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalSystemCapabilities } from '../src/theta/canonical-system-truth.js';
import { profitabilityBrainMethodRegistry } from '../src/theta/profitability-brain-reality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(path, 'utf8');

function listFiles(directory: string, extension: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path, extension) : path.endsWith(extension) ? [path] : [];
  });
}

const specifierPattern = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
function resolveSpecifier(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base.replace(/\.js$/, '.ts'), base + '.ts', join(base, 'index.ts'), base]) {
    if (candidate.endsWith('.ts') && existsSync(candidate) && statSync(candidate).isFile()) return normalize(candidate);
  }
  return null;
}

/** Static import closure from the files the deployed runtime actually starts (worker, server, API routes). */
function runtimeClosure(): Set<string> {
  const roots = [join(root, 'src', 'worker', 'index.ts'), join(root, 'src', 'index.ts'), ...listFiles(join(root, 'api'), '.ts')]
    .filter((path) => existsSync(path)).map(normalize);
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const match of read(current).matchAll(specifierPattern)) {
      const target = resolveSpecifier(current, match[1] as string);
      if (target !== null && !seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  return seen;
}

/** Python models reached through a *_contract.py bridge script that reachable TypeScript actually names. */
function pythonClosure(reachableTs: ReadonlySet<string>): Set<string> {
  const bridge = join(root, 'bots', 'theta', 'quant', 'runtime');
  const scripts = listFiles(bridge, '.py');
  const text = [...reachableTs].map(read).join('\n');
  const named = scripts.filter((script) => text.includes(script.split(/[\\/]/).at(-1) as string));
  const seen = new Set<string>(named.map(normalize));
  const queue = [...named];
  const quantRoot = join(root, 'bots', 'theta', 'quant');
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const match of read(current).matchAll(/^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm)) {
      const parts = (match[1] as string).split('.');
      for (const candidate of [join(quantRoot, ...parts) + '.py', join(quantRoot, ...parts, '__init__.py')]) {
        if (existsSync(candidate) && !seen.has(normalize(candidate))) { seen.add(normalize(candidate)); queue.push(candidate); }
      }
    }
  }
  return seen;
}

const reachableTs = runtimeClosure();
const reachablePython = pythonClosure(reachableTs);
const reachable = (path: string): boolean => {
  const absolute = normalize(join(root, path));
  return reachableTs.has(absolute) || reachablePython.has(absolute);
};

test('the runtime import closure is real: the worker, the canonical frontier, management and the order coordinator are inside it', () => {
  for (const path of ['src/theta/autonomous-runtime.ts', 'src/theta/canonical-strategy-frontier.ts', 'src/execution/paper-order-coordinator.ts',
    'src/theta/paper-bootstrap-management-policy.ts', 'src/theta/whole-chain-economics.ts']) {
    assert.ok(reachable(path), `${path} must be reachable from the worker/API entry points`);
  }
  for (const path of ['bots/theta/quant/models/aegis.py', 'bots/theta/quant/models/sizing.py']) assert.ok(reachable(path), `${path} must be reachable through the Python bridge`);
  assert.ok(!reachable('src/theta/optionomics-merge.ts'), 'a tested library nothing imports is correctly outside the closure');
});

test('every file path a registry names exists', () => {
  const missing: string[] = [];
  for (const method of profitabilityBrainMethodRegistry) for (const source of method.sourceEvidence) if (!existsSync(join(root, source))) missing.push(`method ${method.methodId}: ${source}`);
  for (const capability of canonicalSystemCapabilities) for (const source of capability.sourceFiles) if (!existsSync(join(root, source))) missing.push(`capability ${capability.capabilityId}: ${source}`);
  assert.deepEqual(missing, []);
});

test('a method registered as runtime-reachable has at least one source inside the deployed runtime closure (no claimed consumer that does not exist)', () => {
  const stale = profitabilityBrainMethodRegistry
    .filter((method) => method.baseEvidence.runtimeReachable && !method.sourceEvidence.some(reachable))
    .map((method) => `${method.methodId} [${method.authority}] sources=${method.sourceEvidence.join(',')}`);
  assert.deepEqual(stale, []);
});

test('a capability registered runtimeReachable=YES has at least one source inside the deployed runtime closure', () => {
  const stale = canonicalSystemCapabilities
    .filter((capability) => capability.runtimeReachable === 'YES' && !capability.sourceFiles.some(reachable))
    .map((capability) => `${capability.capabilityId} sources=${capability.sourceFiles.join(',')}`);
  assert.deepEqual(stale, []);
});

test('a PRODUCTION_LOCKED method never names a research-only module as its only runtime source', () => {
  const offenders = profitabilityBrainMethodRegistry
    .filter((method) => method.authority === 'PRODUCTION_LOCKED')
    .filter((method) => method.sourceEvidence.every((source) => source.startsWith('src/research/') && !reachable(source)))
    .map((method) => method.methodId);
  assert.deepEqual(offenders, []);
});

test('the deep inventory never declares a runtime caller that is outside the deployed closure', async () => {
  const { methodInventory, strategyInventory, brainLayerInventory } = await import('../src/theta/deep-system-inventory.js');
  const stale = methodInventory
    .filter((row) => row.runtimeCaller !== 'NO_RUNTIME_CALLER_PROVEN' && row.runtimeCaller !== 'UNKNOWN_RUNTIME_CALLER' && !reachable(row.runtimeCaller))
    .map((row) => `${row.id} -> ${row.runtimeCaller}`);
  assert.deepEqual(stale, [], 'runtimeCaller must be a file the worker actually imports, or NO_RUNTIME_CALLER_PROVEN');
  const strategyStale = strategyInventory
    .filter((row) => row.currentAuthority === 'PRODUCTION_LOCKED' && !row.sourceFiles.some(reachable))
    .map((row) => `${row.id} -> ${row.sourceFiles.join(',')}`);
  assert.deepEqual(strategyStale, []);
  const hold = strategyInventory.find((row) => row.id === 'THETA_HOLD_STRIKE');
  assert.ok(hold && hold.currentAuthority !== 'PRODUCTION_LOCKED', 'H stays research/shadow');
  assert.ok(brainLayerInventory.length > 0);
});
