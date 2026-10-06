import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { localRetention, pruneLocalDirectory } from '../tools/local-retention.mjs';

const hex = (n: number): string => n.toString(16).padStart(64, '0');

test('NO UNBOUNDED LOCAL PATH: retention keeps the newest N matching children, honours max age, never touches protected or non-matching entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-retention-'));
  try {
    const now = Date.now();
    for (let i = 1; i <= 5; i += 1) {
      mkdirSync(join(root, hex(i)));
      writeFileSync(join(root, hex(i), 'dataset.json'), '{}');
      const t = (now - (10 - i) * 60_000) / 1000;
      utimesSync(join(root, hex(i)), t, t);
    }
    writeFileSync(join(root, 'latest.json'), '{}');
    mkdirSync(join(root, 'not-a-bundle'));
    // the protected (pinned) bundle is the OLDEST: it must survive even though it is outside the newest-N window
    const removed = await pruneLocalDirectory(root, { ...localRetention.evidenceBundles, protect: [hex(1)] });
    assert.deepEqual(removed.sort(), [hex(2), hex(3), hex(4)].sort());
    assert.deepEqual(readdirSync(root).sort(), [hex(1), hex(5), 'latest.json', 'not-a-bundle'].sort());

    const sessions = mkdtempSync(join(tmpdir(), 'theta-receipts-'));
    try {
      for (const [day, ageDays] of [['2026-09-01', 35], ['2026-09-25', 11], ['2026-10-06', 0]] as const) {
        mkdirSync(join(sessions, day));
        const t = (now - ageDays * 86_400_000) / 1000;
        utimesSync(join(sessions, day), t, t);
      }
      const old = await pruneLocalDirectory(sessions, { ...localRetention.receiptSessions, now });
      assert.deepEqual(old, ['2026-09-01'], 'older than the 14-day cap is removed even when under the count cap');
    } finally { rmSync(sessions, { recursive: true, force: true }); }
    assert.deepEqual(await pruneLocalDirectory(join(root, 'missing'), localRetention.researchExports), [], 'a missing directory is not an error');
    await assert.rejects(() => pruneLocalDirectory(root, { match: /x/, keep: -1 }), /KEEP_INVALID/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
