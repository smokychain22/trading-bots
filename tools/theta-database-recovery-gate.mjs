import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.ts';

export const recoveryGateContractVersion = 'theta-database-recovery-gate-v1';
export const requiredRecoveryProbeCount = 4;
export const minimumRecoveryProbeIntervalSeconds = 30;
export const minimumRecoveryConnectionHeadroom = 3;

const finiteInteger = (value) => Number.isSafeInteger(value) ? value : null;

export function assessRecoveryProbeSeries(samples, options = {}) {
  const requiredCount = options.requiredCount ?? requiredRecoveryProbeCount;
  const minimumIntervalSeconds = options.minimumIntervalSeconds ?? minimumRecoveryProbeIntervalSeconds;
  const minimumConnectionHeadroom = options.minimumConnectionHeadroom ?? minimumRecoveryConnectionHeadroom;
  const reasons = [];
  if (!Number.isSafeInteger(requiredCount) || requiredCount < requiredRecoveryProbeCount) {
    throw new Error('RECOVERY_GATE_REQUIRED_COUNT_BELOW_POLICY');
  }
  if (!Number.isFinite(minimumIntervalSeconds) || minimumIntervalSeconds < minimumRecoveryProbeIntervalSeconds) {
    throw new Error('RECOVERY_GATE_INTERVAL_BELOW_POLICY');
  }
  if (!Number.isSafeInteger(minimumConnectionHeadroom) || minimumConnectionHeadroom < 1) {
    throw new Error('RECOVERY_GATE_HEADROOM_INVALID');
  }
  if (samples.length < requiredCount) reasons.push('RECOVERY_PROBE_COUNT_INSUFFICIENT');
  const considered = samples.slice(0, requiredCount);
  for (const [index, sample] of considered.entries()) {
    if (sample.connectivity !== 'PASS') reasons.push(`PROBE_${index + 1}_CONNECTIVITY_FAILED:${sample.errorCode ?? 'UNKNOWN'}`);
    if (sample.ssl !== 'PASS') reasons.push(`PROBE_${index + 1}_SSL_FAILED`);
    if (sample.defaultTransactionReadOnly !== 'off' || sample.transactionReadOnly !== 'off') {
      reasons.push(`PROBE_${index + 1}_READ_ONLY`);
    }
    if (sample.transactionWriteRollback !== 'PASS') reasons.push(`PROBE_${index + 1}_ROLLBACK_WRITE_FAILED`);
    const maxConnections = finiteInteger(sample.maxConnections);
    const clientBackends = finiteInteger(sample.clientBackendsAtProbe);
    if (maxConnections === null || clientBackends === null) reasons.push(`PROBE_${index + 1}_CONNECTION_COUNTS_INVALID`);
    else if (maxConnections - clientBackends < minimumConnectionHeadroom) reasons.push(`PROBE_${index + 1}_CONNECTION_HEADROOM_LOW`);
    if (typeof sample.postmasterStart !== 'string' || sample.postmasterStart.length === 0) {
      reasons.push(`PROBE_${index + 1}_POSTMASTER_START_MISSING`);
    }
  }
  for (let index = 1; index < considered.length; index++) {
    const previous = Date.parse(considered[index - 1].observedAt);
    const current = Date.parse(considered[index].observedAt);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) reasons.push(`PROBE_${index + 1}_TIMESTAMP_INVALID`);
    else if ((current - previous) / 1_000 < minimumIntervalSeconds) reasons.push(`PROBE_${index + 1}_INTERVAL_TOO_SHORT`);
  }
  const postmasterStarts = new Set(considered.map((sample) => sample.postmasterStart).filter(Boolean));
  if (postmasterStarts.size > 1) reasons.push('POSTMASTER_RESTARTED_DURING_RECOVERY_GATE');
  return {
    contractVersion: recoveryGateContractVersion,
    state: reasons.length === 0 ? 'RECOVERY_GATE_SATISFIED' : 'RECOVERY_GATE_FAILED',
    checkpointRetryEligible: reasons.length === 0,
    decisionAuthority: 'INFRASTRUCTURE_DEFERRED',
    carryForwardCandidateAllowed: false,
    requiredProbeCount: requiredCount,
    minimumIntervalSeconds,
    minimumConnectionHeadroom,
    observedProbeCount: samples.length,
    reasons: [...new Set(reasons)],
  };
}

