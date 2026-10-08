import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { canonicalHash, dotLabIdentitySchema, dotProposalSource, validateDotProposal, type DotLabIdentity, type DotProposal } from './contracts.js';

/** Separate bounded lab metadata, never THETA's operational database. No order tables or executor. */
export class DotLabStore {
  private readonly database: DatabaseSync;
  readonly identity: DotLabIdentity;
  constructor(path: string, identity: DotLabIdentity, private readonly maximumRows = 2000, private readonly maximumBytes = 16 * 1024 * 1024) {
    this.identity = dotLabIdentitySchema.parse(identity);
    this.database = new DatabaseSync(path);
    try {
      if (!Number.isSafeInteger(maximumRows) || maximumRows < 1 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1024) throw new Error('DOT_STORAGE_BUDGET_INVALID');
      this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;
        PRAGMA max_page_count=8192; PRAGMA wal_autocheckpoint=128; PRAGMA journal_size_limit=1048576;
        CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), identity_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS artifact (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, artifact_id TEXT NOT NULL,
          created_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(kind,artifact_id));
        CREATE UNIQUE INDEX IF NOT EXISTS proposal_version ON artifact
          (json_extract(payload,'$.strategy.strategyId'),json_extract(payload,'$.strategy.strategyVersion')) WHERE kind='PROPOSAL';`);
      const row = this.database.prepare('SELECT identity_json FROM identity WHERE singleton=1').get();
      if (row) {
        const prior = dotLabIdentitySchema.parse(JSON.parse(String(row.identity_json)));
        if (prior.providerAccountId !== identity.providerAccountId || prior.accountNumber !== identity.accountNumber
          || prior.executionAccountId !== identity.executionAccountId || prior.workspaceId !== identity.workspaceId) throw new Error('DOT_STATE_ACCOUNT_MISMATCH');
      } else this.database.prepare('INSERT INTO identity VALUES (1,?)').run(JSON.stringify(this.identity));
    } catch (error) { this.database.close(); throw error; }
  }
  private write(kind: 'PROPOSAL' | 'OBSERVATION' | 'EXPERIMENT', id: string, value: unknown, at: string) {
    if (!z.string().datetime({ offset: true }).safeParse(at).success) throw new Error('DOT_ARTIFACT_TIME_INVALID');
    const payload = JSON.stringify(value);
    if (Buffer.byteLength(payload) > 256 * 1024) throw new Error('DOT_ARTIFACT_SIZE_EXCEEDED');
    const hash = canonicalHash(value);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.database.prepare('SELECT hash FROM artifact WHERE kind=? AND artifact_id=?').get(kind, id);
      if (prior && prior.hash !== hash) throw new Error('DOT_IMMUTABLE_ARTIFACT_CONFLICT');
      if (!prior) {
        const budget = this.database.prepare('SELECT count(*) AS n, coalesce(sum(length(CAST(payload AS BLOB))),0) AS bytes FROM artifact').get();
        if (Number(budget?.n) >= this.maximumRows || Number(budget?.bytes) + Buffer.byteLength(payload) > this.maximumBytes) throw new Error('DOT_STORAGE_BUDGET_EXCEEDED');
        this.database.prepare('INSERT INTO artifact VALUES (?,?,?,?,?)').run(hash, kind, id, at, payload);
      }
      this.database.exec('COMMIT');
      return hash;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  saveProposal(proposal: DotProposal, at: string) {
    if (canonicalHash(validateDotProposal(dotProposalSource(proposal))) !== canonicalHash(proposal)) throw new Error('DOT_PROPOSAL_RECEIPT_MISMATCH');
    if (proposal.parentProposalHash !== null) {
      const parent = this.database.prepare("SELECT payload FROM artifact WHERE kind='PROPOSAL' AND json_extract(payload,'$.proposalHash')=?").get(proposal.parentProposalHash);
      if (!parent) throw new Error('DOT_PARENT_PROPOSAL_MISSING');
      const prior = JSON.parse(String(parent.payload)) as DotProposal;
      if (prior.strategy.strategyId !== proposal.strategy.strategyId) throw new Error('DOT_PARENT_STRATEGY_MISMATCH');
    }
    return this.write('PROPOSAL', proposal.proposalId, proposal, at);
  }
  saveObservation(value: { providerAccountId: string; observationId: string; receivedAt: string; data: unknown }) {
    if (value.providerAccountId !== this.identity.providerAccountId) throw new Error('DOT_OBSERVATION_ACCOUNT_MISMATCH');
    return this.write('OBSERVATION', value.observationId, value, value.receivedAt);
  }
  saveExperiment(id: string, value: unknown, at: string) { return this.write('EXPERIMENT', id, value, at); }
  list(kind: 'PROPOSAL' | 'OBSERVATION' | 'EXPERIMENT', limit = 50): unknown[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('DOT_QUERY_LIMIT_INVALID');
    return this.database.prepare('SELECT payload FROM artifact WHERE kind=? ORDER BY created_at DESC, artifact_id LIMIT ?')
      .all(kind, limit).map(row => JSON.parse(String(row.payload)));
  }
  close() { this.database.close(); }
}
