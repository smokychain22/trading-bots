import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  classifyQuoteEvidenceAdmission,
  decideRun,
  hasSensitiveText,
  validateEvidenceManifest,
  validatePublicReceipt,
  validateWorkflowText,
} from '../tools/theta-research-actions-gate.mjs';

const policy = JSON.parse(readFileSync('config/research/actions-policy.json', 'utf8'));
const calendar = JSON.parse(readFileSync('config/research/options-session-calendar.json', 'utf8'));
const manifest = JSON.parse(readFileSync('config/research/evidence-manifest.json', 'utf8'));

function scheduled(schedule: string, now: string) {
  return decideRun({
    policy,
    calendar,
    manifest,
    eventName: 'schedule',
    schedule,
    requestedMode: undefined,
    now: new Date(now),
  });
}

function qualifiedOpraEvidence(overrides: Record<string, unknown> = {}) {
  return {
    feed: 'OPRA',
    evidenceClass: 'REAL_MARKET_EVIDENCE',
    historicalBboCoverage: 'VERIFIED',
    entitlementStatus: 'VERIFIED',
    bid: 1,
    ask: 1.1,
    quoteTimestamp: '2026-10-08T14:00:00.000Z',
    decisionTimestamp: '2026-10-08T14:00:01.000Z',
    maximumQuoteAgeMs: 5_000,
    sourceSha: 'a'.repeat(40),
    expectedSourceSha: 'a'.repeat(40),
    optionSymbol: 'SPY261120P00600000',
    expectedOptionSymbol: 'SPY261120P00600000',
    feedDocumentationStatus: 'VERIFIED',
    feedDocumentationUrl: 'https://docs.alpaca.markets/docs/real-time-option-data',
    expectedLegCount: 2,
    observedLegCount: 2,
    pairedProtectivePutPresent: true,
    completeExitPathPresent: true,
    ...overrides,
  };
}

test('weekday shadow slot is admitted only inside the bounded delay and official options session', () => {
  const admitted = scheduled('17 10,13,15 * * 1-5', '2026-10-08T14:25:00.000Z');
  assert.equal(admitted.run, true);
  assert.equal(admitted.mode, 'shadow');
  assert.equal(admitted.slotId, 'shadow-2026-10-08-1017');

  const delayed = scheduled('17 10,13,15 * * 1-5', '2026-10-08T15:00:00.000Z');
  assert.equal(delayed.run, false);
  assert.deepEqual(delayed.reasons, ['SHADOW_START_DELAY_EXCEEDED']);
});

test('Cboe holidays and early closes fail closed for market-session shadow work', () => {
  const holiday = scheduled('17 10,13,15 * * 1-5', '2026-11-26T15:17:00.000Z');
  assert.equal(holiday.run, false);
  assert.deepEqual(holiday.reasons, ['MARKET_CLOSED']);

  const afterEarlyClose = scheduled('17 10,13,15 * * 1-5', '2026-11-27T20:17:00.000Z');
  assert.equal(afterEarlyClose.run, false);
  assert.deepEqual(afterEarlyClose.reasons, ['OUTSIDE_OPTIONS_SESSION']);
});

test('after-close report and Saturday offline research are admitted without creating an execution daemon', () => {
  const report = scheduled('23 17 * * 1-5', '2026-11-27T22:23:00.000Z');
  assert.equal(report.run, true);
  assert.equal(report.slotId, 'daily-report-2026-11-27');

  const research = scheduled('43 11 * * 6', '2026-10-10T15:43:00.000Z');
  assert.equal(research.run, true);
  assert.equal(research.mode, 'research');
});

test('a stale options calendar never admits market-session work', () => {
  const stale = scheduled('17 10,13,15 * * 1-5', '2027-01-04T15:17:00.000Z');
  assert.equal(stale.run, false);
  assert.deepEqual(stale.reasons, ['CALENDAR_STALE']);
});

test('empty public-safe manifest is valid and remains explicitly not replayed', () => {
  assert.deepEqual(validateEvidenceManifest(manifest, policy), []);
  assert.equal(manifest.entries.length, 0);
  assert.equal(manifest.dataAvailability, 'UNKNOWN');
  assert.equal(manifest.historicalReplayStatus, 'HISTORICAL_REPLAY_NOT_RUN');
});

