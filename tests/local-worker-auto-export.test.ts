import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows supervisor exports once after a complete scan without gaining an order surface', async () => {
  const source = await readFile('tools/windows/theta-local-worker.ps1', 'utf8');
  assert.match(source, /last-auto-export-session/);
  assert.match(source, /OPPORTUNITY_SCAN/);
  assert.match(source, /\.status -eq 'SUCCEEDED'/);
  assert.match(source, /npm run theta:research-export -- --latest/);
  assert.match(source, /CURRENT_SESSION_EXPORTED/);
  assert.match(source, /BLOCKED_ON_EVIDENCE/);
  assert.doesNotMatch(source, /\/v2\/orders/i);
  assert.doesNotMatch(source, /APCA-API-KEY-ID|APCA-API-SECRET-KEY/);
});
