import { invokeAndValidate, type PythonBridgeConfig } from './python-bridge.js';
import { parseOwnershipEvaluationResponse, type OwnershipEvaluationResponse } from './ownership-contract.js';
import { parseRegimeSnapshotResponse, type RegimeSnapshotResponse } from './regime-contract.js';
import { parseStrategyRoutingResponse, eligibleFamilies, type StrategyRoutingResponse } from './strategy-router-contract.js';
import { parseParetoFrontierResponse, survivingCandidateIds, type CandidateEconomics } from './pareto-frontier-contract.js';
import { parseOpportunityFrontierResponse, type OpportunityFrontierResponse } from './opportunity-frontier-contract.js';
import { parseAegisAssessmentResponse, type AegisAssessmentResponse } from './aegis-contract.js';
import { parseSizingResultResponse } from './sizing-contract.js';
import { parseExecutionQualityResponse } from './execution-quality-contract.js';
import { assembleNewRiskDecision, type CandidateFrontierResult, type NewRiskDecisionReceipt } from './decision-assembly.js';
import type { NormalizedOptionContract } from './option-contract.js';

// R1: the real end-to-end new-risk orchestrator. Sequences every stage in
// the canonical pipeline --
//   OWNERSHIP -> REGIME -> STRATEGY ROUTER -> [candidate economics, supplied
//   by the caller -- this module generates no economic number itself] ->
//   PARETO FRONTIER -> AEGIS -> OPPORTUNITY FRONTIER -> SIZING ->
//   EXECUTION QUALITY -> FINAL DECISION ASSEMBLY
// -- through python-bridge.ts, and returns both the final decision receipt
// AND every intermediate stage's output, so a caller (shadow-opportunity-book,
// /ops diagnostics, a future R2 ledger writer) can persist the complete,
// reproducible trail a single receipt field can't hold on its own.
//
// AEGIS runs before the opportunity frontier, not after, even though the
// task's conceptual diagram lists PARETO -> OPPORTUNITY -> AEGIS -> SIZING:
// opportunity_frontier.py's CandidateSnapshot takes aegisPermitsFull/
// aegisPermitsReduced as INPUT (it classifies using already-computed AEGIS
// output, per that module's own docstring), so AEGIS must be computed first
// for opportunity_frontier to have anything to consume. This is a data-
// dependency ordering, not a deviation from the pipeline's intent: every
// stage still runs, once, in the only order the data allows.
//
// This module invents no missing model: THETA-Q's baseline (theta_q_baseline.py)
// does not yet have a calibrated entry-outcome model, so evNet legitimately
// arrives here as null for every candidate until that model exists (R6).
// A null evNet correctly and honestly routes a candidate through
// REQUIRED_INPUT_UNKNOWN -> PASS, exactly like every other missing input in
// this codebase -- this orchestrator does not fabricate a workaround.
//
// Any bridge-call failure at any stage fails the WHOLE decision closed
// (HARD_VETO, quantity 0) rather than attempting a partial assembly with a
// stage silently skipped.

export interface CandidateInput {
  readonly candidateId: string;
  readonly contract: NormalizedOptionContract;
  readonly economics: Omit<CandidateEconomics, 'candidateId'>;
  readonly hasAlternateContract: boolean;
  readonly hasAlternateExpiry: boolean;
  readonly hasAlternateStructure: boolean;
  readonly ivCompensationSufficient: boolean | null;
  readonly quoteSize: number | null;
  readonly quoteAgeSeconds: number | null;
  readonly preSlippageExpectedUtility: number | null;
}

export interface NewRiskOrchestrationRequest {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly underlying: string;
  readonly providerStateGood: boolean;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>;

  readonly ownershipPolicy: Record<string, unknown>;
  readonly ownershipInputs: Record<string, unknown>;
  readonly regimePolicy: Record<string, unknown>;
  readonly regimeInputs: Record<string, unknown>;
  readonly routerPolicy: Record<string, unknown> & { thetaQMinOwnershipAcceptability: number };
  readonly routerPortfolio: Record<string, unknown>;

  readonly aegisPolicy: Record<string, unknown>;
  readonly aegisInputs: Record<string, unknown>;

  readonly opportunityFrontierPolicy: { policyVersion: string; reducedSizeUncertaintyThreshold: number };
  readonly maxAcceptableSpreadPct: number; // shared liquidity-acceptability floor for opportunity-frontier derivation

  readonly candidates: readonly CandidateInput[];