test('INDICATIVE executable GOOD fixture is diagnostic only, never OPRA execution-quality replay', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/theta-phase1-2026-10-05-session.json', 'utf8'));
  assert.equal(fixture.candidate.feed, 'INDICATIVE');
  assert.equal(fixture.candidate.executable, true);
  assert.equal(fixture.candidate.dataQuality, 'GOOD');

  const admission = classifyQuoteEvidenceAdmission({
    ...fixture.candidate,
    evidenceClass: 'DETERMINISTIC_SCENARIO_COMPARISON',
    historicalBboCoverage: 'UNKNOWN',
    entitlementStatus: 'UNKNOWN',
    pairedProtectivePutPresent: false,
    completeExitPathPresent: false,
  });
  assert.equal(admission.diagnosticStatus, 'INDICATIVE_DIAGNOSTIC_ALLOWED');
  assert.equal(admission.opraExecutionQualityReplay, 'NOT_ADMITTED');
  assert.ok(admission.reasons.includes('INDICATIVE_FEED_NOT_OPRA_EXECUTION_QUALITY'));
  assert.ok(admission.reasons.includes('PAIRED_PROTECTIVE_PUT_MISSING'));
  assert.ok(admission.reasons.includes('COMPLETE_EXIT_PATH_MISSING'));
});

test('fully documented, fresh, identity-matched OPRA evidence can pass the admission contract', () => {
  const admission = classifyQuoteEvidenceAdmission(qualifiedOpraEvidence());
  assert.equal(admission.opraExecutionQualityReplay, 'ADMITTED');
  assert.deepEqual(admission.reasons, []);
});

test('missing BBO is rejected even when all provenance flags claim verified', () => {
  const admission = classifyQuoteEvidenceAdmission(qualifiedOpraEvidence({ bid: null }));
  assert.equal(admission.opraExecutionQualityReplay, 'NOT_ADMITTED');
  assert.ok(admission.reasons.includes('BBO_MISSING'));
});

test('stale and future BBO timestamps are independently rejected', () => {
  const stale = classifyQuoteEvidenceAdmission(qualifiedOpraEvidence({
    quoteTimestamp: '2026-10-08T13:59:00.000Z',
    maximumQuoteAgeMs: 5_000,
  }));
  assert.ok(stale.reasons.includes('BBO_STALE'));
  const future = classifyQuoteEvidenceAdmission(qualifiedOpraEvidence({
    quoteTimestamp: '2026-10-08T14:00:02.000Z',
  }));
  assert.ok(future.reasons.includes('BBO_FUTURE_TIMESTAMP'));
});

test('mismatched BBO source SHA and option identity are rejected', () => {
  const admission = classifyQuoteEvidenceAdmission(qualifiedOpraEvidence({
    expectedSourceSha: 'b'.repeat(40),
    expectedOptionSymbol: 'QQQ261120P00600000',
  }));
  assert.equal(admission.opraExecutionQualityReplay, 'NOT_ADMITTED');
  assert.ok(admission.reasons.includes('BBO_SOURCE_SHA_MISMATCH'));
  assert.ok(admission.reasons.includes('BBO_OPTION_SYMBOL_MISMATCH'));
});

test('undocumented feed and incomplete option legs are rejected', () => {
  const admission = classifyQuoteEvidenceAdmission(qualifiedOpraEvidence({
    feedDocumentationStatus: 'UNKNOWN',
    feedDocumentationUrl: null,
    observedLegCount: 1,
  }));
  assert.equal(admission.opraExecutionQualityReplay, 'NOT_ADMITTED');
  assert.ok(admission.reasons.includes('BBO_FEED_UNDOCUMENTED'));
  assert.ok(admission.reasons.includes('OPTION_LEGS_INCOMPLETE'));
});

test('malformed manifest identity, path, hash and declared file size fail before file access', () => {
  const malformed = structuredClone(manifest);
  malformed.entries = [{
    kind: 'OBSERVATION_BUNDLE',
    path: '../private.json',
    sha256: 'bad',
    bytes: policy.limits.maximumInputFileBytes + 1,
    evidenceClass: 'REAL_MARKET_EVIDENCE',
    symbol: 'bad symbol',
    rowCount: -1,
    completeEpisodeCount: 0,
    comparisonCount: 0,
    resampleCount: 0,
  }];
  const errors = validateEvidenceManifest(malformed, policy);
  assert.ok(errors.some((error: string) => error.endsWith('PATH_INVALID')));
  assert.ok(errors.some((error: string) => error.endsWith('SHA256_INVALID')));
  assert.ok(errors.some((error: string) => error.endsWith('BYTES_INVALID')));
  assert.ok(errors.some((error: string) => error.endsWith('SYMBOL_INVALID')));
  assert.ok(errors.some((error: string) => error.endsWith('ROWCOUNT_INVALID')));
});

