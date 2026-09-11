import { randomUUID } from 'node:crypto';
import { invokeAndValidate, type PythonBridgeConfig } from './python-bridge.js';
import { parseOwnershipEvaluationResponse, type OwnershipEvaluationResponse } from './ownership-contract.js';
import { parseRegimeSnapshotResponse, type RegimeSnapshotResponse } from './regime-contract.js';
import { parseStrategyRoutingResponse, eligibleFamilies, type StrategyRoutingResponse } from './strategy-router-contract.js';
import { parseThetaQResponse, type ThetaQResponse } from './theta-q-contract.js';
import { parseParetoFrontierResponse, survivingCandidateIds, type CandidateEconomics } from './pareto-frontier-contract.js';
import { parseOpportunityFrontierResponse, type OpportunityFrontierResponse } from './opportunity-frontier-contract.js';
import { parseAegisAssessmentResponse, type AegisAssessmentResponse } from './aegis-contract.js';
import { parseSizingResultResponse } from './sizing-contract.js';
import { parseExecutionQualityResponse } from './execution-quality-contract.js';
import { assembleNewRiskDecision, type CandidateFrontierResult, type NewRiskDecisionReceipt } from './decision-assembly.js';
import type { NormalizedOptionContract } from './option-contract.js';
import { ShadowOpportunityBookBuilder, type ShadowOpportunityEntry } from './shadow-opportunity-book.js';
import { classifyObservation, type DataQualityState, type FreshnessPolicy } from './data-freshness.js';

// R1: the real end-to-end new-risk orchestrator. Sequences every stage in
// the canonical pipeline --
//   OWNERSHIP -> REGIME -> STRATEGY ROUTER -> THETA-Q CANDIDATE LATTICE ->
//   PARETO FRONTIER -> AEGIS -> OPPORTUNITY FRONTIER -> SIZING ->
//   EXECUTION QUALITY -> FINAL DECISION ASSEMBLY -> SHADOW OPPORTUNITY BOOK
// -- through python-bridge.ts, and returns the final decision receipt, every
// intermediate stage's raw output, AND a populated shadow-opportunity-book
// (every legitimate candidate this cycle evaluated, not only the winner).
//
// theta_q_contract.py (the lattice + transparent baseline) is now the REAL
// candidate-economics source -- this module no longer accepts caller-
// supplied economics. A caller supplies the raw normalized option chain
// (already-quoted, already-Greeked contracts, from a real provider or a
// synthetic fixture) plus the underlying-level facts theta_q_baseline.py's
// CspCandidateInputs needs that aren't part of a contract itself
// (entryPremiumPerShare assumption, severeDrawdownProbability, ivRank,
// brokerAllowedQty, contractIsStandard).
//
// A contract with an UNKNOWN delta is excluded from the theta_q lattice
// call before it is ever sent to Python -- theta_q_lattice.py's
// ChainContract.put_delta_magnitude is a required float, and comparing
// None against a delta band would raise inside Python rather than fail
// closed gracefully. This module treats that exclusion itself as a
// PASS/UNKNOWN_DELTA outcome, never a silent drop (CAND-002).
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
// This module invents no missing model: THETA-Q's baseline has no
// calibrated entry-outcome model yet, so ev_net legitimately arrives as
// null for every candidate until that model exists (R6). CapitalDays and
// ReturnPerCapitalDay ARE computed here, but only as plain arithmetic over
// already-known quantities (capital tied up x days committed; EV / capital-
// days) -- never a fabricated probability or alpha estimate.
//
// Any bridge-call failure at any stage holds the WHOLE decision closed
// (SYSTEM_HOLD, quantity 0) rather than attempting a partial assembly with a
// stage silently skipped.

export interface RawCandidateInput {
  readonly candidateId: string;
  readonly contract: NormalizedOptionContract;
  readonly entryPremiumPerShare: number;
  readonly severeDrawdownProbability: number | null;
  readonly ivRank: number | null;
  readonly brokerAllowedQty: number;
  readonly contractIsStandard: boolean;
  readonly hasAlternateContract: boolean;
  readonly hasAlternateExpiry: boolean;
  readonly hasAlternateStructure: boolean;
  readonly ivCompensationSufficient: boolean | null;
  readonly quoteSize: number | null;
  readonly preSlippageExpectedUtility: number | null;
}

