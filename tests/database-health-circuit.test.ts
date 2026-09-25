import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseHealthCircuit } from '../src/theta/database-health-circuit.js';
import { classifyPostgresRuntimeError } from '../src/theta/postgres-runtime-error.js';

test('database circuit defers infrastructure without creating strategy evidence',()=>{
  const circuit=new DatabaseHealthCircuit(2,3);
  assert.equal(circuit.failure(classifyPostgresRuntimeError({code:'57P03'})).state,'DB_TRANSIENT_FAILURE');
  const open=circuit.failure(classifyPostgresRuntimeError({code:'08006'}));
  assert.equal(open.state,'DB_CIRCUIT_OPEN');
  assert.equal(open.decisionAuthority,'INFRASTRUCTURE_DEFERRED');
  assert.equal(open.carryForwardCandidateAllowed,false);
});

test('database circuit requires consecutive fresh probes and a new cycle boundary',()=>{
  const circuit=new DatabaseHealthCircuit(1,3);
  circuit.failure(classifyPostgresRuntimeError(new Error('connection terminated')));
  circuit.beginRecoveryProbe();
  assert.equal(circuit.recoveryProbeSucceeded().state,'DB_RECOVERY_PROBING');
  assert.equal(circuit.recoveryProbeSucceeded().state,'DB_RECOVERY_PROBING');
  assert.equal(circuit.recoveryProbeSucceeded().state,'DB_RECOVERED');
  assert.equal(circuit.receipt().decisionAuthority,'INFRASTRUCTURE_DEFERRED');
  assert.equal(circuit.startFreshCycleAfterRecovery().state,'DB_HEALTHY');
});

test('a failed recovery probe reopens the circuit',()=>{
  const circuit=new DatabaseHealthCircuit(1,2);
  circuit.failure(classifyPostgresRuntimeError({code:'57P01'}));
  circuit.recoveryProbeSucceeded();
  assert.equal(circuit.recoveryProbeFailed(classifyPostgresRuntimeError({code:'ETIMEDOUT'})).state,'DB_CIRCUIT_OPEN');
});

test('provider resource exhaustion opens the circuit without a blind read retry',()=>{
  const circuit=new DatabaseHealthCircuit(2,2);
  const classification=classifyPostgresRuntimeError({code:'53000'});
  assert.equal(classification.retryableRead,false);
  const receipt=circuit.failure(classification);
  assert.equal(receipt.state,'DB_CIRCUIT_OPEN');
  assert.equal(receipt.decisionAuthority,'INFRASTRUCTURE_DEFERRED');
});