test('aggregate symbol and row caps reject a manifest rather than truncating it silently', () => {
  const overCap = structuredClone(manifest);
  overCap.entries = Array.from({ length: 6 }, (_, index) => ({
    kind: 'OBSERVATION_BUNDLE',
    path: 'config/research/evidence/bundle-' + index + '.json',
    sha256: String(index).repeat(64),
    bytes: 1,
    evidenceClass: 'REAL_MARKET_EVIDENCE',
    symbol: 'SYM' + index,
    rowCount: 4_000,
    completeEpisodeCount: 0,
    comparisonCount: 0,
    resampleCount: 0,
  }));
  const errors = validateEvidenceManifest(overCap, policy);
  assert.ok(errors.includes('MANIFEST_TOTAL_SYMBOLS_EXCEEDED'));
  assert.ok(errors.includes('MANIFEST_TOTAL_ROWS_EXCEEDED'));
});

test('public receipt and summary sanitation reject extra raw fields and credential-shaped text', () => {
  const receipt = {
    contractVersion: 'theta-zero-cost-research-receipt-v1',
    overallStatus: 'DATA_GAP',
    stages: [],
    recommendations: [],
    authority: {
      brokerAuthority: false,
      orderSubmissionAvailable: false,
      productionMutationAvailable: false,
    },
  };
  assert.deepEqual(validatePublicReceipt(receipt), []);
  assert.ok(validatePublicReceipt({ ...receipt, rawRows: [] }).includes('RECEIPT_KEY_FORBIDDEN:rawRows'));
  assert.equal(hasSensitiveText('ordinary public research summary'), false);
  assert.equal(hasSensitiveText('account_id=12345678'), true);
  assert.equal(hasSensitiveText('api_key=super-secret-value'), true);
});

test('workflow is read-only, SHA-pinned, bounded, default-off and has no broker/database/artifact path', () => {
  const workflow = readFileSync('.github/workflows/theta-research.yml', 'utf8');
  assert.deepEqual(validateWorkflowText(workflow), []);
  assert.equal((workflow.match(/^  bounded-research:$/gm) ?? []).length, 1);
  assert.equal((workflow.match(/^\s+uses:/gm) ?? []).length, 2);
  assert.ok(workflow.includes("cron: '17 10,13,15 * * 1-5'"));
  assert.ok(workflow.includes("cron: '23 17 * * 1-5'"));
  assert.ok(workflow.includes("cron: '43 11 * * 6'"));
});

test('new workflow tools contain no broker, execution, database or production runtime imports', () => {
  const gate = readFileSync('tools/theta-research-actions-gate.mjs', 'utf8');
  const orchestrator = readFileSync('tools/theta-research-actions.ts', 'utf8');
  const imports = [...(gate + '\n' + orchestrator).matchAll(/from\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  assert.equal(imports.some((path) => /alpaca|execution|postgres|database|autonomous-runtime/i.test(path)), false);
  assert.equal(orchestrator.includes('submitOrder'), false);
  assert.equal(orchestrator.includes('DATABASE_URL'), false);
});

test('current Q H D C DTE rules and Hold Strike no-roll action vocabulary remain unchanged', () => {
  const qPolicy = readFileSync('src/theta/paper-bootstrap-runtime-policy.ts', 'utf8');
  const strategies = readFileSync('src/theta/strategy-package.ts', 'utf8');
  const hLifecycle = readFileSync('src/theta/hold-strike-lifecycle.ts', 'utf8');
  assert.match(qPolicy, /minimumDte:\s*25/);
  assert.match(qPolicy, /maximumDte:\s*60/);
  assert.match(strategies, /THETA_HOLD_STRIKE[\s\S]*?dteMin:\s*2,\s*dteMax:\s*5/);
  assert.match(strategies, /THETA_CC[\s\S]*?dteMin:\s*1,\s*dteMax:\s*60/);
  assert.match(strategies, /THETA_DEFINED_RISK[\s\S]*?dteMin:\s*7,\s*dteMax:\s*60/);
  assert.match(hLifecycle, /HoldStrikeLifecycleAction='HOLD'\|'CLOSE_FULL'\|'LET_EXPIRE'\|'ACCEPT_ASSIGNMENT'/);
  assert.doesNotMatch(hLifecycle, /HoldStrikeLifecycleAction=[^\n]*ROLL/);
});
