// Production reachability pin. A module that the wiring audit (tools/theta-runtime-wiring-audit.ts) names as a live/paper definition
// must be reachable from a production entry point, OR be declared below with the reason it is not. Drift in either direction fails:
// a newly dead required module is a defect, and a declared-dead module that becomes reachable must leave this list.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listEntries(): string[] {
  const entries: string[] = [];
  for (const file of readdirSync(path.join(root, 'api'))) if (file.endsWith('.ts')) entries.push(`api/${file}`);
  for (const file of ['src/index.ts', 'src/app.ts', 'src/worker/index.ts', 'src/theta/autonomous-runtime.ts', 'src/research/production-shadow-runtime.ts',
    'tools/theta-local-evidence-backfill.ts', 'tools/theta-command5a-runtime.ts', 'tools/theta-research-export.ts', 'tools/theta-storage-audit.ts',
    'tools/archive-canonical-strategy-frontiers.ts']) if (existsSync(path.join(root, file))) entries.push(file);
  return entries;
}

function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  for (const candidate of [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(path.join(root, candidate))) return candidate;
  }
  return null;
}

function productionClosure(): Set<string> {
  const seen = new Set<string>();
  const queue = listEntries();
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const resolved = resolveImport(file, match[1] as string);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/** Modules the audit names but production does not import, each with the evidence-backed reason. */
const declaredNotInProductionClosure: Readonly<Record<string, string>> = {
  'src/theta/promoted-management-policy-provider.ts': 'FUTURE_EMPIRICAL_PROMOTION: serves empirically promoted policies; production uses the bootstrap management policy until a promotion exists',
  'src/execution/broker-lifecycle-application.ts': 'LEGACY_SUPERSEDED: production applies lifecycle through postgres-broker-lifecycle-orchestrator and postgres-broker-fill-lifecycle-orchestrator',
  'src/execution/lifecycle-reconciliation.ts': 'LEGACY_SUPERSEDED: only imported by the superseded broker-lifecycle-evidence/application chain',
  'src/theta/management-policy-promotion-ladder.ts': 'FUTURE_EMPIRICAL_PROMOTION: promotion ladder for candidate policies; the bootstrap policy never appears in it and no promotion exists',
  'src/research/p2g-receipt-store.ts': 'TOOLING_NOT_RUNTIME: local P2G receipt tooling for offline gate evidence, not a runtime decision or execution path',
  'src/theta/underlying-selector-contract.ts': 'SUPERSEDED_CONTRACT: production ranks underlyings through universe-policy/universe-discovery; this multi-score selector contract has no runtime consumer',
};

function auditedSourceDefinitions(): string[] {
  const text = readFileSync(path.join(root, 'tools/theta-runtime-wiring-audit.ts'), 'utf8');
  const found = new Set<string>();
  for (const line of text.split('\n')) {
    if (!/classification: '(CANONICAL_LIVE_AUTHORITY|CANONICAL_LIVE_SUPPORT|PAPER_ONLY_AUTHORITY|PAPER_ONLY_SUPPORT)'/.test(line)) continue;
    const definitions = /definitions: \[([^\]]*)\]/.exec(line)?.[1] ?? '';
    for (const match of definitions.matchAll(/'(src\/[^']+\.ts)'/g)) found.add(match[1] as string);
  }
  return [...found].sort();
}

test('every live or paper definition the wiring audit names is reachable from a production entry, or is declared with a reason', () => {
  const closure = productionClosure();
  assert.ok(closure.size > 100, `production closure looks wrong (${closure.size} modules)`);
  const unexplained = auditedSourceDefinitions().filter((file) => !closure.has(file) && !(file in declaredNotInProductionClosure));
  assert.deepEqual(unexplained, [], `required modules with no production importer: ${unexplained.join(', ')}`);
});

test('a declared-unreachable module that becomes reachable must leave the declaration list, and every declared file exists', () => {
  const closure = productionClosure();
  for (const file of Object.keys(declaredNotInProductionClosure)) {
    assert.ok(existsSync(path.join(root, file)), `${file} no longer exists; remove its declaration`);
    assert.equal(closure.has(file), false, `${file} is now reachable from production; remove it from declaredNotInProductionClosure`);
  }
});

test('the broker mutation methods are called only from the PaperOrderCoordinator', () => {
  const offenders: string[] = [];
  const closure = productionClosure();
  for (const file of closure) {
    if (!file.startsWith('src/') || file === 'src/execution/paper-order-coordinator.ts' || file === 'src/execution/broker.ts'
      || file === 'src/execution/read-only-paper-broker.ts') continue;
    const text = readFileSync(path.join(root, file), 'utf8');
    if (/\b(?:broker|adapter|executionBroker)\.(?:submitOrder|replaceOrder|cancelOrder)\(/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
