import assert from 'node:assert/strict';
import test from 'node:test';

import type { FusionSnapshotInput, JsonValue } from '../src/market/fusion-snapshot.js';
import { evaluateFusionSnapshot, type ThetaQClient } from '../src/theta/evaluation.js';

function snapshotFixture(): FusionSnapshotInput {
  const hash = 'd'.repeat(64);
  const provenance = (truthRole: 'ACCOUNT' | 'CONTRACT' | 'QUOTE') => ({
    provider: 'ALPACA' as const,
    operationAlias: `alpaca.${truthRole.toLowerCase()}`,
    asOf: '2026-09-09T18:30:00Z',
    retrievedAt: '2026-09-09T18:30:01Z',
    state: 'GOOD' as const,
    contentHash: hash,
    feed: truthRole === 'QUOTE' ? 'OPRA' : null,
    contractVersion: 'alpaca-v2',
    truthRole,
    requiredForNewRisk: true,
  });
  return {
    botId: 'THETA', decisionTimeUtc: '2026-09-09T18:30:02Z', triggerType: 'PERIODIC_SCAN',
    marketSession: {}, underlyingState: {}, contractCandidates: [], accountState: {}, positionState: {},
    portfolioExposure: {}, strategyRouterState: {},
    alpacaQuoteState: {}, optionomicsFeatureState: {}, eventState: {}, regimeState: {},
    expertPriorState: {}, riskState: {},
    versions: {
      strategyVersion: 's1', featureVersion: 'f1', riskLimitVersion: 'r1',
      executionVersion: 'e1', costModelVersion: 'c1', dataVersion: 'd1', modelVersions: {},
    },
    sourceProvenance: [provenance('ACCOUNT'), provenance('CONTRACT'), provenance('QUOTE')],
    providerHealth: [],
    freshnessFlags: [], unknownFeatures: [],
    executableTruth: { account: 'GOOD', contract: 'GOOD', quote: 'GOOD' },
  };
}

class SyntheticThetaQClient implements ThetaQClient {
  public lastRequest: Readonly<Record<string, JsonValue>> | undefined;

  async evaluate(request: Readonly<Record<string, JsonValue>>): Promise<unknown> {
    this.lastRequest = request;
    return {
      contractVersion: 'theta-q-runtime-v1',
      fusionSnapshotHash: request.fusionSnapshotHash,
      candidates: [],
      wait: { candidateId: 'WAIT', actionFeasible: true, quantity: 0 },
      recommendation: {
        actionCode: 'WAIT', selectedCandidateId: 'WAIT', quantity: 0,
        executionAuthorized: false, requiresAegis: true, requiresFreshAlpacaBbo: true,
      },
    };
  }
}

test('binds THETA-Q evaluation to the immutable FusionSnapshot hash', async () => {
  const client = new SyntheticThetaQClient();
  const result = await evaluateFusionSnapshot(
    { fusionSnapshot: snapshotFixture(), thetaQPayload: { candidates: [] } },
    client,
  );

  assert.equal(client.lastRequest?.fusionSnapshotHash, result.fusionSnapshot.contentHash);
  assert.deepEqual(result.blockReasons, ['THETA_Q_RECOMMENDS_WAIT']);
  assert.equal(result.newRiskEligible, false);
});

test('blocks new risk when Alpaca executable truth is stale', async () => {
  const client = new SyntheticThetaQClient();
  const snapshot = snapshotFixture();
  snapshot.executableTruth.quote = 'STALE';
  const result = await evaluateFusionSnapshot(
    { fusionSnapshot: snapshot, thetaQPayload: { candidates: [] } },
    client,
  );

  assert.equal(result.newRiskEligible, false);
  assert.ok(result.blockReasons.includes('ALPACA_EXECUTABLE_TRUTH_NOT_GOOD'));
});