// Structured provider capability/observation state (replaces the former
// single providerStateGood boolean, which could not express "account GOOD,
// option chain STALE, positions UNKNOWN" as three separate facts). Reuses
// data-freshness.ts's DataQualityState so both modules speak the same
// six-value vocabulary rather than inventing a parallel one. This is a
// CAPABILITY/OBSERVATION snapshot for THIS cycle, not a general provider
// health registry -- each key's value reflects what actually happened when
// this cycle tried to use that capability, never a static "is it
// supported" fact (that distinction belongs to a future provider-registry
// module, not this per-cycle request type).
export type ProviderCapabilityKey =
  | 'ALPACA_ACCOUNT' | 'ALPACA_POSITIONS' | 'ALPACA_OPEN_ORDERS'
  | 'ALPACA_OPTION_CONTRACTS' | 'ALPACA_OPTION_CHAIN'
  | 'OPTIONOMICS' | 'EVENT_DATA';

export type ProviderCapabilityStates = Readonly<Partial<Record<ProviderCapabilityKey, DataQualityState>>>;

// Only these three gate new-risk evaluation entirely (they map directly to
// FusionSnapshot's executableTruth ACCOUNT/CONTRACT/QUOTE truth roles).
// Positions/open-orders/Optionomics/event-data are informational this
// cycle -- not yet consumed as hard gates by AEGIS/sizing, so their
// UNKNOWN/DEGRADED state does not by itself block evaluation. Extending
// this list is the natural place to wire a future hard requirement.
const REQUIRED_FOR_NEW_RISK: readonly ProviderCapabilityKey[] = ['ALPACA_ACCOUNT', 'ALPACA_OPTION_CONTRACTS', 'ALPACA_OPTION_CHAIN'];

// HARD_VETO is reserved for a genuine risk/safety prohibition: the account
// is invalid or trading is blocked (INVALID), or THETA is not entitled to
// the data at all (NOT_ENTITLED). STALE/DEGRADED/UNKNOWN -- and a capability
// key missing entirely -- are transient data conditions: a provider outage,
// a slow refresh, or a call that simply hasn't happened yet. These must
// never be treated as a risk veto (that would contaminate risk-veto
// statistics with plain data unavailability); they defer evaluation instead.
const HARD_VETO_CAPABILITY_STATES: ReadonlySet<DataQualityState> = new Set(['INVALID', 'NOT_ENTITLED']);

type RequiredCapabilityFailure = 'NONE' | 'HARD_VETO' | 'TRANSIENT';

function requiredCapabilityFailureKind(capabilities: ProviderCapabilityStates): RequiredCapabilityFailure {
  let anyTransient = false;
  for (const key of REQUIRED_FOR_NEW_RISK) {
    const state = capabilities[key];
    if (state === 'GOOD') continue;
    if (state !== undefined && HARD_VETO_CAPABILITY_STATES.has(state)) return 'HARD_VETO';
    anyTransient = true; // STALE, DEGRADED, UNKNOWN, or not yet attempted
  }
  return anyTransient ? 'TRANSIENT' : 'NONE';
}


export interface NewRiskOrchestrationRequest {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly underlying: string;
  readonly earningsDistanceDays: number | null; // underlying-level fact, shared across every candidate this cycle
  readonly optionQuoteFreshnessPolicy: FreshnessPolicy; // R1C: versioned, hard execution-critical gate -- see data-freshness.ts
  readonly providerCapabilities: ProviderCapabilityStates;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>;

  readonly ownershipPolicy: Record<string, unknown>;
  readonly ownershipInputs: Record<string, unknown>;
  readonly regimePolicy: Record<string, unknown>;
  readonly regimeInputs: Record<string, unknown>;
  readonly routerPolicy: Record<string, unknown> & { thetaQMinOwnershipAcceptability: number };
  readonly routerPortfolio: Record<string, unknown>;

  readonly latticeConfig: Record<string, unknown>;
  readonly thetaQSizingPolicy: Record<string, unknown>; // theta_q_baseline.py's own SizingPolicy -- a hard-cap-only preliminary estimate, distinct from the account-aware sizing.py stage below
  readonly costAssumptions: Record<string, unknown>;

  readonly aegisPolicy: Record<string, unknown>;
  readonly aegisInputs: Record<string, unknown>;

  readonly opportunityFrontierPolicy: { policyVersion: string; reducedSizeUncertaintyThreshold: number };
  readonly maxAcceptableSpreadPct: number; // shared liquidity-acceptability floor for opportunity-frontier derivation

  readonly candidates: readonly RawCandidateInput[];

