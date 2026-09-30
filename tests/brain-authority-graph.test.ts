import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
interface AuthorityNode {
  authorityId: string;
  file: string;
  function: string;
  authorityClass: string;
  inputs: string[];
  outputs: string[];
  consumer: string[];
  mayVeto: boolean;
  mayRank: boolean;
  maySize: boolean;
  maySelect: boolean;
  mayMutateBroker: boolean;
}
const graph = JSON.parse(readFileSync(path.join(root, 'docs/research/THETA_BRAIN_AUTHORITY_GRAPH.json'), 'utf8')) as {
  contractVersion: string;
  nodes: AuthorityNode[];
};

test('authority graph binds each declared node and edge to existing source', () => {
  assert.equal(graph.contractVersion, 'theta-brain-authority-graph-v1');
  const ids = new Set(graph.nodes.map((node) => node.authorityId));
  assert.equal(ids.size, graph.nodes.length, 'duplicate authority ID');
  for (const node of graph.nodes) {
    const source = readFileSync(path.join(root, node.file), 'utf8');
    assert.match(source, new RegExp(`\\b${node.function}\\s*\\(`), `${node.authorityId} function missing`);
    assert.ok(node.inputs.length > 0 && node.outputs.length > 0);
    for (const consumer of node.consumer) {
      if (!consumer.includes(' ')) assert.ok(ids.has(consumer), `${node.authorityId} has undeclared consumer ${consumer}`);
    }
  }
});

test('one entry selector, management selector, final sizer, AEGIS and broker mutator', () => {
  const byClass = (value: string) => graph.nodes.filter((node) => node.authorityClass === value);
  assert.deepEqual(byClass('PRODUCTION_PAPER_ENTRY_SELECTOR_Q_ONLY').map((node) => node.authorityId),
    ['CANONICAL_ENTRY_SELECTION']);
  assert.deepEqual(byClass('PRODUCTION_MANAGEMENT_SELECTOR').map((node) => node.authorityId),
    ['MANAGEMENT_ACTION_FRONTIER']);
  assert.deepEqual(graph.nodes.filter((node) => node.maySelect).map((node) => node.authorityId),
    ['CANONICAL_ENTRY_SELECTION', 'MANAGEMENT_ACTION_FRONTIER']);
  assert.deepEqual(graph.nodes.filter((node) => node.maySize).map((node) => node.authorityId),
    ['FINAL_QUANTITY']);
  assert.deepEqual(byClass('PRODUCTION_RISK_AUTHORITY').map((node) => node.authorityId),
    ['AEGIS_RISK_PERMISSION']);
  assert.deepEqual(graph.nodes.filter((node) => node.mayMutateBroker).map((node) => node.authorityId),
    ['BROKER_MUTATION_AUTHORITY']);
});

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
});

test('no Production source outside the coordinator calls broker mutation methods', () => {
  const calls = sourceFiles(path.join(root, 'src')).filter((file) =>
    /\.\s*(?:submitOrder|cancelOrder|replaceOrder)\s*\(/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).replaceAll('\\', '/')).sort();
  assert.deepEqual(calls, ['src/execution/paper-order-coordinator.ts']);
  const coordinator = readFileSync(path.join(root, calls[0]), 'utf8');
  for (const method of ['submitOrder', 'cancelOrder', 'replaceOrder']) {
    assert.match(coordinator, new RegExp(`this\\.broker\\.${method}\\(`));
  }
});
