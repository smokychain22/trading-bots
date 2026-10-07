// Prints the governed rebuild/swap PLAN for the legacy slices that are not a whole table (READ ONLY catalog and count queries against Production; nothing is executed, nothing is written).
// The plan is the exact SQL a future, separately approved window would run (see src/storage/data-platform/legacy-rebuild.ts). Tables with inbound foreign keys or dependent views are listed as
// REFUSED with the reason, and carry the method the dry-run recorded (reuse only until a table rewrite).
//   node --import tsx tools/theta-legacy-rebuild-plan.ts [--environment-file=.env.local] [--out=<file>]
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { planRebuild } from '../src/storage/data-platform/legacy-rebuild.js';
import { archivePopulations, defaultLegacyCutoff } from './storage/storage-populations.js';
import { explicitEnvironmentFile } from '../src/config/tool-environment.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const environment = loadEnvironmentFile(arg('environment-file') ?? explicitEnvironmentFile());
const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 2_000, application_name: 'theta-readonly-rebuild-plan', options: '-c statement_timeout=240000' });
pool.on('error', () => undefined);
const readOnly = { query: async (sql: string, values?: unknown[]) => {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect(); client.on('error', () => undefined); let broken = false;
    try { await client.query('BEGIN READ ONLY'); const result = await client.query(sql, values); await client.query('COMMIT'); return result; }
    catch (error) { broken = true; await client.query('ROLLBACK').catch(() => undefined); const transient = /terminated|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(`${(error as { code?: string }).code ?? ''} ${(error as Error).message}`); if (attempt >= 5 || !transient) throw error; await sleep(5_000 * attempt); }
    finally { client.release(broken ? true : undefined); }
  }
} } as unknown as pg.Pool;

const plans: unknown[] = [];
for (const population of archivePopulations) {
  // the retained slice is the complement of the archived predicate, over the same time column (a `where` such as `t.decision_time < $1` becomes `NOT (decision_time < cutoff)`)
  const archived = population.where.replaceAll('t.', '').replace('$1', `'${defaultLegacyCutoff}'`);
  const plan = await planRebuild(readOnly, { schema: population.schema, table: population.table, retainPredicate: `NOT (${archived})`, expectedRetainedRows: 0 });
  plans.push({ populationId: population.id, table: plan.table, totalRows: plan.totalRows, retainedRows: plan.retainedRows, currentBytes: plan.currentBytes, refused: plan.refused,
    method: plan.refused.length === 0 ? 'REBUILD_RETAINED_ROWS_THEN_DROP_OLD' : 'NOT_REBUILDABLE_IN_PLACE', steps: plan.refused.length === 0 ? plan.steps : [], foreignKeys: plan.foreignKeys, triggers: plan.triggers });
  process.stderr.write(`${population.id} planned\n`);
}
await pool.end();
const text = `${JSON.stringify({ plannedAt: new Date().toISOString(), executed: false, productionWrites: 0, plans }, null, 2)}\n`;
const out = arg('out'); if (out !== undefined) writeFileSync(out, text); else process.stdout.write(text);
