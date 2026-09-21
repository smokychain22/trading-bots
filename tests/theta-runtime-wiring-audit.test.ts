import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('static wiring inventory excludes generated releases and does not claim proven runtime reachability', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'tools/theta-runtime-wiring-audit.ts'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
  });
  const inventory = JSON.parse(output) as {
    schemaVersion: string;
    components: Array<{ textualReferences: string[]; referenceEvidence: string; runtimeReachability: string }>;
  };
  assert.equal(inventory.schemaVersion, 'theta-runtime-static-inventory-v3');
  assert.ok(inventory.components.length > 0);
  for (const component of inventory.components) {
    assert.equal(component.referenceEvidence, 'TEXT_MATCH_ONLY');
    assert.equal(component.runtimeReachability, 'UNVERIFIED_STATIC_SCAN');
    assert.ok(component.textualReferences.every((file) => /^(src|bots|api)\//.test(file)));
  }
});
