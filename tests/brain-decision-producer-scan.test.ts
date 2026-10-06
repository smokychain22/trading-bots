import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type ProducerClass = 'PRODUCTION_AUTHORITY' | 'SUBORDINATE_CALCULATOR' | 'SHADOW'
  | 'RESEARCH' | 'DISPLAY' | 'LEGACY';
const root = fileURLToPath(new URL('../', import.meta.url));
const markers = /selectedCandidate|selected_action|bestCandidate|bestStrategy|primaryAction|recommendedAction|winner|nextAction|orderDecision|strategyDecision|selectedStrategy|orderPlan/;
const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? files(full) : /\.(ts|tsx|py)$/.test(entry.name) ? [full] : [];
});

// File-level classification is deliberately conservative: a file containing
// a selected field is not necessarily its producer. This test is an audit
// tripwire for new decision-shaped modules, not a claim of runtime reachability.
const thetaClass: Readonly<Record<string, ProducerClass>> = {
  'adaptive-decision-brain.ts': 'SHADOW',
  'canonical-decision-authority.ts': 'SUBORDINATE_CALCULATOR',
  'canonical-strategy-frontier.ts': 'PRODUCTION_AUTHORITY',
  'covered-call-lattice.ts': 'RESEARCH',
  'cross-symbol-economic-frontier.ts': 'SHADOW',
  'cycle-archive-replay.ts': 'RESEARCH',
  'database-independent-shadow-observation.ts': 'SHADOW',
  'decision-assembly.ts': 'SUBORDINATE_CALCULATOR',
  'decision-evidence.ts': 'SUBORDINATE_CALCULATOR',
  'decision-explainability.ts': 'DISPLAY',
  'deep-system-inventory.ts': 'DISPLAY',
  'execution-quality-contract.ts': 'SUBORDINATE_CALCULATOR',
  // H's branch-local nominator: it can only propose an H candidate AFTER Q declined, from a verified governed receipt; canonical-strategy-frontier.ts stays the sole selector
  'hold-strike-production-decision.ts': 'SUBORDINATE_CALCULATOR',
  // D's branch-local nominator (same contract as H's): proposes only from a verified governed receipt after Q and H; the canonical frontier stays the sole selector
  'defined-risk-production-decision.ts': 'SUBORDINATE_CALCULATOR',
  'management-action-frontier.ts': 'PRODUCTION_AUTHORITY',
  'management-assembly.ts': 'LEGACY',
  'management-input-state.ts': 'SUBORDINATE_CALCULATOR',
  'new-risk-orchestrator.ts': 'SUBORDINATE_CALCULATOR',
  'options-chain-decision-intelligence.ts': 'RESEARCH',
  'p2g-lifecycle-simulator.ts': 'RESEARCH',
  'paper-bootstrap-management-policy.ts': 'SUBORDINATE_CALCULATOR',
  'postgres-cycle-evidence-storage.ts': 'SUBORDINATE_CALCULATOR',
  'postgres-theta-cycle-store.ts': 'SUBORDINATE_CALCULATOR',
  'profitability-brain-reality.ts': 'DISPLAY',
  'roll-incremental-utility.ts': 'SUBORDINATE_CALCULATOR',
  'runtime-behavior-diagnostic.ts': 'DISPLAY',
  'sovereign-strategy-assessment.ts': 'SUBORDINATE_CALCULATOR',
  'strategy-decision-envelope.ts': 'SUBORDINATE_CALCULATOR',
  'strategy-route-receipt.ts': 'SUBORDINATE_CALCULATOR',
  't0-replay-bundle.ts': 'SUBORDINATE_CALCULATOR',
  'theta-q-contract.ts': 'SUBORDINATE_CALCULATOR',
  'theta-shadow-cycle.ts': 'SUBORDINATE_CALCULATOR',
  'theta-shadow-once.ts': 'SHADOW',
  'zero-trade-diagnostic.ts': 'DISPLAY',
};

function classify(relative: string): ProducerClass | null {
  if (relative.startsWith('src/theta/')) return thetaClass[path.basename(relative)] ?? null;
  if (relative.startsWith('src/research/') || relative.startsWith('bots/theta/quant/research/')) return 'RESEARCH';
  if (relative.startsWith('src/operations/')) return 'DISPLAY';
  // the storage layer (retention, archive, tiering of ALREADY-MADE decisions' evidence) holds no decision authority: it classifies storage tiers, it never selects, sizes or submits anything
  if (relative.startsWith('src/storage/')) return 'DISPLAY';
  if (relative.startsWith('src/customer/')) return 'DISPLAY';
  if (relative.startsWith('src/execution/')) return 'SUBORDINATE_CALCULATOR';
  if (relative.startsWith('bots/theta/quant/models/') || relative.startsWith('bots/theta/quant/runtime/')
    || relative.startsWith('bots/theta/quant/features/')) return 'SUBORDINATE_CALCULATOR';
  return null;
}

test('every decision-shaped TypeScript and Python file has a declared authority role', () => {
  const matches = [...files(path.join(root, 'src')), ...files(path.join(root, 'bots', 'theta', 'quant'))]
    .filter((file) => markers.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).replaceAll('\\', '/')).sort();
  const unclassified = matches.filter((file) => classify(file) === null);
  assert.deepEqual(unclassified, [], `new decision-shaped source needs role review: ${unclassified.join(', ')}`);
  assert.deepEqual(matches.filter((file) => classify(file) === 'PRODUCTION_AUTHORITY'), [
    'src/theta/canonical-strategy-frontier.ts', 'src/theta/management-action-frontier.ts',
  ]);
});
