// Governed recording of a strategy's Paper authority receipt (the ONLY writer of ops.theta_strategy_paper_authority).
//   node --import tsx tools/theta-strategy-authority.ts --strategy=THETA_HOLD_STRIKE --input=<gates.json> [--release-sha=<40 hex, must equal HEAD>] [--environment-file=.env.local] [--apply]
// Default is a DRY RUN: it prints the receipt's maturity and blockers and writes nothing. --apply records a receipt only when it genuinely ALLOWS a Paper opening order
// (no blockers), for exactly the release SHA that is checked out. It can never authorize live money (liveAuthorization is structurally false) and it prints no secret.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { buildStrategyPaperAuthorityReceipt, type PaperExposureStrategy, type StrategyPaperAuthorityInput } from '../src/theta/strategy-paper-authority.js';
import { PostgresStrategyPaperAuthorityStore } from '../src/theta/postgres-strategy-paper-authority-store.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const strategy = arg('strategy') as PaperExposureStrategy | undefined;
if (strategy === undefined || !['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'].includes(strategy)) throw new Error('STRATEGY_REQUIRED');
const inputPath = arg('input');
if (inputPath === undefined) throw new Error('INPUT_GATES_FILE_REQUIRED');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const releaseSha = arg('release-sha') ?? head;
if (releaseSha !== head) throw new Error('RELEASE_SHA_MUST_EQUAL_CHECKED_OUT_HEAD');
const gates = JSON.parse(readFileSync(inputPath, 'utf8')) as Omit<StrategyPaperAuthorityInput, 'strategy' | 'observedAt' | 'liveAuthorization'>;
const receipt = buildStrategyPaperAuthorityReceipt({ ...gates, strategy, liveAuthorization: false, observedAt: new Date().toISOString() });
process.stdout.write(`${JSON.stringify({ strategy, releaseSha, maturity: receipt.maturity, paperOpeningOrderAllowed: receipt.paperOpeningOrderAllowed, blockers: receipt.blockers, receiptHash: receipt.receiptHash, applied: false }, null, 2)}\n`);
if (process.argv.includes('--apply')) {
  if (!receipt.paperOpeningOrderAllowed) throw new Error('RECEIPT_HAS_BLOCKERS_NOTHING_RECORDED');
  const environment = loadEnvironmentFile(arg('environment-file') ?? '.env.local');
  const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
  if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const result = await new PostgresStrategyPaperAuthorityStore(pool).record({ receipt, sourceSha: releaseSha, recordedBy: process.env.USERNAME ?? process.env.USER ?? 'governed-operator' });
    process.stdout.write(`${JSON.stringify({ recorded: result.recorded })}\n`);
  } finally { await pool.end(); }
}
