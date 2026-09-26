import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const receiptVersion = 'theta-local-runtime-receipt-v1';
const scopeNames = ['BROKER', 'LIFECYCLE', 'MANAGEMENT', 'OBSERVATION', 'EVIDENCE'];
const executionGates = new Set(['LOCKED', 'ACTIVE', 'EXTERNAL_QUOTE_BLOCKER']);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
};
const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const hash = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const finiteInteger = (value) => Number.isInteger(value) && value >= 0 ? value : null;
const boundedString = (value, maximum = 160) => typeof value === 'string' && value.length <= maximum ? value : null;
const nullableBoolean = (value) => typeof value === 'boolean' ? value : null;

function sanitizeReconciliation(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    accountStatus: boundedString(value.accountStatus, 32),
    positionCount: finiteInteger(value.positionCount),
    openOrderCount: finiteInteger(value.openOrderCount),
    activityCount: finiteInteger(value.activityCount),
    matchedOrderCount: finiteInteger(value.matchedOrderCount),
    externalOrUnknownCount: finiteInteger(value.externalOrUnknownCount),
    localOnlyIntentCount: finiteInteger(value.localOnlyIntentCount),
    marketOpen: nullableBoolean(value.marketOpen),
    calendarSessionConfirmed: nullableBoolean(value.calendarSessionConfirmed),
    dataQuality: boundedString(value.dataQuality, 32),
    observedAt: boundedString(value.observedAt, 40),
  };
}

function sanitizeScope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('LOCAL_RECEIPT_SCOPE_INVALID');
  const jobs = Array.isArray(value.jobResults) ? value.jobResults.slice(0, 32).map((job) => ({
    jobType: boundedString(job?.jobType, 64),
    outcome: boundedString(job?.outcome, 64),
    status: boundedString(job?.status, 32),
  })) : [];
  return {
    correlationId: boundedString(value.correlationId, 160),
    status: boundedString(value.status, 32),
    executionGate: executionGates.has(value.executionGate) ? value.executionGate : 'LOCKED',
    jobsAttempted: finiteInteger(value.jobsAttempted),
    jobsCompleted: finiteInteger(value.jobsCompleted),
    jobResults: jobs,
    reconciliation: sanitizeReconciliation(value.reconciliation),
    masterPaperOrdersSubmitted: finiteInteger(value.masterPaperOrdersSubmitted) ?? 0,
    followerPaperOrdersSubmitted: finiteInteger(value.followerPaperOrdersSubmitted) ?? 0,
    liveOrdersSubmitted: finiteInteger(value.liveOrdersSubmitted) ?? 0,
  };
}

