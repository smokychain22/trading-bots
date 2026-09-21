import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeOptionomicsEventRows } from '../src/database/optionomics-event-inspection.js';

const base = {
  observation_id: '11111111-1111-4111-8111-111111111111',
  source_raw_observation_id: '22222222-2222-4222-8222-222222222222',
  fusion_snapshot_id: '33333333-3333-4333-8333-333333333333',
  provider_event_id: 'PROVIDER-PRIVATE-EVENT-ID', payload_hash: 'a'.repeat(64),
  event_kind: 'macro', ticker: null, event_date: '2026-09-25',
  scheduled_at: '2026-09-25T14:00:00Z', provider_known_at: '2026-09-20T13:00:00Z',
  first_observed_at: '2026-09-21T13:00:00Z', provider_timestamp: null,
  ingestion_timestamp: '2026-09-21T13:00:01Z', decision_time: '2026-09-21T13:00:02Z',
  operation_alias: 'optionomics.list_events', data_quality: 'GOOD',
  response_hash: 'b'.repeat(64), pit_timing_state: 'TIMING_VALID',
};

test('protected inspection keeps immutable lineage but never returns raw provider IDs or payloads', () => {
  const rows = sanitizeOptionomicsEventRows([base, { ...base, observation_id: 'revised', payload_hash: 'c'.repeat(64) }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.provider, 'OPTIONOMICS');
  assert.equal(rows[0]?.revisionOrdinal, 1);
  assert.equal(rows[1]?.revisionOrdinal, 2);
  assert.equal(rows[0]?.forwardEvidence, 'THETA_OBSERVED_BEFORE_DECISION');
  assert.equal(JSON.stringify(rows).includes(base.provider_event_id), false);
  assert.equal(JSON.stringify(rows).includes('provider_payload_json'), false);
});

test('a backdated provider claim or a late THETA observation cannot qualify forward evidence', () => {
  const rows = sanitizeOptionomicsEventRows([
    { ...base, provider_known_at: '2026-09-22T00:00:00Z' },
    { ...base, first_observed_at: '2026-09-21T13:00:03Z' },
    { ...base, scheduled_at: '2026-09-20T14:00:00Z' },
    { ...base, data_quality: 'UNKNOWN' },
  ]);
  assert.ok(rows.every((row) => row.forwardEvidence === 'NOT_FORWARD_OR_TIMING_UNPROVEN'));
});
