import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { LocalObservationJobScheduler } from '../src/storage/local-observation-job-scheduler.js';

test('Command-5A health runs in an isolated release-shaped directory without repo .env.local', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-immutable-release-sandbox-'));
  const source = resolve('.');
  try {
    cpSync(join(source, 'src'), join(root, 'src'), { recursive: true });
    cpSync(join(source, 'tools'), join(root, 'tools'), { recursive: true });
    copyFileSync(join(source, 'package.json'), join(root, 'package.json'));
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const scheduler = join(root, 'jobs.sqlite');
    new LocalObservationJobScheduler(scheduler).close();
    assert.equal(existsSync(join(root, '.env.local')), false);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/theta-command5a-runtime.ts',
      '--mode=health', `--environment-file=${join(root, 'production.env')}`, `--scheduler=${scheduler}`],
    { cwd: root, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, DATABASE_URL: '', ALPACA_API_KEY: '', ALPACA_SECRET_KEY: '', ALPACA_BASE_URL: '' } });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout) as { state: string; jobCount: number; brokerMutations: number };
    assert.equal(receipt.state, 'COMMAND5A_HEALTH_COMPLETE');
    assert.equal(receipt.jobCount, 0);
    assert.equal(receipt.brokerMutations, 0);
    const mature = spawnSync(process.execPath, ['--import', 'tsx', 'tools/theta-command5a-runtime.ts',
      '--mode=mature', `--environment-file=${join(root, 'production.env')}`, `--scheduler=${scheduler}`,
      `--spool=${join(root, 'research.sqlite')}`],
    { cwd: root, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, DATABASE_URL: '', ALPACA_API_KEY: '', ALPACA_SECRET_KEY: '', ALPACA_BASE_URL: '' } });
    assert.equal(mature.status, 0, mature.stderr);
    assert.equal((JSON.parse(mature.stdout) as { state: string }).state, 'COMMAND5A_MATURATION_COMPLETE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