  readonly sizingPolicy: Record<string, unknown>;
  readonly sizingAccount: { equity: number | null; cash: number | null; buyingPower: number | null; brokerAllowedQty: number };
  readonly executionQualityPolicy: Record<string, unknown>;
}

export interface NewRiskOrchestrationResult {
  readonly receipt: NewRiskDecisionReceipt;
  readonly ownership: OwnershipEvaluationResponse | null;
  readonly regime: RegimeSnapshotResponse | null;
  readonly routing: StrategyRoutingResponse | null;
  readonly thetaQ: ThetaQResponse | null;
  readonly aegis: AegisAssessmentResponse | null;
  readonly paretoSurvivorIds: readonly string[] | null;
  readonly opportunityBook: OpportunityFrontierResponse | null;
  readonly shadowOpportunities: readonly ShadowOpportunityEntry[];
  // R1H full-H: every feasible candidate's per-dimension economics this
  // cycle already computed internally for the pareto-frontier call --
  // exposed so a CROSS-underlying caller (cross-symbol-economic-
  // frontier.ts) can combine this underlying's candidates with every
  // other shortlisted underlying's candidates into ONE combined Pareto
  // comparison, without recomputing any economics itself (never a second,
  // possibly-drifting derivation of the same numbers). null whenever no
  // candidate reached the point these economics are computed (an earlier
  // pipeline-stage failure, or zero feasible candidates this cycle).
  readonly candidateEconomics: readonly CandidateEconomics[] | null;
}

const systemHoldResult = (
  request: NewRiskOrchestrationRequest,
  stage: string,
  detail: string,
  partial: Partial<Omit<NewRiskOrchestrationResult, 'receipt' | 'shadowOpportunities'>> = {},
): NewRiskOrchestrationResult => ({
  receipt: {
    decisionId: `${request.snapshotId}:${request.underlying}`,
    snapshotId: request.snapshotId,
    fusionSnapshotHash: request.fusionSnapshotHash,
    timestamp: request.timestamp,
    underlying: request.underlying,
    winningAction: 'SYSTEM_HOLD',
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
  thetaQ: null,
  aegis: null,
  paretoSurvivorIds: null,
  opportunityBook: null,
  shadowOpportunities: [],
  candidateEconomics: null,
  ...partial,
});

// A transient provider condition prevents economic evaluation. It is an
// operational SYSTEM_HOLD rather than a strategy WAIT or a risk HARD_VETO.
// This keeps strategy outcomes, provider incidents, and risk transforms
// separate for later opportunity and reliability analysis.
const providerTransientHoldResult = (
  request: NewRiskOrchestrationRequest,
  stage: string,
  detail: string,
): NewRiskOrchestrationResult => ({
  receipt: {
    decisionId: `${request.snapshotId}:${request.underlying}`,
    snapshotId: request.snapshotId,
    fusionSnapshotHash: request.fusionSnapshotHash,
    timestamp: request.timestamp,
    underlying: request.underlying,
    winningAction: 'SYSTEM_HOLD',
    selectedCandidateId: null,
    quantity: 0,
    alternatives: [],
    ownershipSnapshotId: null,
    regimeSnapshotId: null,
    executionAuthorized: false,
    reasonCodes: [`RUNTIME_STAGE_DEFERRED:${stage}`],
    plainEnglishExplanation: `Evaluation deferred at stage ${stage}: ${detail}`,
    failClosedReason: null,
    policyVersion: request.policyVersion,
    modelVersions: request.modelVersions,
  },
  ownership: null,
  regime: null,
  routing: null,
  thetaQ: null,
  aegis: null,
  paretoSurvivorIds: null,
  opportunityBook: null,
  shadowOpportunities: [],
  candidateEconomics: null,
});

const hardVetoResult = (
  request: NewRiskOrchestrationRequest,
  stage: string,
  detail: string,
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
    reasonCodes: [`RISK_CAPABILITY_PROHIBITION:${stage}`],
    plainEnglishExplanation: `New risk is prohibited at stage ${stage}: ${detail}`,
    failClosedReason: detail,
    policyVersion: request.policyVersion,
    modelVersions: request.modelVersions,
  },
  ownership: null,
  regime: null,
  routing: null,
  thetaQ: null,
  aegis: null,
  paretoSurvivorIds: null,
  opportunityBook: null,
  shadowOpportunities: [],
  candidateEconomics: null,
});

const requiredCollateralPerContract = (contract: NormalizedOptionContract): number => contract.strike * contract.multiplier;

