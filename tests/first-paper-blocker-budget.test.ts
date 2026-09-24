import assert from 'node:assert/strict';
import test from 'node:test';
import { assessReconciliationReadiness, assessRuntimeFirstPaperReadiness, buildThetaFirstPaperReadiness,
  firstPaperCheckNames, type FirstPaperChecks } from '../src/theta/first-paper-blocker-budget.js';
import type { RuntimeFirstPaperEvidence } from '../src/theta/runtime-behavior-diagnostic.js';

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

const runtimeEvidence=(overrides:Partial<RuntimeFirstPaperEvidence['symbols'][number]>={}):RuntimeFirstPaperEvidence=>({
  version:'theta-first-paper-runtime-evidence-v1',brokerMutationSurface:false,symbols:[{
    symbol:'SPY',cycleState:'COMPLETED',cycleErrorCode:null,optionChainComplete:true,optionContractsComplete:true,
    qLatticeTotal:4,qDecision:'OPEN_FULL',qReasonCodes:[],selectedCandidateId:'candidate-1',
    selectedOptionSymbol:'SPY260925P00600000',canonicalAction:'OPEN_FULL',selectedQuantity:1,aegisState:'ALLOW_FULL',
    entrySafetyPolicy:{action:'CLEAR',companyEventState:'FUND_NOT_APPLICABLE_CLEAR',
      corporateActionState:'PAPER_BOOTSTRAP_LIMITED',decisionAsOf:'2026-09-24T14:00:00.000Z'},
    runtimeTelemetry:{version:'theta-first-paper-runtime-telemetry-v1',candidateCount:4,conventionalCandidateCount:4,
      positiveSizeCandidateCount:1,zeroSizeCandidateCount:3,bindingConstraintCounts:{AEGIS:3},aegisStateCounts:{ALLOW_FULL:1},
      finalistRefresh:{state:'OBSERVED',policyVersion:'quote-age-v1',initialCandidateCount:4,selectedCount:1,refreshedCount:1,
        failedCount:0,candidateBuiltAt:'2026-09-24T14:00:00.000Z',finalistChosenAt:'2026-09-24T14:00:01.000Z',
        decisionAsOf:'2026-09-24T14:00:02.000Z',candidateToDecisionMs:2000,refreshRoundTripMsP50:100,
        refreshRoundTripMsP95:100,refreshedQuoteAgeAtDecisionSecondsP50:1,refreshedQuoteAgeAtDecisionSecondsP95:1,
        refreshedQuoteTimestampUnavailableCount:0},brokerAuthority:false},cycleBlockers:[],
    preSubmit:{symbol:'SPY',planState:'READY',planBlockers:[],preSubmitState:'READY_TO_SUBMIT_BUT_DISABLED',
      preSubmitBlockers:[],optionSymbol:'SPY260925P00600000',quoteProvider:'ALPACA',quoteSemantics:'ALPACA_EXECUTABLE_MARKET',
      quoteAgeMs:1000,limitPrice:1.23,quoteAgePolicyVersion:'quote-age-v1',brokerMutationSurface:false},...overrides,
  }]});

test('real current-release SPY evidence can prove every candidate-specific stage without broker mutation',()=>{
  const checks=assessRuntimeFirstPaperReadiness({evidence:runtimeEvidence(),approvedSymbol:'SPY',
    currentOpenPositions:0,reconciliationReady:true});
  for(const check of Object.values(checks))assert.equal(check.state,'PASS');
});

test('stages not naturally reached stay unknown and real AEGIS or sizing blockers remain explicit',()=>{
  const absent=assessRuntimeFirstPaperReadiness({evidence:null,approvedSymbol:'SPY',currentOpenPositions:0,reconciliationReady:true});
  assert.equal(absent.quotePipelineReady.state,'UNKNOWN');
  assert.equal(absent.managementCandidateSourceReady.state,'PASS');
  const base=runtimeEvidence().symbols[0];
  if(base===undefined||base.runtimeTelemetry===null)throw new Error('TEST_RUNTIME_EVIDENCE_MISSING');
  const blockedEvidence=runtimeEvidence({aegisState:'HOLD_ONLY',selectedQuantity:0,
    runtimeTelemetry:{...base.runtimeTelemetry,positiveSizeCandidateCount:0,zeroSizeCandidateCount:4,
      bindingConstraintCounts:{AEGIS:4}},preSubmit:null});
  const blockedChecks=assessRuntimeFirstPaperReadiness({evidence:blockedEvidence,approvedSymbol:'SPY',
    currentOpenPositions:0,reconciliationReady:true});
  assert.equal(blockedChecks.aegisReady.state,'FAIL');
  assert.equal(blockedChecks.positiveSizingReachable.state,'FAIL');
  assert.equal(blockedChecks.quotePipelineReady.state,'UNKNOWN');
  assert.equal(blockedChecks.paperPlanReachable.state,'UNKNOWN');
});