export function sanitizeLocalRuntimeReceipt(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('LOCAL_RECEIPT_INPUT_INVALID');
  const observedAt = boundedString(input.observedAt, 40);
  if (observedAt === null || Number.isNaN(Date.parse(observedAt))) throw new Error('LOCAL_RECEIPT_OBSERVED_AT_INVALID');
  if (!/^[0-9a-f]{40}$/.test(input.buildSha ?? '')) throw new Error('LOCAL_RECEIPT_BUILD_SHA_INVALID');
  if (input.mode !== 'MASTER_THETA_PAPER') throw new Error('LOCAL_RECEIPT_MODE_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.marketSessionDate ?? '')) throw new Error('LOCAL_RECEIPT_SESSION_DATE_INVALID');
  if (input.scopes === null || typeof input.scopes !== 'object' || Array.isArray(input.scopes)) {
    throw new Error('LOCAL_RECEIPT_SCOPES_INVALID');
  }
  const scopes = Object.fromEntries(scopeNames.map((name) => [name, sanitizeScope(input.scopes[name])]));
  return {
    receiptVersion,
    observedAt: new Date(observedAt).toISOString(),
    marketSessionDate: input.marketSessionDate,
    buildSha: input.buildSha,
    mode: input.mode,
    executionGate: executionGates.has(input.executionGate) ? input.executionGate : 'LOCKED',
    researchExport: boundedString(input.researchExport, 80) ?? 'UNKNOWN',
    scopes,
  };
}

export const failureReceiptVersion = 'theta-local-runtime-failure-receipt-v1';

/**
 * Phase 2 Pass B Final Closure C (directive sections 13-15): a genuine
 * Postgres/provider failure at ANY earlier per-cycle step must not erase
 * basic local operational evidence just because the step that failed came
 * before the normal success-receipt write. This is a deliberately separate,
 * minimal, bounded, sanitized failure receipt -- never the full 5-scope
 * success schema (which requires data a failed cycle may never have
 * reached) -- written to the SAME `receipts/<date>/` directory so it is
 * discoverable the same way, but distinguishable by its own
 * `receiptVersion` and a `-FAILURE-` filename marker. It deliberately does
 * NOT update `latest.json`: that pointer stays reserved for the real
 * success-receipt hash chain, which stays unbroken by a failure receipt.
 */
function sanitizeLocalFailureReceipt(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('LOCAL_FAILURE_RECEIPT_INPUT_INVALID');
  const observedAt = boundedString(input.observedAt, 40);
  if (observedAt === null || Number.isNaN(Date.parse(observedAt))) throw new Error('LOCAL_FAILURE_RECEIPT_OBSERVED_AT_INVALID');
  if (!/^[0-9a-f]{40}$/.test(input.buildSha ?? '')) throw new Error('LOCAL_FAILURE_RECEIPT_BUILD_SHA_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.marketSessionDate ?? '')) throw new Error('LOCAL_FAILURE_RECEIPT_SESSION_DATE_INVALID');
  return {
    receiptVersion: failureReceiptVersion,
    observedAt: new Date(observedAt).toISOString(),
    marketSessionDate: input.marketSessionDate,
    buildSha: input.buildSha,
    mode: boundedString(input.mode, 32) ?? 'UNKNOWN',
    workerId: boundedString(input.workerId, 96) ?? 'UNKNOWN',
    failureCode: boundedString(input.failureCode, 96) ?? 'LOCAL_WORKER_LOOP_FAILED',
    failedOperation: boundedString(input.failedOperation, 96) ?? 'UNKNOWN',
    marketOpen: nullableBoolean(input.marketOpen),
  };
}

export async function writeLocalFailureReceipt(input, rootPath = '.theta-local-worker/receipts') {
  const root = resolve(rootPath);
  const sanitized = sanitizeLocalFailureReceipt(input);
  const previousReceiptHash = await readPrevious(root);
  const body = { ...sanitized, previousReceiptHash };
  const receiptHash = hash(body);
  const filename = `${sanitized.observedAt.replaceAll(':', '-').replace('.000Z', 'Z')}-FAILURE-${receiptHash.slice(0, 12)}.json`;
  const destination = join(root, sanitized.marketSessionDate, filename);
  const receipt = { ...body, receiptHash };
  await atomicJson(destination, receipt);
  return { state: 'PERSISTED_FAILURE', receiptHash, path: relative(root, destination).replaceAll('\\', '/'), observedAt: sanitized.observedAt };
}

async function readPrevious(root) {
  try {
    const latest = JSON.parse(await readFile(join(root, 'latest.json'), 'utf8'));
    return /^[0-9a-f]{64}$/.test(latest.receiptHash ?? '') ? latest.receiptHash : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, path);
}

export async function writeLocalRuntimeReceipt(input, rootPath = '.theta-local-worker/receipts') {
  const root = resolve(rootPath);
  const sanitized = sanitizeLocalRuntimeReceipt(input);
  const previousReceiptHash = await readPrevious(root);
  const body = { ...sanitized, previousReceiptHash };
  const receiptHash = hash(body);
  const filename = `${sanitized.observedAt.replaceAll(':', '-').replace('.000Z', 'Z')}-${receiptHash.slice(0, 12)}.json`;
  const destination = join(root, sanitized.marketSessionDate, filename);
  const receipt = { ...body, receiptHash };
  await atomicJson(destination, receipt);
  const pointer = { receiptVersion, receiptHash, previousReceiptHash,
    path: relative(root, destination).replaceAll('\\', '/'), observedAt: sanitized.observedAt };
  await atomicJson(join(root, 'latest.json'), pointer);
  return { state: 'PERSISTED', ...pointer };
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('LOCAL_RECEIPT_INPUT_TOO_LARGE');
  }
  // `--failure` as the first CLI argument selects the bounded failure-
  // receipt path (directive sections 13-15); the root path shifts to the
  // second argument in that mode, keeping the default (success) call
  // signature completely unchanged for every existing caller.
  const result = process.argv[2] === '--failure'
    ? await writeLocalFailureReceipt(JSON.parse(raw), process.argv[3])
    : await writeLocalRuntimeReceipt(JSON.parse(raw), process.argv[2]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ state: 'FAILED', code: error instanceof Error ? error.message : 'LOCAL_RECEIPT_FAILED' })}\n`);
    process.exitCode = 2;
  });
}