  readonly sizingPolicy: Record<string, unknown>;
  readonly sizingAccount: { equity: number | null; cash: number | null; buyingPower: number | null; brokerAllowedQty: number };
  readonly executionQualityPolicy: Record<string, unknown>;
}

export interface NewRiskOrchestrationResult {
  readonly receipt: NewRiskDecisionReceipt;
  readonly ownership: OwnershipEvaluationResponse | null;
  readonly regime: RegimeSnapshotResponse | null;
  readonly routing: StrategyRoutingResponse | null;
  readonly aegis: AegisAssessmentResponse | null;
  readonly paretoSurvivorIds: readonly string[] | null;
  readonly opportunityBook: OpportunityFrontierResponse | null;
}

const failClosedResult = (
  request: NewRiskOrchestrationRequest,
  stage: string,
  detail: string,
  partial: Partial<Omit<NewRiskOrchestrationResult, 'receipt'>> = {},
): NewRiskOrchestrationResult => ({
  receipt: {
    decisionId: `${request.snapshotId}:${request.underlying}`,
    snapshotId: request.snapshotId,
    fusionSnapshotHash: request.fusionSnapshotHash,
    timestamp: request.timestamp,
    underlying: request.underlying,
    winningAction: 'HARD_VETO',
    selectedCandidateId: null,
    quantity: 0,
    alternatives: [],
    ownershipSnapshotId: null,
    regimeSnapshotId: null,
    executionAuthorized: false,
    reasonCodes: [`PIPELINE_STAGE_FAILED:${stage}`],
    plainEnglishExplanation: `Orchestration failed closed at stage ${stage}: ${detail}`,
    failClosedReason: detail,
    policyVersion: request.policyVersion,
    modelVersions: request.modelVersions,
  },
  ownership: null,
  regime: null,
  routing: null,
  aegis: null,
  paretoSurvivorIds: null,
  opportunityBook: null,
  ...partial,
});

const requiredCollateralPerContract = (contract: NormalizedOptionContract): number => contract.strike * contract.multiplier;

