import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('system integrity register is evidence-bound and preserves external and empirical limits', () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'tools/theta-system-integrity-register.ts'], { stdio: 'pipe' });
  const system = JSON.parse(readFileSync('docs/operations/THETA_SYSTEM_INTEGRITY_REGISTER_20261004.json', 'utf8')) as { capabilities: Array<{ id: string; sourceStatus: string; testStatus: string; runtimeStatus: string; producer: string[]; consumer: string[] }>; endToEndTraces: Array<{ evidence: string }>; remainingCodeSolvableBlockers: number; executionProof: string };
  assert.equal(system.remainingCodeSolvableBlockers, 0);
  assert.equal(system.capabilities.length >= 19, true);
  assert.equal(system.capabilities.every((row) => row.sourceStatus === 'SOURCE_EVIDENCE_PRESENT'
    && row.testStatus === 'EXECUTABLE_TEST_PRESENT' && row.producer.length > 0 && row.consumer.length > 0), true);
  assert.equal(system.executionProof, 'SEE_EXECUTED_VALIDATION_RECEIPT_SEPARATE_FROM_THIS_SOURCE_REGISTER');
  assert.equal(system.capabilities.find((row) => row.id === 'PROFITABILITY_MODEL')?.runtimeStatus, 'EMPIRICALLY_UNPROVEN');
  assert.equal(system.capabilities.find((row) => row.id === 'BROKER_MUTATION')?.runtimeStatus, 'FORWARD_DATA_REQUIRED');
  assert.equal(system.endToEndTraces.length, 14);
  assert.equal(system.endToEndTraces.every((trace) => trace.evidence === 'EXECUTABLE_TEST_PRESENT'), true);
  const duplication = JSON.parse(readFileSync('docs/operations/THETA_DUPLICATION_MAP_20261004.json', 'utf8')) as { concepts: Array<{ concept: string; canonical: string }> };
  assert.equal(duplication.concepts.filter((row) => row.concept === 'PRODUCTION_DECISION').length, 1);
  assert.equal(duplication.concepts.filter((row) => row.concept === 'BROKER_MUTATION').length, 1);
  const wiring = JSON.parse(readFileSync('docs/operations/THETA_WIRING_GRAPH_20261004.json', 'utf8')) as { producedWithoutConsumer: string[]; consumerWithoutProducer: string[] };
  assert.deepEqual(wiring.producedWithoutConsumer, []);
  assert.deepEqual(wiring.consumerWithoutProducer, []);
  const values = JSON.parse(readFileSync('docs/operations/THETA_VALUE_INTEGRITY_20261004.json', 'utf8')) as { values: Array<{ value: string; missingSemantics: string }>; unknownCoercionPolicy: string };
  assert.equal(values.values.length, 25);
  assert.equal(values.values.find((row) => row.value === 'expectedAfterCostEv')?.missingSemantics, 'EMPIRICALLY_UNPROVEN');
  assert.equal(values.unknownCoercionPolicy, 'PRESERVE_TYPED_UNKNOWN_NEVER_FALSE_OR_ZERO');
});
