import type { Pool, PoolClient } from 'pg';

/** For short-lived pools owned by the caller. The caller still releases its
 * client and ends the pool on success. Failed acquisition must close the pool
 * too, even though the caller's client-finally block has not been entered. */
export async function connectOwnedPostgresPool(pool: Pool): Promise<PoolClient> {
  try { return await pool.connect(); }
  catch (error) {
    try { await pool.end(); } catch { /* Keep the original acquisition failure. */ }
    throw error;
  }
}