export async function runNewRiskOrchestration(
  bridge: PythonBridgeConfig,
  request: NewRiskOrchestrationRequest,
): Promise<NewRiskOrchestrationResult> {
  if (!request.providerStateGood) {
    return failClosedResult(request, 'PROVIDER_STATE', 'Required provider state is not GOOD.');
  }

  const ownershipResult = await invokeAndValidate(
    bridge, 'ownership',
    { contractVersion: 'theta-ownership-runtime-v1', snapshotId: request.snapshotId, underlyingSymbol: request.underlying, timestamp: request.timestamp, policy: request.ownershipPolicy, inputs: request.ownershipInputs },
    (payload) => parseOwnershipEvaluationResponse(payload),
  );
  if (!ownershipResult.ok) return failClosedResult(request, 'OWNERSHIP', ownershipResult.detail);

  const regimeResult = await invokeAndValidate(
    bridge, 'regime',
    { contractVersion: 'theta-regime-runtime-v1', snapshotId: request.snapshotId, timestamp: request.timestamp, policy: request.regimePolicy, inputs: request.regimeInputs },
    (payload) => parseRegimeSnapshotResponse(payload),
  );
  if (!regimeResult.ok) return failClosedResult(request, 'REGIME', regimeResult.detail, { ownership: ownershipResult.data });

  const routerResult = await invokeAndValidate(
    bridge, 'strategyRouter',
    {
      contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: request.snapshotId, timestamp: request.timestamp,
      policy: request.routerPolicy,
      portfolio: request.routerPortfolio,
      market: {
        ownershipAcceptable: ownershipResult.data.ownability,
        liquidityAcceptable: regimeResult.data.liquidityState === null ? null : regimeResult.data.liquidityState === 'NORMAL',
        eventNear: regimeResult.data.eventState !== null && regimeResult.data.eventState !== 'NONE',
        criticalDataValid: true,
      },
    },
    (payload) => parseStrategyRoutingResponse(payload),
  );
  if (!routerResult.ok) {
    return failClosedResult(request, 'STRATEGY_ROUTER', routerResult.detail, { ownership: ownershipResult.data, regime: regimeResult.data });
  }

  const thetaQEligible = eligibleFamilies(routerResult.data).includes('THETA_Q');
  const partialAfterRouting = { ownership: ownershipResult.data, regime: regimeResult.data, routing: routerResult.data };

  if (!thetaQEligible || request.candidates.length === 0) {
    const receipt = assembleNewRiskDecision({
      snapshotId: request.snapshotId, fusionSnapshotHash: request.fusionSnapshotHash, timestamp: request.timestamp,
      underlying: request.underlying, ownership: ownershipResult.data, regime: regimeResult.data, candidates: [],
      policyVersion: request.policyVersion, modelVersions: request.modelVersions,
      requiredModelVersions: request.requiredModelVersions, providerStateGood: true,
    });
    return { receipt, ...partialAfterRouting, aegis: null, paretoSurvivorIds: null, opportunityBook: null };
  }

  const paretoResult = await invokeAndValidate(
    bridge, 'paretoFrontier',
    {
      contractVersion: 'theta-pareto-frontier-runtime-v1', snapshotId: request.snapshotId, timestamp: request.timestamp,
      candidates: request.candidates.map((c) => ({ candidateId: c.candidateId, ...c.economics })),
    },
    (payload) => parseParetoFrontierResponse(payload),
  );
  if (!paretoResult.ok) return failClosedResult(request, 'PARETO_FRONTIER', paretoResult.detail, partialAfterRouting);
  const survivorIds = new Set(survivingCandidateIds(paretoResult.data));

  const aegisResult = await invokeAndValidate(
    bridge, 'aegis',
    { contractVersion: 'theta-aegis-runtime-v1', decisionId: `${request.snapshotId}:${request.underlying}`, snapshotId: request.snapshotId, timestamp: request.timestamp, policy: request.aegisPolicy, inputs: request.aegisInputs },
    (payload) => parseAegisAssessmentResponse(payload),
  );
  if (!aegisResult.ok) {
    return failClosedResult(request, 'AEGIS', aegisResult.detail, { ...partialAfterRouting, paretoSurvivorIds: [...survivorIds] });
  }

  const survivors = request.candidates.filter((c) => survivorIds.has(c.candidateId));
  const opportunityResult = await invokeAndValidate(
    bridge, 'opportunityFrontier',
    {
      contractVersion: 'theta-opportunity-frontier-runtime-v1', snapshotId: request.snapshotId, timestamp: request.timestamp,
      policy: request.opportunityFrontierPolicy,
      candidates: survivors.map((c) => ({
        candidateId: c.candidateId,
        underlyingSymbol: c.contract.underlying,
        evNet: c.economics.evNet,
        returnPerCapitalDay: c.economics.returnPerCapitalDay,
        ownershipAcceptable: ownershipResult.data.ownability === null ? null : ownershipResult.data.ownability >= request.routerPolicy.thetaQMinOwnershipAcceptability,
        liquidityAcceptable: c.contract.spreadPct === null ? null : c.contract.spreadPct <= request.maxAcceptableSpreadPct,
        ivCompensationSufficient: c.ivCompensationSufficient,
        eventNear: regimeResult.data.eventState === null ? true : regimeResult.data.eventState !== 'NONE',
        regimeAcceptable:
          regimeResult.data.stressState === null || regimeResult.data.volatilityState === null
            ? null
            : regimeResult.data.stressState !== 'CRISIS' && regimeResult.data.volatilityState !== 'SHOCK',
        modelUncertainty: null,
        aegisPermitsFull: aegisResult.data.newRiskState === 'ALLOW_FULL',
        aegisPermitsReduced: aegisResult.data.newRiskState === 'ALLOW_FULL' || aegisResult.data.newRiskState === 'ALLOW_REDUCED',
        hasAlternateContract: c.hasAlternateContract,
        hasAlternateExpiry: c.hasAlternateExpiry,
        hasAlternateStructure: c.hasAlternateStructure,
      })),
    },
    (payload) => parseOpportunityFrontierResponse(payload),
  );
  if (!opportunityResult.ok) {
    return failClosedResult(request, 'OPPORTUNITY_FRONTIER', opportunityResult.detail, {
      ...partialAfterRouting, aegis: aegisResult.data, paretoSurvivorIds: [...survivorIds],
    });
  }

  const entryByCandidateId = new Map(opportunityResult.data.entries.map((entry) => [entry.candidateId, entry]));
  const OPEN_DISPOSITIONS = new Set(['OPEN_FULL', 'OPEN_REDUCED', 'OPEN_ALTERNATE_CONTRACT', 'OPEN_ALTERNATE_EXPIRY', 'OPEN_ALTERNATE_STRUCTURE']);

  const candidateResults: CandidateFrontierResult[] = [];
  for (const candidate of request.candidates) {
    const entry = entryByCandidateId.get(candidate.candidateId);
    if (entry === undefined) {
      // Dominated by pareto or otherwise never reached the opportunity
      // frontier -- still recorded as a PASS alternative, never dropped
      // silently (CAND-002: retain rejected alternatives).
      candidateResults.push({
        candidateId: candidate.candidateId, contract: candidate.contract, disposition: 'PASS', waitReason: null,
        rejectionReason: survivorIds.has(candidate.candidateId) ? 'NOT_EVALUATED' : 'PARETO_DOMINATED',
        evNet: candidate.economics.evNet, returnPerCapitalDay: candidate.economics.returnPerCapitalDay,
        aegis: null, sizing: null, executionQuality: null,
      });
      continue;
    }

    const isOpen = OPEN_DISPOSITIONS.has(entry.disposition);
    if (!isOpen) {
      candidateResults.push({
        candidateId: candidate.candidateId, contract: candidate.contract,
        disposition: entry.disposition as CandidateFrontierResult['disposition'],
        waitReason: entry.waitReason, rejectionReason: entry.rejectionCategory,
        evNet: candidate.economics.evNet, returnPerCapitalDay: candidate.economics.returnPerCapitalDay,
        aegis: null, sizing: null, executionQuality: null,
      });
      continue;
    }

    const sizingResult = await invokeAndValidate(
      bridge, 'sizing',
      {
        contractVersion: 'theta-sizing-runtime-v1', decisionId: `${request.snapshotId}:${request.underlying}`,
        snapshotId: request.snapshotId, timestamp: request.timestamp, policy: request.sizingPolicy,
        inputs: {
          equity: request.sizingAccount.equity, cash: request.sizingAccount.cash, buyingPower: request.sizingAccount.buyingPower,
          requiredCollateralPerContract: requiredCollateralPerContract(candidate.contract),
          brokerAllowedQty: request.sizingAccount.brokerAllowedQty, riskState: aegisResult.data.newRiskState,
        },
      },
      (payload) => parseSizingResultResponse(payload),
    );
    if (!sizingResult.ok) {
      return failClosedResult(request, 'SIZING', sizingResult.detail, {
        ...partialAfterRouting, aegis: aegisResult.data, paretoSurvivorIds: [...survivorIds], opportunityBook: opportunityResult.data,
      });
    }

    const executionQualityResult = await invokeAndValidate(
      bridge, 'executionQuality',
      {
        contractVersion: 'theta-execution-quality-runtime-v1', decisionId: `${request.snapshotId}:${request.underlying}`,
        snapshotId: request.snapshotId, timestamp: request.timestamp, policy: request.executionQualityPolicy,
        inputs: {
          bid: candidate.contract.bid, ask: candidate.contract.ask, quoteSize: candidate.quoteSize,
          quoteAgeSeconds: candidate.quoteAgeSeconds, limitPrice: candidate.contract.bid ?? 0,
          preSlippageExpectedUtility: candidate.preSlippageExpectedUtility,
        },
      },
      (payload) => parseExecutionQualityResponse(payload),
    );
    if (!executionQualityResult.ok) {
      return failClosedResult(request, 'EXECUTION_QUALITY', executionQualityResult.detail, {
        ...partialAfterRouting, aegis: aegisResult.data, paretoSurvivorIds: [...survivorIds], opportunityBook: opportunityResult.data,
      });
    }

    candidateResults.push({
      candidateId: candidate.candidateId, contract: candidate.contract,
      disposition: entry.disposition as CandidateFrontierResult['disposition'],
      waitReason: entry.waitReason, rejectionReason: entry.rejectionCategory,
      evNet: candidate.economics.evNet, returnPerCapitalDay: candidate.economics.returnPerCapitalDay,
      aegis: aegisResult.data, sizing: sizingResult.data, executionQuality: executionQualityResult.data,
    });
  }

  const receipt = assembleNewRiskDecision({
    snapshotId: request.snapshotId, fusionSnapshotHash: request.fusionSnapshotHash, timestamp: request.timestamp,
    underlying: request.underlying, ownership: ownershipResult.data, regime: regimeResult.data,
    candidates: candidateResults, policyVersion: request.policyVersion, modelVersions: request.modelVersions,
    requiredModelVersions: request.requiredModelVersions, providerStateGood: true,
  });

  return {
    receipt, ownership: ownershipResult.data, regime: regimeResult.data, routing: routerResult.data,
    aegis: aegisResult.data, paretoSurvivorIds: [...survivorIds], opportunityBook: opportunityResult.data,
  };
}
