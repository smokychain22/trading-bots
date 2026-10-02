import assert from 'node:assert/strict';
import test from 'node:test';
import { auditPresessionConfiguration, decisionCriticalConfigurationFields, paperBootstrapRuntimePolicy,
  presessionConfigurationRegistry } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { paperBootstrapPreSubmitQuoteAgePolicy, preSubmitMaximumQuoteAgeMs } from '../src/execution/master-paper-action-handoff.js';
import { defaultShadowCycleConfig } from '../src/theta/theta-shadow-once.js';

test('pre-session configuration registry has one valid typed authority', () => {
  const audit = auditPresessionConfiguration();
  assert.equal(audit.state, 'PASS');
  assert.equal(audit.duplicateNames.length, 0);
  assert.equal(audit.unregisteredFields.length, 0);
  assert.equal(audit.invalidEntries.length, 0);
  assert.equal(audit.entryCount, presessionConfigurationRegistry.length);
  assert.equal(audit.entryCount, decisionCriticalConfigurationFields.length);
  assert.equal(audit.entryCount, 37); // Q-OWN-FLOOR-001 ownership floor; P2-03 the two named plan windows
  assert.ok(Object.values(audit.invariants).every(Boolean));
});

test('candidate, finalist, and pre-submit stages consume the shared quote-age authority', () => {
  const config = defaultShadowCycleConfig(
    { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'key', apiSecret: 'secret' },
    null,
    { pythonExecutablePath: 'python', scriptAllowlist: new Map(), timeoutMs: 1_000, maxOutputBytes: 10_000 },
    [], 'CALLER_MANUAL',
  );
  assert.equal(config.candidateQuoteAgePolicy.maxAgeSeconds, paperBootstrapRuntimePolicy.quoteAge.candidateMaximumSeconds);
  assert.equal(config.finalistQuoteRefreshPolicy.maxAgeSeconds, paperBootstrapRuntimePolicy.quoteAge.finalistMaximumSeconds);
  assert.equal(paperBootstrapPreSubmitQuoteAgePolicy.maximumAgeMs, paperBootstrapRuntimePolicy.quoteAge.preSubmitMaximumMilliseconds);
  assert.notEqual(config.candidateQuoteAgePolicy, config.finalistQuoteRefreshPolicy);
});

test('Q lattice, AEGIS, and sizing preserve bootstrap settings without claiming empirical promotion', () => {
  assert.equal(paperBootstrapRuntimePolicy.empiricalStatus, 'BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL');
  assert.equal(paperBootstrapRuntimePolicy.conventional.minimumDte, 25);
  assert.equal(paperBootstrapRuntimePolicy.conventional.maximumDte, 60);
  assert.equal(paperBootstrapRuntimePolicy.sizing.reducedStateMultiplier, 0.5);
  assert.equal(paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct, 0.15);
  assert.equal(paperBootstrapRuntimePolicy.portfolioCorrelation.policyVersion, 'theta-portfolio-correlation-paper-bootstrap-v1');
  assert.equal(paperBootstrapRuntimePolicy.portfolioCorrelation.minimumOverlappingReturns, 20);
});

test('P2-03 QUOTE_FRESHNESS_CONTRACT: decision evidence, plan window and submit cap are separate named clocks with explicit relations', () => {
  const age = paperBootstrapRuntimePolicy.quoteAge;
  assert.equal(age.candidateMaximumSeconds * 1000, 30_000, 'DECISION_EVIDENCE_MAX_AGE');
  assert.equal(age.planWindowManagementMilliseconds, 30_000, 'management plans never outlive decision evidence freshness');
  assert.equal(age.planWindowNewRiskMilliseconds, 45_000);
  assert.equal(age.preSubmitMaximumMilliseconds, 45_000, 'SUBMIT_EVIDENCE_MAX_AGE cap equals the longest plan window');
  assert.ok(age.preSubmitMaximumMilliseconds >= Math.max(age.planWindowNewRiskMilliseconds, age.planWindowManagementMilliseconds));
  const audit = auditPresessionConfiguration();
  assert.equal(audit.invariants.submitCapCoversPlanWindows, true);
  assert.equal(audit.invariants.managementPlanWindowWithinDecisionEvidenceAge, true);
  // the submit age actually applied is min(cap, time left in the plan window): a fresh decision cannot justify a stale submit
  const base = { policy: paperBootstrapPreSubmitQuoteAgePolicy, now: '2026-10-13T14:00:00.000Z' };
  assert.equal(preSubmitMaximumQuoteAgeMs({ ...base, decisionExpiresAt: '2026-10-13T14:00:30.000Z' }), 30_000, 'management window');
  assert.equal(preSubmitMaximumQuoteAgeMs({ ...base, decisionExpiresAt: '2026-10-13T14:00:45.000Z' }), 45_000, 'new-risk window');
  assert.equal(preSubmitMaximumQuoteAgeMs({ ...base, decisionExpiresAt: '2026-10-13T14:00:10.000Z' }), 10_000, 'late in the window the allowed age shrinks');
  assert.equal(preSubmitMaximumQuoteAgeMs({ ...base, decisionExpiresAt: '2026-10-13T13:59:59.000Z' }), null, 'an expired plan authorizes nothing');
  assert.equal(preSubmitMaximumQuoteAgeMs({ ...base, decisionExpiresAt: '2026-10-13T14:10:00.000Z' }), 45_000, 'never looser than the cap');
});
