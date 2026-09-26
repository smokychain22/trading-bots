import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresThetaCycleStore, type ThetaCyclePersistenceContext } from '../src/theta/postgres-theta-cycle-store.js';
import type { ThetaShadowCycleResult } from '../src/theta/theta-shadow-cycle.js';

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (item 6): the real
// Production persistence boundary must fail closed rather than silently
// write a decision with an unknown release identity. This is checked
// before any database call, so it can be tested with no real Pool.
const baseContext: ThetaCyclePersistenceContext = {
  botInstanceId: 'bot', universeVersionId: null, strategyVersionId: 'v1', featureVersionId: 'v1',
  riskLimitVersionId: 'v1', executionVersionId: 'v1', costModelVersionId: 'v1', accountSnapshotId: 1,
};
const stubCycle = { fusionSnapshot: null } as unknown as ThetaShadowCycleResult;

test('a genuine Production persistence call with no release identity is rejected before touching the database', async () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    const store = new PostgresThetaCycleStore({} as Pool);
    await assert.rejects(() => store.persist(baseContext, stubCycle), /PRODUCTION_DECISION_RELEASE_IDENTITY_REQUIRED/);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous;
  }
});

test('a genuine Production persistence call WITH a resolved release identity passes this guard (fails later, on the real missing fusion snapshot, not on identity)', async () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    const store = new PostgresThetaCycleStore({} as Pool);
    await assert.rejects(
      () => store.persist({ ...baseContext, releaseIdentity: { sourceSha: 'a'.repeat(40), workerSha: 'a'.repeat(40) } }, stubCycle),
      /FUSION_SNAPSHOT_NOT_AVAILABLE/,
    );
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous;
  }
});

test('outside Production (no VERCEL_ENV=production), missing release identity does not block research/test persistence at this guard', async () => {
  const previous = process.env.VERCEL_ENV;
  delete process.env.VERCEL_ENV;
  try {
    const store = new PostgresThetaCycleStore({} as Pool);
    await assert.rejects(() => store.persist(baseContext, stubCycle), /FUSION_SNAPSHOT_NOT_AVAILABLE/);
  } finally {
    if (previous !== undefined) process.env.VERCEL_ENV = previous;
  }
});
