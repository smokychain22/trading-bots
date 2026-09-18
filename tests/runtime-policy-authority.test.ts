import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const legacyPipelineModules = [
  'management-orchestrator',
  'management-cycle',
  'assignment-orchestrator',
  'covered-call-management-orchestrator',
  'recovery-orchestrator',
  'covered-call-orchestrator',
  'management-assembly',
  'management-contract',
  'management-opportunity-book',
] as const;

test('resident worker reaches one TypeScript management policy authority', () => {
  const worker = source('src/worker/resident-worker.ts');
  const runtime = source('src/theta/autonomous-runtime.ts');

  assert.match(worker, /runAutonomousRuntimeCycle/);
  assert.match(runtime, /createPaperBootstrapManagementPolicyProvider/);
  assert.match(runtime, /dependencies\.managementPolicyEvidenceProvider/);
  assert.match(runtime, /PAPER_BOOTSTRAP_MANAGEMENT_POLICY/);

  for (const moduleName of legacyPipelineModules) {
    assert.doesNotMatch(worker, new RegExp(moduleName));
    assert.doesNotMatch(runtime, new RegExp(`from ['"].*${moduleName}\\.js['"]`));
  }
});

test('legacy management pipeline has no broker mutation imports', () => {
  const forbiddenAuthorityImports = [
    'alpaca-paper-broker',
    'paper-execution-coordinator',
    'paper-action-handoff',
    'broker-order-submit',
  ];

  for (const moduleName of legacyPipelineModules) {
    const body = source(`src/theta/${moduleName}.ts`);
    for (const forbidden of forbiddenAuthorityImports) {
      assert.doesNotMatch(body, new RegExp(`from ['"].*${forbidden}\\.js['"]`));
    }
  }
});

test('Python bridge remains research-capable but has no broker execution authority', () => {
  const bridge = source('src/theta/python-bridge.ts');
  assert.doesNotMatch(bridge, /AlpacaPaperBroker|ExecutionCoordinator|submitOrder|POST \/v2\/orders/);
});
