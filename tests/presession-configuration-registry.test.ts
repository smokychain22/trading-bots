import assert from 'node:assert/strict';
import test from 'node:test';
import { auditPresessionConfiguration, decisionCriticalConfigurationFields, paperBootstrapRuntimePolicy,
  presessionConfigurationRegistry } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { paperBootstrapPreSubmitQuoteAgePolicy } from '../src/execution/master-paper-action-handoff.js';
import { defaultShadowCycleConfig } from '../src/theta/theta-shadow-once.js';

test('pre-session configuration registry has one valid typed authority', () => {
  const audit = auditPresessionConfiguration();
  assert.equal(audit.state, 'PASS');
  assert.equal(audit.duplicateNames.length, 0);
  assert.equal(audit.unregisteredFields.length, 0);
  assert.equal(audit.invalidEntries.length, 0);
  assert.equal(audit.entryCount, presessionConfigurationRegistry.length);
  assert.equal(audit.entryCount, decisionCriticalConfigurationFields.length);
  assert.equal(audit.entryCount, 30);
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
});
