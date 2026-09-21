import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BBO_OBSERVATION_EXPORT_CONTRACT_VERSION, IV_OBSERVATION_EXPORT_CONTRACT_VERSION,
  OPTIONOMICS_CAPABILITY_EXPORT_CONTRACT_VERSION, runIvRealDataStudy, runSpreadRealDataStudy,
} from '../src/research/iv-spread-real-data-runner.js';
import type { OptionomicsCapabilityObservation } from '../src/theta/optionomics-capability-contract.js';

const safeCapability = (overrides: Partial<OptionomicsCapabilityObservation> = {}): OptionomicsCapabilityObservation => ({
  family: 'HISTORICAL_CHAINS', operationAlias: 'historical_chain', documentationReference: 'docs://historical',
  availability: 'SUPPORTED', httpStatus: 200, schemaKeys: ['underlying', 'expiration', 'strike', 'right', 'observedAt'],
  timestampField: 'observedAt', units: {}, nullableFields: [], rateLimit: {}, historical: true,
  runtimeClass: 'RESEARCH', ...overrides,
});

const capabilityExport = (observations: readonly OptionomicsCapabilityObservation[]) => ({
  exportContractVersion: OPTIONOMICS_CAPABILITY_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
  sanitized: true, sourceDescription: 'fixture', rowCount: observations.length, rows: observations,
});

test('runIvRealDataStudy reports AWAITING_CAPABILITY_EXPORT before anything else with no capability export', () => {
  const result = runIvRealDataStudy(null, null, () => 'cohort');
  assert.equal(result.status, 'AWAITING_CAPABILITY_EXPORT');
});

test('runIvRealDataStudy reports BACKFILL_NOT_SAFE and never runs the IV study when capability is unproven', () => {
  const result = runIvRealDataStudy(capabilityExport([safeCapability({ availability: 'NOT_ENTITLED', historical: null })]), null, () => 'cohort');
  assert.equal(result.status, 'BACKFILL_NOT_SAFE');
  assert.equal(result.coverage, null);
});

test('runIvRealDataStudy reports AWAITING_DATA_EXPORT once capability is safe but no data export exists yet', () => {
  const result = runIvRealDataStudy(capabilityExport([safeCapability()]), null, () => 'cohort');
  assert.equal(result.status, 'AWAITING_DATA_EXPORT');
});

test('runIvRealDataStudy runs coverage + per-cohort shock research on a valid pair of exports', () => {
  const ivRows = Array.from({ length: 25 }, (_, i) => ({
    observationTimestamp: `2026-0${1 + (i % 9)}-01T15:00:00Z`, sessionDate: `d${i}`, underlying: 'AAPL',
    contractId: `AAPL-c${i}`, expiration: '2026-10-16', dte: 30, delta: 0.3, iv: 0.2 + i * 0.001,
  }));
  const dataExport = {
    exportContractVersion: IV_OBSERVATION_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'fixture', rowCount: ivRows.length, rows: ivRows,
  };
  const result = runIvRealDataStudy(capabilityExport([safeCapability()]), dataExport, () => 'AAPL|30DTE');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.evidenceLineage, 'REAL_EXPORT');
  assert.equal(result.coverage?.rawRowCount, 25);
  assert.equal(result.shockByCohort?.length, 1);
  assert.equal(result.shockByCohort?.[0].status, 'COMPUTED');
});

test('runSpreadRealDataStudy reports BACKFILL_NOT_SAFE before ever touching a spread export', () => {
  const result = runSpreadRealDataStudy(capabilityExport([safeCapability({ timestampField: null })]), null, () => 'cohort');
  assert.equal(result.status, 'BACKFILL_NOT_SAFE');
});

test('runSpreadRealDataStudy runs coverage + stress research on a valid pair of exports', () => {
  const bboRows = Array.from({ length: 25 }, (_, i) => ({
    observationTimestamp: `2026-01-01T15:0${i % 9}:00Z`, sessionDate: `d${i}`, underlying: 'AAPL',
    contractId: `AAPL-c${i}`, bid: 1.0, ask: 1.1, isStale: false,
  }));
  const dataExport = {
    exportContractVersion: BBO_OBSERVATION_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'fixture', rowCount: bboRows.length, rows: bboRows,
  };
  const result = runSpreadRealDataStudy(capabilityExport([safeCapability()]), dataExport, () => 'AAPL');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.evidenceLineage, 'REAL_EXPORT');
  assert.equal(result.coverage?.validRowCount, 25);
  assert.equal(result.stressByCohort?.length, 1);
  assert.equal(result.stressByCohort?.[0].status, 'COMPUTED');
});
