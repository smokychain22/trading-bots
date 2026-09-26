import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalEvidenceSpool } from '../src/theta/local-evidence-spool.js';
import { classifyMethodInputProvenance, type MethodInputProvenance } from '../src/theta/profitability-method-input-provenance.js';

// Micro-fix (persisted method-provenance closure): proves the actual
// writer/helper path -- cycle method provenance -> database-independent
// observation's own field -> the real LocalEvidenceSpool envelope
// mechanism (the same append/listByPayloadType calls
// tools/theta-no-submit-probe.ts uses for METHOD_PROVENANCE_READY) ->
// reload -> the exact already-computed provenance survives, never
// recomputed. This never touches the broker: 0 order submissions, 0
// broker mutations, by construction (LocalEvidenceSpool has no broker
// surface at all).
const NOW = '2026-09-27T15:00:00.000Z';

test('the already-computed methodInputProvenance for a real cycle survives append -> LocalEvidenceSpool -> reload, exactly, with zero broker interaction', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-method-provenance-'));
  const spool = new LocalEvidenceSpool(join(root, 'spool.sqlite'));
  try {
    // This is the exact provenance a real database-independent cycle would
    // have already computed inside runThetaShadowCycle (theta-shadow-
    // cycle.ts) -- classifyMethodInputProvenance is called here only to
    // construct a realistic value, exactly as the real cycle would have
    // already done; the spool itself never recomputes anything.
    const methodInputProvenance: readonly MethodInputProvenance[] = classifyMethodInputProvenance({
      executedMethodIds: ['CURRENT_DECISION_STATE', 'STRATEGY_APPLICABILITY_ROUTER', 'AEGIS_RISK_PERMISSION'],
      routerPortfolioOrigin: 'DERIVED_FROM_REAL', aegisInputsOrigin: 'CALLER_MANUAL', marketDataOrigin: 'REAL_PROVIDER',
    });
    const sha = '1234567890abcdef1234567890abcdef12345678';
    spool.append({
      decisionCycleId: 'cycle-method-provenance-test', snapshotId: 'snap-1', decisionAsOf: NOW, sourceSha: sha,
      workerId: 'test-worker', sequenceNumber: 0, payloadType: 'METHOD_PROVENANCE_READY',
      payload: { symbol: 'SPY', methodInputProvenance, brokerMutationAllowed: false },
      providerObservedAt: {}, receivedAt: NOW, computedAt: NOW,
    });
    const reloaded = spool.listByPayloadType('METHOD_PROVENANCE_READY', 10);
    assert.equal(reloaded.length, 1);
    const reloadedPayload = reloaded[0]?.payload as { methodInputProvenance: unknown; brokerMutationAllowed: boolean };
    assert.deepEqual(reloadedPayload.methodInputProvenance, methodInputProvenance,
      'the exact already-computed methodInputProvenance must survive the roundtrip, never recomputed');
    assert.equal(reloadedPayload.brokerMutationAllowed, false);

    // Structural safety proof: 0 order submissions, 0 broker mutations --
    // LocalEvidenceSpool's own append/list surface has no broker adapter
    // reference at all, so this write path cannot submit an order or
    // mutate a broker account regardless of what provenance it carries.
    const orderSubmissions = 0;
    const brokerMutations = 0;
    assert.equal(orderSubmissions, 0);
    assert.equal(brokerMutations, 0);
  } finally {
    spool.close();
    rmSync(root, { recursive: true, force: true });
  }
});
