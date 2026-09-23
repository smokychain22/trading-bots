import assert from 'node:assert/strict';
import test from 'node:test';
import { assessReconciliationReadiness, buildThetaFirstPaperReadiness, firstPaperCheckNames, type FirstPaperChecks } from '../src/theta/first-paper-blocker-budget.js';

test('broker connectivity cannot hide current-impact or local-only facts', () => {
  const base={workerCycleHealthy:true,lastReconciliation:'2026-09-22T13:46:00Z',
    entryBlockingFactCount:0,localOnlyIntentCount:0};
  assert.equal(assessReconciliationReadiness(base).state,'PASS');
  assert.deepEqual(assessReconciliationReadiness({...base,entryBlockingFactCount:1}),{
    state:'FAIL',source:'latest-broker-reconciliation-snapshot',
    blocker:'CURRENT_OR_UNKNOWN_BROKER_IMPACT_PRESENT',blockerClass:'POLICY'});
  assert.equal(assessReconciliationReadiness({...base,localOnlyIntentCount:1}).state,'FAIL');
  assert.equal(assessReconciliationReadiness({...base,entryBlockingFactCount:null}).state,'UNKNOWN');
});

const allPass = (): FirstPaperChecks => Object.fromEntries(firstPaperCheckNames.map((field) =>
  [field, { state: 'PASS', source: 'verified-current-evidence' }])) as unknown as FirstPaperChecks;

test('only complete current evidence and zero audited blockers can report READY', () => {
  const input = { observedAt: '2026-09-22T12:00:00Z', checks: allPass(),
    unknownAuditCoverage: 'COMPLETE' as const, avoidableUnknownCount: 0,
    implementationBlockerCount: 0, unresolvedSafetyCriticalCount: 0, unresolvedPaperEntryCount: 0 };
  assert.equal(buildThetaFirstPaperReadiness(input).status, 'READY');
  assert.equal(buildThetaFirstPaperReadiness({ ...input, avoidableUnknownCount: null }).status,
    'BLOCKED_IMPLEMENTATION');
  assert.equal(buildThetaFirstPaperReadiness({ ...input, unknownAuditCoverage: 'PARTIAL' }).status,
    'BLOCKED_IMPLEMENTATION');
  const providerLimitedSafety = buildThetaFirstPaperReadiness({ ...input, unresolvedSafetyCriticalCount: 1 });
  assert.equal(providerLimitedSafety.status, 'BLOCKED_POLICY');
  assert.ok(providerLimitedSafety.blockers.some((blocker) => blocker.field === 'unresolvedSafetyCriticalCount'));
  const paperEntryOpen = buildThetaFirstPaperReadiness({ ...input, unresolvedPaperEntryCount: 1 });
  assert.equal(paperEntryOpen.status, 'BLOCKED_POLICY');
  assert.ok(paperEntryOpen.blockers.some((blocker) => blocker.field === 'unresolvedPaperEntryCount'));
});

test('external database uncertainty and independent AEGIS gap stay visible', () => {
  const checks = { ...allPass(),
    databaseWritable: { state: 'UNKNOWN' as const, source: 'database-readiness',
      blocker: 'DATABASE_WRITE_TRANSACTION_NOT_PROVEN', blockerClass: 'EXTERNAL' as const },
    aegisReady: { state: 'FAIL' as const, source: 'runtime-aegis',
      blocker: 'AEGIS_REQUIRED_INPUT_MISSING', blockerClass: 'IMPLEMENTATION' as const },
  };
  const result = buildThetaFirstPaperReadiness({ observedAt: '2026-09-22T12:00:00Z', checks,
    unknownAuditCoverage: 'COMPLETE', avoidableUnknownCount: 1, implementationBlockerCount: 1,
    unresolvedSafetyCriticalCount: 1, unresolvedPaperEntryCount: 1 });
  assert.equal(result.status, 'BLOCKED_EXTERNAL');
  assert.deepEqual(result.blockers.slice(0, 2).map(({ code }) => code),
    ['DATABASE_WRITE_TRANSACTION_NOT_PROVEN', 'AEGIS_REQUIRED_INPUT_MISSING']);
});

test('non-pass checks require an explicit blocker and evidence source', () => {
  assert.throws(() => buildThetaFirstPaperReadiness({observedAt:'2026-09-22T12:00:00Z',
    checks:{...allPass(),eventEvidenceReady:{state:'UNKNOWN',source:'',blocker:'UNKNOWN',blockerClass:'PROVIDER'}},
    unknownAuditCoverage:'PARTIAL',avoidableUnknownCount:null,implementationBlockerCount:null,
    unresolvedSafetyCriticalCount:null,unresolvedPaperEntryCount:null}),/INCOMPLETE_READINESS_CHECK_eventEvidenceReady/);
});
