/**
 * A failed ROLLBACK (the connection died mid-transaction) must neither replace the original error nor return a broken client to the
 * pool. Returns true when the rollback succeeded; the caller then releases the client with `release(!rolledBack ? true : undefined)`
 * so a client whose transaction state is unknown is destroyed instead of reused.
 */
export async function rollbackSucceeded(client: { query(sql: string): Promise<unknown> }): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}
