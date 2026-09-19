import assert from 'node:assert/strict';
import test from 'node:test';
import { replayBootstrapFromDiagnostic } from '../tools/paper-entry-bootstrap-offline-replay.js';

test('September 18 aggregate replay is deterministic and cannot claim an AEGIS allow',()=>{
  const result=replayBootstrapFromDiagnostic({candidates:2875,quoteUsable:489,hardRejected:0,aegisUnknown:2875,aegisVetoed:0});
  assert.equal(result.bootstrapEligible,489);
  assert.equal(result.reachedAegis,489);
  assert.equal(result.aegisHoldOnly,489);
  assert.equal(result.aegisAllowFull,0);
  assert.equal(result.qtyPositive,0);
  assert.equal(result.brokerSubmissions,0);
});
