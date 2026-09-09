import {
  buildFusionSnapshot,
  type FusionSnapshot,
  type FusionSnapshotInput,
  type JsonValue,
} from '../market/fusion-snapshot.js';
import {
  parseThetaQResponse,
  thetaQContractVersion,
  type ThetaQResponse,
} from './theta-q-contract.js';

export interface ThetaQClient {
  evaluate(request: Readonly<Record<string, JsonValue>>): Promise<unknown>;
}

export interface EvaluationInput {
  fusionSnapshot: FusionSnapshotInput;
  thetaQPayload: Readonly<Record<string, JsonValue>>;
}

export interface EvaluationResult {
  fusionSnapshot: FusionSnapshot;
  thetaQ: ThetaQResponse;
  newRiskEligible: boolean;
  blockReasons: readonly string[];
}

export async function evaluateFusionSnapshot(
  input: EvaluationInput,
  client: ThetaQClient,
): Promise<EvaluationResult> {
  const fusionSnapshot = buildFusionSnapshot(input.fusionSnapshot);
  const request = {
    ...input.thetaQPayload,
    contractVersion: thetaQContractVersion,
    operation: 'evaluateCspCandidates',
    fusionSnapshotHash: fusionSnapshot.contentHash,
  } satisfies Record<string, JsonValue>;

  const thetaQ = parseThetaQResponse(
    await client.evaluate(request),
    fusionSnapshot.contentHash,
  );
  const blockReasons: string[] = [];
  if (!fusionSnapshot.validForNewRisk) blockReasons.push('ALPACA_EXECUTABLE_TRUTH_NOT_GOOD');
  if (thetaQ.recommendation.actionCode === 'WAIT') blockReasons.push('THETA_Q_RECOMMENDS_WAIT');

  return {
    fusionSnapshot,
    thetaQ,
    newRiskEligible: blockReasons.length === 0,
    blockReasons: Object.freeze(blockReasons),
  };
}
