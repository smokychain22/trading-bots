import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresStrategyPaperAuthorityStore } from '../../src/theta/postgres-strategy-paper-authority-store.js';
import { buildStrategyPaperAuthorityReceipt, type StrategyPaperAuthorityInput } from '../../src/theta/strategy-paper-authority.js';

const url = process.env.TEST_DATABASE_URL;
const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40);
const allGates = (strategy: StrategyPaperAuthorityInput['strategy']): StrategyPaperAuthorityInput => ({ strategy, ownerPaperAuthorization: true, technicalStrategyCertification: true, idempotencyCertified: true,
  riskAuthorization: true, currentActionAuthorization: true, brokerCapability: 'SUPPORTED', decisionPlanBound: true, reconciliationCertified: true, managementCoverageCertified: true,
  restartRecoveryCertified: true, wholeChainAccountingCertified: true, strategyCanaryAccepted: false, liveAuthorization: false, observedAt: '2026-10-06T15:00:00.000Z', evidenceIds: ['phase4-test'] });

test('governed authority: absence is no authority; a receipt authorizes ONLY its exact release SHA; blocked / tampered receipts never read as authority; the table is immutable', { skip: !url }, async () => {
  assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    // an isolated strategy namespace per run is impossible (the enum is closed), so clear nothing: assert relative to unique SHAs
    const store = new PostgresStrategyPaperAuthorityStore(pool);
    const sha = (n: number): string => n.toString(16).padStart(40, '0');
    const unique = Date.now() % 1_000_000_000_000;
    const shaFresh = sha(unique), shaOther = sha(unique + 1);
    assert.equal(await store.current('THETA_HOLD_STRIKE', shaFresh), undefined, 'no row: fail closed');
    assert.equal(await store.current('THETA_HOLD_STRIKE', null), undefined, 'unknown release identity: fail closed');
    const good = buildStrategyPaperAuthorityReceipt(allGates('THETA_HOLD_STRIKE'));
    assert.equal((await store.record({ receipt: good, sourceSha: shaFresh, recordedBy: 'test-operator' })).recorded, true);
    assert.equal((await store.record({ receipt: good, sourceSha: shaFresh, recordedBy: 'test-operator' })).recorded, false, 'idempotent');
    assert.equal((await store.current('THETA_HOLD_STRIKE', shaFresh))?.receiptHash, good.receiptHash);
    assert.equal(await store.current('THETA_HOLD_STRIKE', shaOther), undefined, 'a different SHA (any code change) has no authority until one is recorded for it');
    assert.equal(await store.current('THETA_DEFINED_RISK', shaFresh), undefined, 'authority is per strategy: H authority never authorizes D');

    // a blocked receipt can be stored but never reads as authority; the newest receipt wins, so a later blocked receipt REVOKES
    const blocked = buildStrategyPaperAuthorityReceipt({ ...allGates('THETA_HOLD_STRIKE'), managementCoverageCertified: false, observedAt: '2026-10-06T16:00:00.000Z' });
    assert.equal(blocked.paperOpeningOrderAllowed, false);
    await store.record({ receipt: blocked, sourceSha: shaFresh, recordedBy: 'test-operator' });
    assert.equal(await store.current('THETA_HOLD_STRIKE', shaFresh), undefined, 'the newer blocked receipt supersedes (revokes) the older allowing one');

    // tamper: a stored receipt whose content no longer matches its hash is rejected by the database constraint AND by the verifier
    await assert.rejects(() => pool.query(`INSERT INTO ops.theta_strategy_paper_authority(strategy,receipt_json,receipt_hash,source_sha,recorded_by_ref_hash) VALUES('THETA_HOLD_STRIKE',$1::jsonb,$2,$3,$4)`,
      [JSON.stringify({ ...good, strategy: 'THETA_DEFINED_RISK' }), good.receiptHash, shaOther, 'c'.repeat(64)]), (error: { code?: string }) => error.code === '23514');
    await assert.rejects(() => pool.query(`INSERT INTO ops.theta_strategy_paper_authority(strategy,receipt_json,receipt_hash,source_sha,recorded_by_ref_hash) VALUES('THETA_HOLD_STRIKE',$1::jsonb,$2,$3,$4)`,
      [JSON.stringify({ ...good, liveAuthorization: true }), good.receiptHash, shaOther, 'c'.repeat(64)]), (error: { code?: string }) => error.code === '23514', 'live authorization can not even be stored');
    await pool.query(`INSERT INTO ops.theta_strategy_paper_authority(strategy,receipt_json,receipt_hash,source_sha,recorded_by_ref_hash) VALUES('THETA_HOLD_STRIKE',$1::jsonb,$2,$3,$4)`,
      [JSON.stringify({ ...good, evidenceIds: ['forged'] }), good.receiptHash, shaOther, 'c'.repeat(64)]);
    assert.equal(await store.current('THETA_HOLD_STRIKE', shaOther), undefined, 'a row whose content does not rebuild to its hash is not authority');

    // immutability
    await assert.rejects(() => pool.query(`UPDATE ops.theta_strategy_paper_authority SET source_sha=$1 WHERE source_sha=$2`, [SHA_B, shaFresh]));
    await assert.rejects(() => pool.query(`DELETE FROM ops.theta_strategy_paper_authority WHERE source_sha=$1`, [shaFresh]));
    assert.ok(SHA_A.length === 40);
  } finally { await pool.end(); }
});
