import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThetaFirstPaperReadiness, firstPaperCheckNames, type FirstPaperChecks } from '../src/theta/first-paper-blocker-budget.js';

const allPass = (): FirstPaperChecks => Object.fromEntries(firstPaperCheckNames.map((field) =>
  [field, { state: 'PASS', source: 'verified-current-evidence' }])) as unknown as FirstPaperChecks;

test('only complete current evidence and zero audited blockers can report READY', () => {
  const input = { observedAt: '2026-09-22T12:00:00Z', checks: allPass(),
    avoidableUnknownCount: 0, implementationBlockerCount: 0 };
  assert.equal(buildThetaFirstPaperReadiness(input).status, 'READY');
  assert.equal(buildThetaFirstPaperReadiness({ ...input, avoidableUnknownCount: null }).status,
    'BLOCKED_IMPLEMENTATION');
});

test('external database uncertainty and independent AEGIS gap stay visible', () => {
  const checks = { ...allPass(),
    databaseWritable: { state: 'UNKNOWN' as const, source: 'database-readiness',
      blocker: 'DATABASE_WRITE_TRANSACTION_NOT_PROVEN', blockerClass: 'EXTERNAL' as const },
    aegisReady: { state: 'FAIL' as const, source: 'runtime-aegis',
      blocker: 'AEGIS_REQUIRED_INPUT_MISSING', blockerClass: 'IMPLEMENTATION' as const },
  };
  const result = buildThetaFirstPaperReadiness({ observedAt: '2026-09-22T12:00:00Z', checks,
    avoidableUnknownCount: 1, implementationBlockerCount: 1 });
  assert.equal(result.status, 'BLOCKED_EXTERNAL');
  assert.deepEqual(result.blockers.map(({ code }) => code),
    ['DATABASE_WRITE_TRANSACTION_NOT_PROVEN', 'AEGIS_REQUIRED_INPUT_MISSING']);
});

test('non-pass checks require an explicit blocker and evidence source', () => {
  assert.throws(() => buildThetaFirstPaperReadiness({observedAt:'2026-09-22T12:00:00Z',
    checks:{...allPass(),eventEvidenceReady:{state:'UNKNOWN',source:'',blocker:'UNKNOWN',blockerClass:'PROVIDER'}},
    avoidableUnknownCount:null,implementationBlockerCount:null}),/INCOMPLETE_READINESS_CHECK_eventEvidenceReady/);
});