const safeErrorCode = (error) => typeof error?.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code)
  ? error.code : 'UNCLASSIFIED_DATABASE_ERROR';

async function runProbe(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 8_000,
    application_name: 'theta-database-recovery-gate' });
  const observedAt = new Date().toISOString();
  try {
    await client.connect();
    const result = await client.query(`SELECT
      current_setting('default_transaction_read_only') AS default_transaction_read_only,
      current_setting('transaction_read_only') AS transaction_read_only,
      current_setting('max_connections')::integer AS max_connections,
      COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS ssl,
      (SELECT count(*)::integer FROM pg_stat_activity WHERE backend_type='client backend') AS client_backends,
      pg_postmaster_start_time()::text AS postmaster_start`);
    await client.query('BEGIN');
    await client.query('CREATE TEMPORARY TABLE theta_recovery_gate_write_probe(id integer PRIMARY KEY)');
    await client.query('INSERT INTO theta_recovery_gate_write_probe(id) VALUES (1)');
    await client.query('ROLLBACK');
    const row = result.rows[0];
    return { observedAt, connectivity: 'PASS', ssl: row.ssl === true ? 'PASS' : 'FAIL',
      defaultTransactionReadOnly: row.default_transaction_read_only,
      transactionReadOnly: row.transaction_read_only, maxConnections: Number(row.max_connections),
      clientBackendsAtProbe: Number(row.client_backends), postmasterStart: String(row.postmaster_start),
      transactionWriteRollback: 'PASS' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return { observedAt, connectivity: 'FAIL', ssl: 'NOT_REACHED', defaultTransactionReadOnly: null,
      transactionReadOnly: null, maxConnections: null, clientBackendsAtProbe: null, postmasterStart: null,
      transactionWriteRollback: 'NOT_REACHED', errorCode: safeErrorCode(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const environmentFileArgument = process.argv.find((argument) => argument.startsWith('--environment-file='));
  const receiptPathArgument = process.argv.find((argument) => argument.startsWith('--receipt-path='));
  if (!environmentFileArgument) throw new Error('RECOVERY_GATE_ENVIRONMENT_FILE_REQUIRED');
  const environment = loadEnvironmentFile(environmentFileArgument.slice('--environment-file='.length));
  if (!environment.AIVEN_DATABASE_URL) throw new Error('AIVEN_DATABASE_URL_NOT_CONFIGURED');
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30_000, windowsHide: true,
  }).trim();
  const samples = [];
  for (let index = 0; index < requiredRecoveryProbeCount; index++) {
    const sample = await runProbe(environment.AIVEN_DATABASE_URL);
    samples.push(sample);
    process.stdout.write(`${JSON.stringify({ event: 'DATABASE_RECOVERY_PROBE', probe: index + 1, ...sample })}\n`);
    if (sample.connectivity !== 'PASS') break;
    if (index < requiredRecoveryProbeCount - 1) await delay(minimumRecoveryProbeIntervalSeconds * 1_000);
  }
  const assessment = assessRecoveryProbeSeries(samples);
  const receipt = { ...assessment, sourceSha, completedAt: new Date().toISOString(), samples };
  if (receiptPathArgument) {
    const receiptPath = resolve(receiptPathArgument.slice('--receipt-path='.length));
    if (!receiptPath.toLowerCase().endsWith('.json')) throw new Error('RECOVERY_GATE_RECEIPT_PATH_INVALID');
    await mkdir(dirname(receiptPath), { recursive: true });
    const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, receiptPath);
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!assessment.checkpointRetryEligible) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href : '';
if (import.meta.url === invokedPath) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ contractVersion: recoveryGateContractVersion,
    state: 'RECOVERY_GATE_FAILED', checkpointRetryEligible: false, decisionAuthority: 'INFRASTRUCTURE_DEFERRED',
    errorCode: safeErrorCode(error) })}\n`);
  process.exitCode = 1;
});
