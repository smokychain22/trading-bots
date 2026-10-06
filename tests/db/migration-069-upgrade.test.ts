import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Client } from 'pg';

// Upgrade-path proof for migration 069 against a database that already holds HISTORICAL rows: every earlier migration is applied, legacy-shaped single-leg order rows are inserted
// (including an option order with NO contract id, which migration 013 always allowed), then 069 is applied twice. A stricter single-leg constraint would reject the history and fail
// the production migration, so this must never regress. Disposable local server only; the database is created and dropped by the test.
const url = process.env.TEST_DATABASE_URL;

test('migration 069 upgrades a database with historical single-leg rows, is idempotent, and classifies them simple / WHEEL', { skip: !url }, async () => {
  assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Disposable local database only');
  const name = `theta_069_upgrade_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  const target = new URL(url);
  target.pathname = `/${name}`;
  let client: Client | null = null;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    client = new Client({ connectionString: target.toString() });
    await client.connect();
    const migrations = readdirSync(new URL('../../migrations/', import.meta.url)).filter((file) => file.endsWith('.sql')).sort();
    const target069 = migrations.findIndex((file) => file.startsWith('069_'));
    assert.ok(target069 > 0, '069 exists');
    for (const file of migrations.slice(0, target069)) await client.query(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
    await client.query('SET session_replication_role = replica');
    await client.query(`INSERT INTO trade.order_intent(order_intent_id,client_order_id,status,instrument_type,side,quantity,position_intent,canonical_quantity,paper_evidence_quantity) VALUES
      (gen_random_uuid(),'legacy-opt-null-contract','FILLED','OPTION','sell',1,'SELL_TO_OPEN',1,1),
      (gen_random_uuid(),'legacy-opt-btc','FILLED','OPTION','buy',1,'BUY_TO_CLOSE',1,1),
      (gen_random_uuid(),'legacy-stock','FILLED','STOCK','sell',100,NULL,100,100)`);
    await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'CSP_OPEN',now())`);
    await client.query('SET session_replication_role = origin');
    const sql069 = readFileSync(new URL(`../../migrations/${migrations[target069] as string}`, import.meta.url), 'utf8');
    await client.query(sql069);
    await client.query(sql069); // idempotent
    assert.deepEqual((await client.query(`SELECT order_class, count(*)::int AS n FROM trade.order_intent GROUP BY 1`)).rows, [{ order_class: 'simple', n: 3 }]);
    assert.deepEqual((await client.query(`SELECT chain_kind, count(*)::int AS n FROM trade.economic_chain GROUP BY 1`)).rows, [{ chain_kind: 'WHEEL', n: 1 }]);
    // the new constraints are enforced on the upgraded database: a single-leg row can not carry mleg identity, a spread can not be a Wheel lifecycle state holder
    await assert.rejects(() => client?.query(`INSERT INTO trade.order_intent(client_order_id,status,instrument_type,side,quantity,position_intent,canonical_quantity,paper_evidence_quantity,package_identity,credit_debit_direction)
      VALUES('bad-simple-with-package','PROPOSED','OPTION','sell',1,'SELL_TO_OPEN',1,1,'PKG','CREDIT')`) as Promise<unknown>, (error: { code?: string }) => error.code === '23514');
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM core.schema_migration WHERE version='069_multi_leg_order_durability'`)).rows[0].n, 1);
  } finally {
    await client?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
});