const NULL_ECONOMICS: Omit<CandidateEconomics, 'candidateId'> = {
  grossCredit: null, evNet: null, calibratedPWin: null, breakEvenWr: null, edgeBuffer: null, expectedTailLoss: null,
  assignmentProbability: null, severeDrawdownProbability: null, capitalRequirement: null, capitalDays: null,
  returnPerCapitalDay: null, liquiditySpreadPct: null, fillProbability: null, expectedSlippage: null, modelUncertainty: null,
};

export async function runNewRiskOrchestration(
  bridge: PythonBridgeConfig,
  request: NewRiskOrchestrationRequest,
): Promise<NewRiskOrchestrationResult> {
  const capabilityFailure = requiredCapabilityFailureKind(request.providerCapabilities);
  if (capabilityFailure !== 'NONE') {
    const detail = REQUIRED_FOR_NEW_RISK.map((key) => `${key}=${request.providerCapabilities[key] ?? 'UNKNOWN'}`).join(', ');
    if (capabilityFailure === 'HARD_VETO') {
      return hardVetoResult(request, 'PROVIDER_STATE', `Required provider capability state indicates a genuine safety or entitlement prohibition: ${detail}`);
    }
    return providerTransientHoldResult(request, 'PROVIDER_STATE', `Required provider capability state is temporarily degraded or unavailable: ${detail}`);
  }

  const ownershipResult = await invokeAndValidate(
    bridge, 'ownership',
    { contractVersion: 'theta-ownership-runtime-v1', snapshotId: request.snapshotId, underlyingSymbol: request.underlying, timestamp: request.timestamp, policy: request.ownershipPolicy, inputs: request.ownershipInputs },
    (payload) => parseOwnershipEvaluationResponse(payload),
  );
  if (!ownershipResult.ok) return systemHoldResult(request, 'OWNERSHIP', ownershipResult.detail);

  const regimeResult = await invokeAndValidate(
    bridge, 'regime',
    { contractVersion: 'theta-regime-runtime-v1', snapshotId: request.snapshotId, timestamp: request.timestamp, policy: request.regimePolicy, inputs: request.regimeInputs },
    (payload) => parseRegimeSnapshotResponse(payload),
  );
  if (!regimeResult.ok) return systemHoldResult(request, 'REGIME', regimeResult.detail, { ownership: ownershipResult.data });

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
    return systemHoldResult(request, 'STRATEGY_ROUTER', routerResult.detail, { ownership: ownershipResult.data, regime: regimeResult.data });
  }

  const thetaQEligible = eligibleFamilies(routerResult.data).includes('THETA_Q');
  const partialAfterRouting = { ownership: ownershipResult.data, regime: regimeResult.data, routing: routerResult.data };
  const book = new ShadowOpportunityBookBuilder();

  const recordShadow = (
    candidate: RawCandidateInput | null,
    fields: Partial<Omit<ShadowOpportunityEntry, 'contractVersion' | 'opportunityId' | 'snapshotId' | 'timestamp' | 'underlying' | 'policyVersion' | 'modelVersions'>>,
  ): void => {
    book.record({
      contractVersion: 'theta-shadow-opportunity-book-v1',
      opportunityId: randomUUID(),
      snapshotId: request.snapshotId,
      timestamp: request.timestamp,
      underlying: request.underlying,
      contractSymbol: candidate?.contract.optionSymbol ?? null,
      strategyBranch: 'THETA_Q',
      evNet: null, tailAdjustedEv: null, returnPerCapitalDay: null, capitalRequired: null, uncertainty: null,
      ownershipSnapshotId: request.snapshotId, regimeSnapshotId: request.snapshotId, aegisState: null,
      recommendedQuantity: null, executionQualityAcceptable: null,
      waitReason: null, rejectionCategory: null, reasons: [],
      policyVersion: request.policyVersion, modelVersions: request.modelVersions,
      eventualOutcomeKnown: false, eventualRealizedPnl: null,
      ...fields,
    });
  };

  if (!thetaQEligible || request.candidates.length === 0) {
    if (request.candidates.length > 0) {
      recordShadow(null, {
        outcome: 'PASS', rejectionCategory: 'THETA_Q_INELIGIBLE',
        reasons: [{ code: 'STRATEGY_INELIGIBLE_THIS_CYCLE', polarity: -1, detail: 'THETA_Q was not an eligible strategy family for the current lifecycle/market state.' }],
      });
    }
    const receipt = assembleNewRiskDecision({
      snapshotId: request.snapshotId, fusionSnapshotHash: request.fusionSnapshotHash, timestamp: request.timestamp,
      underlying: request.underlying, ownership: ownershipResult.data, regime: regimeResult.data, candidates: [],
      policyVersion: request.policyVersion, modelVersions: request.modelVersions,
      requiredModelVersions: request.requiredModelVersions, providerStateGood: true,
    });
    return { receipt, ...partialAfterRouting, thetaQ: null, aegis: null, paretoSurvivorIds: null, opportunityBook: null, shadowOpportunities: book.all(), candidateEconomics: null };
  }

  // Contracts with an UNKNOWN delta cannot enter the lattice call --
  // theta_q_lattice.py's ChainContract.put_delta_magnitude is a required
  // float. Exclude them here, recorded as PASS, never sent to Python.
  const [latticeEligible, deltaUnknown] = request.candidates.reduce<[RawCandidateInput[], RawCandidateInput[]]>(
    (acc, c) => {
      acc[c.contract.delta === null ? 1 : 0].push(c);
      return acc;
    },
    [[], []],
  );

  const deltaUnknownResults: CandidateFrontierResult[] = deltaUnknown.map((c) => {
    recordShadow(c, {
      outcome: 'PASS', rejectionCategory: 'UNKNOWN_DELTA',
      reasons: [{ code: 'DELTA_UNKNOWN', polarity: -1, detail: 'Delta is UNKNOWN for this contract -- never manufactured, excluded from the lattice.' }],
    });
    return {
      candidateId: c.candidateId, contract: c.contract, disposition: 'PASS', waitReason: null,
      rejectionReason: 'UNKNOWN_DELTA', evNet: null, returnPerCapitalDay: null, aegis: null, sizing: null, executionQuality: null,
    };
  });

  // R1C: freshness is a HARD execution-critical gate for the option quote
  // itself (item 6/7: "stale current option quote cannot justify a new
  // executable entry") -- classified per-candidate against the caller's own
  // versioned OPTION_QUOTE freshness policy, using data-freshness.ts (never
  // one arbitrary global threshold). STALE or UNKNOWN freshness excludes a
  // candidate from the lattice entirely, recorded distinctly from a delta
  // exclusion so the shadow book can tell freshness failures apart from
  // missing Greeks.
  const [freshnessEligible, freshnessRejected] = latticeEligible.reduce<[RawCandidateInput[], RawCandidateInput[]]>(
    (acc, c) => {
      const quality = classifyObservation(
        {
          observationClass: 'OPTION_QUOTE',
          observedAt: c.contract.quoteTimestamp,
          receivedAt: request.timestamp,
          providerEntitlement: c.contract.dataQuality === 'NOT_ENTITLED' ? 'NOT_ENTITLED' : 'ENTITLED',
          providerReachable: true,
          valuePresent: c.contract.bid !== null && c.contract.ask !== null,
        },
        request.optionQuoteFreshnessPolicy,
      );
      acc[quality.state === 'GOOD' || quality.state === 'DEGRADED' ? 0 : 1].push(c);
      return acc;
    },
    [[], []],
  );

  // CORRECTION: a stale/unknown-freshness quote is NEVER recorded as PASS.
  // PASS means "THETA had valid enough state to evaluate the opportunity
  // and deliberately declined it" (nonpositive economics, dominated,
  // inferior alternative). A data-quality failure means THETA COULD NOT
  // EVALUATE the candidate at all -- a fundamentally different fact that
  // must never be mixed into PASS-regret analysis. This is recorded as
  // WAIT/WAIT_LIQUIDITY instead: a transient, re-checkable condition, per
  // the same anti-paralysis WAIT discipline every other WAIT reason uses.
  const freshnessRejectedResults: CandidateFrontierResult[] = freshnessRejected.map((c) => {
    const quality = classifyObservation(
      {
        observationClass: 'OPTION_QUOTE', observedAt: c.contract.quoteTimestamp, receivedAt: request.timestamp,
        providerEntitlement: c.contract.dataQuality === 'NOT_ENTITLED' ? 'NOT_ENTITLED' : 'ENTITLED',
        providerReachable: true, valuePresent: c.contract.bid !== null && c.contract.ask !== null,
      },
      request.optionQuoteFreshnessPolicy,
    );
    recordShadow(c, {
      outcome: 'WAIT', waitReason: 'WAIT_LIQUIDITY', rejectionCategory: `OPTION_QUOTE_${quality.state}`,
      reasons: [{ code: 'OPTION_QUOTE_FRESHNESS_INSUFFICIENT', polarity: -1, detail: quality.reason }],
    });
    return {
      candidateId: c.candidateId, contract: c.contract, disposition: 'WAIT', waitReason: 'WAIT_LIQUIDITY',
      rejectionReason: `OPTION_QUOTE_${quality.state}`, evNet: null, returnPerCapitalDay: null, aegis: null, sizing: null, executionQuality: null,
    };
  });

  if (freshnessEligible.length === 0) {
    const receipt = assembleNewRiskDecision({
      snapshotId: request.snapshotId, fusionSnapshotHash: request.fusionSnapshotHash, timestamp: request.timestamp,
      underlying: request.underlying, ownership: ownershipResult.data, regime: regimeResult.data,
      candidates: [...deltaUnknownResults, ...freshnessRejectedResults], policyVersion: request.policyVersion, modelVersions: request.modelVersions,
      requiredModelVersions: request.requiredModelVersions, providerStateGood: true,
    });
    return { receipt, ...partialAfterRouting, thetaQ: null, aegis: null, paretoSurvivorIds: null, opportunityBook: null, shadowOpportunities: book.all(), candidateEconomics: null };
  }

  const thetaQResult = await invokeAndValidate(
    bridge, 'thetaQ',
    {
      contractVersion: 'theta-q-runtime-v1', operation: 'evaluateCspCandidates', fusionSnapshotHash: request.fusionSnapshotHash,
      latticeConfig: request.latticeConfig, sizingPolicy: request.thetaQSizingPolicy, costAssumptions: request.costAssumptions,
      candidates: freshnessEligible.map((c) => ({
        candidateId: c.candidateId, underlyingSymbol: c.contract.underlying, dte: c.contract.dte, strike: c.contract.strike,
        putDeltaMagnitude: Math.abs(c.contract.delta as number), spreadPct: c.contract.spreadPct,
        quoteAgeSeconds: c.contract.dataAgeSeconds, openInterest: c.contract.openInterest, volume: c.contract.volume,
        earningsDistanceDays: request.earningsDistanceDays, multiplier: c.contract.multiplier,
        entryPremiumPerShare: c.entryPremiumPerShare, ownershipAcceptability: ownershipResult.data.ownability,
        severeDrawdownProbability: c.severeDrawdownProbability, ivRank: c.ivRank, brokerAllowedQty: c.brokerAllowedQty,
        contractIsStandard: c.contractIsStandard,
      })),
    },
    (payload) => parseThetaQResponse(payload, request.fusionSnapshotHash),
  );
  if (!thetaQResult.ok) return systemHoldResult(request, 'THETA_Q_LATTICE', thetaQResult.detail, partialAfterRouting);

  const rawByCandidateId = new Map(freshnessEligible.map((c) => [c.candidateId, c]));
  const feasibleForFrontier: RawCandidateInput[] = [];
  const economicsByCandidateId = new Map<string, Omit<CandidateEconomics, 'candidateId'>>();
  const immediateResults: CandidateFrontierResult[] = [...deltaUnknownResults, ...freshnessRejectedResults];

  for (const tq of thetaQResult.data.candidates) {
    const raw = rawByCandidateId.get(tq.candidateId);
    if (raw === undefined) continue; // cannot happen given the request was built from freshnessEligible, but never assume
    if (!tq.actionFeasible) {
      const reasonCode = tq.reasons[0]?.code ?? 'THETA_Q_INFEASIBLE';
      recordShadow(raw, {
        outcome: reasonCode === 'OWNERSHIP_BELOW_FLOOR' ? 'REJECTED' : 'REJECTED',
        rejectionCategory: reasonCode,
        reasons: tq.reasons,
      });
      immediateResults.push({
        candidateId: raw.candidateId, contract: raw.contract, disposition: 'PASS', waitReason: null,
        rejectionReason: reasonCode, evNet: tq.economics?.ev_net ?? null, returnPerCapitalDay: null,
        aegis: null, sizing: null, executionQuality: null,
      });
      continue;
    }

    const capitalRequirement = tq.economics?.secured_collateral_per_contract ?? null;
    const capitalDays = capitalRequirement !== null ? capitalRequirement * raw.contract.dte : null;
    const evNet = tq.economics?.ev_net ?? null;
    const returnPerCapitalDay = evNet !== null && capitalDays !== null && capitalDays > 0 ? evNet / capitalDays : null;

    economicsByCandidateId.set(raw.candidateId, {
      ...NULL_ECONOMICS,
      grossCredit: tq.economics?.max_profit ?? null,
      evNet,
      severeDrawdownProbability: raw.severeDrawdownProbability,
      capitalRequirement,
      capitalDays,
      returnPerCapitalDay,
      liquiditySpreadPct: raw.contract.spreadPct,
    });
    feasibleForFrontier.push(raw);
  }

  if (feasibleForFrontier.length === 0) {
    const receipt = assembleNewRiskDecision({
      snapshotId: request.snapshotId, fusionSnapshotHash: request.fusionSnapshotHash, timestamp: request.timestamp,
      underlying: request.underlying, ownership: ownershipResult.data, regime: regimeResult.data,
      candidates: immediateResults, policyVersion: request.policyVersion, modelVersions: request.modelVersions,
      requiredModelVersions: request.requiredModelVersions, providerStateGood: true,
    });
    return { receipt, ...partialAfterRouting, thetaQ: thetaQResult.data, aegis: null, paretoSurvivorIds: null, opportunityBook: null, shadowOpportunities: book.all(), candidateEconomics: null };
  }

  const paretoResult = await invokeAndValidate(
    bridge, 'paretoFrontier',
    {
      contractVersion: 'theta-pareto-frontier-runtime-v1', snapshotId: request.snapshotId, timestamp: request.timestamp,
      candidates: feasibleForFrontier.map((c) => ({ candidateId: c.candidateId, ...(economicsByCandidateId.get(c.candidateId) as Omit<CandidateEconomics, 'candidateId'>) })),
    },
    (payload) => parseParetoFrontierResponse(payload),
  );
  if (!paretoResult.ok) return systemHoldResult(request, 'PARETO_FRONTIER', paretoResult.detail, { ...partialAfterRouting, thetaQ: thetaQResult.data });
  const survivorIds = new Set(survivingCandidateIds(paretoResult.data));

  const aegisResult = await invokeAndValidate(
    bridge, 'aegis',
    { contractVersion: 'theta-aegis-runtime-v1', decisionId: `${request.snapshotId}:${request.underlying}`, snapshotId: request.snapshotId, timestamp: request.timestamp, policy: request.aegisPolicy, inputs: request.aegisInputs },
    (payload) => parseAegisAssessmentResponse(payload),
  );
  if (!aegisResult.ok) {
    return systemHoldResult(request, 'AEGIS', aegisResult.detail, { ...partialAfterRouting, thetaQ: thetaQResult.data, paretoSurvivorIds: [...survivorIds] });
  }

  const survivors = feasibleForFrontier.filter((c) => survivorIds.has(c.candidateId));
  for (const c of feasibleForFrontier) {
    if (!survivorIds.has(c.candidateId)) {
      immediateResults.push({
        candidateId: c.candidateId, contract: c.contract, disposition: 'PASS', waitReason: null,
        rejectionReason: 'PARETO_DOMINATED', evNet: economicsByCandidateId.get(c.candidateId)?.evNet ?? null,
        returnPerCapitalDay: economicsByCandidateId.get(c.candidateId)?.returnPerCapitalDay ?? null,
        aegis: null, sizing: null, executionQuality: null,
      });
      recordShadow(c, { outcome: 'REJECTED', rejectionCategory: 'PARETO_DOMINATED', reasons: [{ code: 'PARETO_DOMINATED', polarity: -1, detail: 'Strictly dominated by another candidate in this snapshot.' }] });
    }
  }

  const opportunityResult = await invokeAndValidate(
    bridge, 'opportunityFrontier',
    {
      contractVersion: 'theta-opportunity-frontier-runtime-v1', snapshotId: request.snapshotId, timestamp: request.timestamp,
      policy: request.opportunityFrontierPolicy,
      candidates: survivors.map((c) => {
        const econ = economicsByCandidateId.get(c.candidateId) as Omit<CandidateEconomics, 'candidateId'>;
        return {
          candidateId: c.candidateId,
          underlyingSymbol: c.contract.underlying,
          evNet: econ.evNet,
          returnPerCapitalDay: econ.returnPerCapitalDay,
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
        };
      }),
    },
    (payload) => parseOpportunityFrontierResponse(payload),
  );
  if (!opportunityResult.ok) {
    return systemHoldResult(request, 'OPPORTUNITY_FRONTIER', opportunityResult.detail, {
      ...partialAfterRouting, thetaQ: thetaQResult.data, aegis: aegisResult.data, paretoSurvivorIds: [...survivorIds],
    });
  }

  const entryByCandidateId = new Map(opportunityResult.data.entries.map((entry) => [entry.candidateId, entry]));
  const OPEN_DISPOSITIONS = new Set(['OPEN_FULL', 'OPEN_REDUCED', 'OPEN_ALTERNATE_CONTRACT', 'OPEN_ALTERNATE_EXPIRY', 'OPEN_ALTERNATE_STRUCTURE']);

  const candidateResults: CandidateFrontierResult[] = [...immediateResults];
  for (const candidate of survivors) {
    const econ = economicsByCandidateId.get(candidate.candidateId) as Omit<CandidateEconomics, 'candidateId'>;
    const entry = entryByCandidateId.get(candidate.candidateId);
    if (entry === undefined) continue; // never happens -- every survivor was sent to opportunityFrontier

    const isOpen = OPEN_DISPOSITIONS.has(entry.disposition);
    if (!isOpen) {
      candidateResults.push({
        candidateId: candidate.candidateId, contract: candidate.contract,
        disposition: entry.disposition as CandidateFrontierResult['disposition'],
        waitReason: entry.waitReason, rejectionReason: entry.rejectionCategory,
        evNet: econ.evNet, returnPerCapitalDay: econ.returnPerCapitalDay,
        aegis: null, sizing: null, executionQuality: null,
      });
      recordShadow(candidate, {
        outcome: entry.disposition === 'WAIT' ? 'WAIT' : 'PASS', evNet: econ.evNet, returnPerCapitalDay: econ.returnPerCapitalDay,
        capitalRequired: econ.capitalRequirement, waitReason: entry.waitReason, rejectionCategory: entry.rejectionCategory, reasons: entry.reasons,
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
      return systemHoldResult(request, 'SIZING', sizingResult.detail, {
        ...partialAfterRouting, thetaQ: thetaQResult.data, aegis: aegisResult.data, paretoSurvivorIds: [...survivorIds], opportunityBook: opportunityResult.data,
      });
    }

    const executionQualityResult = await invokeAndValidate(
      bridge, 'executionQuality',
      {
        contractVersion: 'theta-execution-quality-runtime-v1', decisionId: `${request.snapshotId}:${request.underlying}`,
        snapshotId: request.snapshotId, timestamp: request.timestamp, policy: request.executionQualityPolicy,
        inputs: {
          bid: candidate.contract.bid, ask: candidate.contract.ask, quoteSize: candidate.quoteSize,
          quoteAgeSeconds: candidate.contract.dataAgeSeconds, limitPrice: candidate.contract.bid ?? 0,
          preSlippageExpectedUtility: candidate.preSlippageExpectedUtility,
        },
      },
      (payload) => parseExecutionQualityResponse(payload),
    );
    if (!executionQualityResult.ok) {
      return systemHoldResult(request, 'EXECUTION_QUALITY', executionQualityResult.detail, {
        ...partialAfterRouting, thetaQ: thetaQResult.data, aegis: aegisResult.data, paretoSurvivorIds: [...survivorIds], opportunityBook: opportunityResult.data,
      });
    }

    candidateResults.push({
      candidateId: candidate.candidateId, contract: candidate.contract,
      disposition: entry.disposition as CandidateFrontierResult['disposition'],
      waitReason: entry.waitReason, rejectionReason: entry.rejectionCategory,
      evNet: econ.evNet, returnPerCapitalDay: econ.returnPerCapitalDay,
      aegis: aegisResult.data, sizing: sizingResult.data, executionQuality: executionQualityResult.data,
    });

    const executionAcceptable = executionQualityResult.data.acceptable;
    const outcome: ShadowOpportunityEntry['outcome'] =
      sizingResult.data.quantity === 0 ? 'Q_ZERO' : executionAcceptable === false ? 'EXECUTION_REJECTED' : 'ACCEPTED';
    recordShadow(candidate, {
      outcome, evNet: econ.evNet, returnPerCapitalDay: econ.returnPerCapitalDay, capitalRequired: econ.capitalRequirement,
      aegisState: aegisResult.data.newRiskState, recommendedQuantity: sizingResult.data.quantity,
      executionQualityAcceptable: executionAcceptable, reasons: [...sizingResult.data.reasons, ...executionQualityResult.data.reasons],
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
    thetaQ: thetaQResult.data, aegis: aegisResult.data, paretoSurvivorIds: [...survivorIds],
    opportunityBook: opportunityResult.data, shadowOpportunities: book.all(),
    candidateEconomics: feasibleForFrontier.map((c) => ({
      candidateId: c.candidateId, ...(economicsByCandidateId.get(c.candidateId) as Omit<CandidateEconomics, 'candidateId'>),
    })),
  };
}
