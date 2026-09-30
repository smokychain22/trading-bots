import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('canonical npm test discovers every root and nested Node test without shell globstar', () => {
  const result = spawnSync(process.execPath, ['tools/run-node-tests.mjs', '--list'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const files = JSON.parse(result.stdout) as string[];
  const expected: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && file.endsWith('.test.ts')) expected.push(file.replaceAll('\\', '/'));
    }
  };
  visit('tests');
  assert.deepEqual(files, expected.sort());
  assert.ok(files.includes('tests/canonical-strategy-frontier.test.ts'));
  assert.ok(files.includes('tests/db/runtime-postgres-faults.test.ts'));
  assert.equal(new Set(files).size, files.length);
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts.test, 'node tools/run-node-tests.mjs');
});
