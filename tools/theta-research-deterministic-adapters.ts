/**
 * Contract-composition adapters for deterministic, non-empirical scenarios.
 *
 * These adapters prove that the bounded Actions orchestrator invokes the
 * existing regime, Q/D, H, entry/exit, and Assignment/Covered-Call research
 * modules. They never turn scenario values into market evidence, returns,
 * recommendations, or orders.
 */
import {
  buildPairedDecisionRecord,
  summarizePairedCohorts,
  type PairedDecisionRawInput,
} from '../src/research/defined-risk-vs-csp-paired-study.js';
import {
  ENTRY_WHOLE_CHAIN_V1,
  type ComparisonContext,
} from '../src/research/cross-strategy-common-horizon-contract.js';
import {
  buildHoldStrikeCandidateObservation,
  buildHoldStrikeCohortReport,
  pairHoldStrikeWithConventional,
  type HoldStrikeCandidateObservationInput,
  type HoldStrikeConventionalCandidateFacts,
} from '../src/research/hold-strike-empirical-cohort.js';
import { runProfitTakingReplay, type ProfitReplayInput } from '../src/research/profit-taking-replay.js';
import { buildRecoveryCoveredCallExperiment } from '../src/research/recovery-covered-call-experiment.js';
import { parseRegimeSnapshotResponse } from '../src/theta/regime-contract.js';

type RecoveryExperimentInput = Parameters<typeof buildRecoveryCoveredCallExperiment>[0];

export interface DeterministicResearchScenario {
  readonly contractVersion: 'theta-deterministic-scenarios-v1';
  readonly evidenceClass: 'DETERMINISTIC_SCENARIO_COMPARISON';
  readonly scenarioId: string;
  readonly regime: {
    readonly payload: unknown;
  };
  readonly qd: {
    readonly primaryIdentity: {
      readonly cspShortLegIdentity: string;
      readonly definedRiskShortLegIdentity: string;
      readonly cspExpiration: string;
      readonly definedRiskExpiration: string;
    };
    readonly context: ComparisonContext;
    readonly input: PairedDecisionRawInput;
  };
  readonly h: {
    readonly observation: HoldStrikeCandidateObservationInput;
    readonly conventional: HoldStrikeConventionalCandidateFacts;
  };
  readonly entryExit: {
    readonly input: ProfitReplayInput;
  };
  readonly ac: {
    readonly experiment: RecoveryExperimentInput;
  };
}

export interface DeterministicResearchAdapterResult {
  readonly contractVersion: 'theta-deterministic-adapter-result-v1';
  readonly scenarioId: string;
  readonly evidenceClass: 'DETERMINISTIC_SCENARIO_COMPARISON';
  readonly empirical: false;
  readonly brokerAuthority: false;
  readonly comparisonCount: 4;
  readonly regime: {
    readonly module: 'regime-contract';
    readonly status: 'SOURCE_ALREADY_IMPLEMENTED';
    readonly contractVersion: string;
    readonly resolvedAxisCount: number;
    readonly confidence: number;
  };
  readonly qd: {
    readonly module: 'defined-risk-vs-csp-paired-study';
    readonly status: 'SOURCE_ALREADY_IMPLEMENTED';
    readonly readiness: string;
    readonly comparisonState: string | null;
    readonly cohort: 'COHORT_A_SAME_EXPIRATION';
    readonly targetDte: number;
    readonly identicalShortLeg: true;
    readonly identicalExpiration: true;
    readonly pairCount: number;
  };
  readonly h: {
    readonly module: 'hold-strike-empirical-cohort';
    readonly status: 'SOURCE_ALREADY_IMPLEMENTED';
    readonly pairable: true;
    readonly holdStrikeDte: number;
    readonly conventionalDte: number;
    readonly resolutionState: 'UNRESOLVED';
    readonly dataQualityState: string;
    readonly differenceCount: number;
  };
  readonly entryExit: {
    readonly module: 'profit-taking-replay';
    readonly status: 'SOURCE_ALREADY_IMPLEMENTED';
    readonly policyCount: number;
    readonly actualFillCount: 0;
    readonly profitability: 'EMPIRICALLY_UNPROVEN';
  };
  readonly ac: {
    readonly module: 'recovery-covered-call-experiment';
    readonly status: 'SOURCE_ALREADY_IMPLEMENTED';
    readonly comparisonState: string;
    readonly stage: string;
    readonly actions: readonly string[];
    readonly alternativeCount: number;
    readonly separateHistoricalBasisAndForwardOutcome: true;
  };
}

function assertNonEmpty(value: string, code: string): void {
  if (value.trim().length === 0) throw new Error(code);
}

export function runDeterministicResearchAdapters(
  scenario: DeterministicResearchScenario,
): DeterministicResearchAdapterResult {
  if (scenario.contractVersion !== 'theta-deterministic-scenarios-v1') {
    throw new Error('DETERMINISTIC_SCENARIO_CONTRACT_VERSION_INVALID');
  }
  if (scenario.evidenceClass !== 'DETERMINISTIC_SCENARIO_COMPARISON') {
    throw new Error('DETERMINISTIC_SCENARIO_EVIDENCE_CLASS_INVALID');
  }
  assertNonEmpty(scenario.scenarioId, 'DETERMINISTIC_SCENARIO_ID_MISSING');

  const regime = parseRegimeSnapshotResponse(scenario.regime.payload);
  const resolvedAxisCount = [
    regime.trendState,
    regime.volatilityState,
    regime.eventState,
    regime.liquidityState,
    regime.stressState,
  ].filter((axis) => axis !== null).length;

  const identity = scenario.qd.primaryIdentity;
  assertNonEmpty(identity.cspShortLegIdentity, 'Q_D_SHORT_LEG_IDENTITY_MISSING');
  assertNonEmpty(identity.cspExpiration, 'Q_D_EXPIRATION_MISSING');
  if (identity.cspShortLegIdentity !== identity.definedRiskShortLegIdentity) {
    throw new Error('Q_D_PRIMARY_SHORT_LEG_IDENTITY_MISMATCH');
  }
  if (identity.cspExpiration !== identity.definedRiskExpiration) {
    throw new Error('Q_D_PRIMARY_EXPIRATION_MISMATCH');
  }
  if (scenario.qd.input.cohort !== 'COHORT_A_SAME_EXPIRATION'
    || scenario.qd.input.targetDte === null) {
    throw new Error('Q_D_PRIMARY_COHORT_MUST_SHARE_EXPIRATION');
  }
  if (scenario.qd.input.cspCandidates.length !== 1
    || scenario.qd.input.definedRiskCandidates.length !== 1) {
    throw new Error('Q_D_PRIMARY_COMPARISON_REQUIRES_ONE_CANDIDATE_PER_BRANCH');
  }
  const csp = scenario.qd.input.cspCandidates[0];
  const definedRisk = scenario.qd.input.definedRiskCandidates[0];
  if (csp === undefined || definedRisk === undefined
    || csp.underlying !== definedRisk.underlying
    || csp.strike !== definedRisk.shortStrike
    || csp.dte !== definedRisk.dte
    || csp.dte !== scenario.qd.input.targetDte) {
    throw new Error('Q_D_PRIMARY_CANDIDATE_IDENTITY_MISMATCH');
  }

  const qdRecord = buildPairedDecisionRecord(
    scenario.qd.input,
    scenario.qd.context,
    ENTRY_WHOLE_CHAIN_V1,
  );
  if (qdRecord.readiness !== 'STRUCTURAL_PAIR_READY') {
    throw new Error('Q_D_DETERMINISTIC_PAIR_NOT_STRUCTURALLY_READY');
  }
  const qdSummary = summarizePairedCohorts([qdRecord]);

  const holdStrike = buildHoldStrikeCandidateObservation(scenario.h.observation);
  if (holdStrike.executionKind !== 'SHADOW_CANDIDATE'
    || holdStrike.environment !== 'SHADOW'
    || holdStrike.resolutionState !== 'UNRESOLVED'
    || holdStrike.dte === null || holdStrike.dte < 2 || holdStrike.dte > 5) {
    throw new Error('H_DETERMINISTIC_CANDIDATE_BOUNDARY_INVALID');
  }
  if (scenario.h.conventional.dte === null
    || scenario.h.conventional.dte < 25 || scenario.h.conventional.dte > 60) {
    throw new Error('H_CONVENTIONAL_DTE_BOUNDARY_INVALID');
  }
  const hPair = pairHoldStrikeWithConventional(holdStrike, scenario.h.conventional);
  if (!hPair.pairable || hPair.brokerAuthority !== false) {
    throw new Error('H_DETERMINISTIC_PAIR_NOT_PAIRABLE');
  }
  const hCohort = buildHoldStrikeCohortReport([{ observation: holdStrike }], 1);
  if (hCohort.resolvedObservationCount !== 0
    || hCohort.wholeChainAfterCostPnl.mean !== null
    || hCohort.brokerAuthority !== false) {
    throw new Error('H_DETERMINISTIC_COHORT_MUST_REMAIN_NON_EMPIRICAL');
  }

  const entryExit = runProfitTakingReplay(scenario.entryExit.input);
  const actualFillCount = entryExit.policies.filter((policy) => policy.actualFill).length;
  if (entryExit.evidenceClass !== 'DETERMINISTIC_SCENARIO_COMPARISON'
    || entryExit.brokerAuthority !== false
    || entryExit.profitability !== 'EMPIRICALLY_UNPROVEN'
    || actualFillCount !== 0) {
    throw new Error('ENTRY_EXIT_DETERMINISTIC_BOUNDARY_INVALID');
  }

  const acResult = buildRecoveryCoveredCallExperiment(scenario.ac.experiment);
  if (acResult.brokerAuthority !== false) {
    throw new Error('A_C_DETERMINISTIC_RESULT_HAS_BROKER_AUTHORITY');
  }
  const actions = acResult.alternatives.map((alternative) => alternative.action).sort();
  if (!actions.includes('SELL_STOCK') || !actions.includes('SELL_CC')) {
    throw new Error('A_C_DETERMINISTIC_ACTIONS_INCOMPLETE');
  }
  if (scenario.ac.experiment.alternatives.some((alternative) => (
    alternative.basisComponents === null || alternative.outcomeComponents === null
  ))) {
    throw new Error('A_C_BASIS_OR_FORWARD_OUTCOME_MISSING');
  }

  return {
    contractVersion: 'theta-deterministic-adapter-result-v1',
    scenarioId: scenario.scenarioId,
    evidenceClass: 'DETERMINISTIC_SCENARIO_COMPARISON',
    empirical: false,
    brokerAuthority: false,
    comparisonCount: 4,
    regime: {
      module: 'regime-contract',
      status: 'SOURCE_ALREADY_IMPLEMENTED',
      contractVersion: regime.contractVersion,
      resolvedAxisCount,
      confidence: regime.confidence,
    },
    qd: {
      module: 'defined-risk-vs-csp-paired-study',
      status: 'SOURCE_ALREADY_IMPLEMENTED',
      readiness: qdRecord.readiness,
      comparisonState: qdRecord.comparison?.state ?? null,
      cohort: 'COHORT_A_SAME_EXPIRATION',
      targetDte: scenario.qd.input.targetDte,
      identicalShortLeg: true,
      identicalExpiration: true,
      pairCount: qdSummary.totalPairs,
    },
    h: {
      module: 'hold-strike-empirical-cohort',
      status: 'SOURCE_ALREADY_IMPLEMENTED',
      pairable: true,
      holdStrikeDte: holdStrike.dte,
      conventionalDte: scenario.h.conventional.dte,
      resolutionState: 'UNRESOLVED',
      dataQualityState: hCohort.dataQualityState,
      differenceCount: hPair.differences.length,
    },
    entryExit: {
      module: 'profit-taking-replay',
      status: 'SOURCE_ALREADY_IMPLEMENTED',
      policyCount: entryExit.policies.length,
      actualFillCount: 0,
      profitability: 'EMPIRICALLY_UNPROVEN',
    },
    ac: {
      module: 'recovery-covered-call-experiment',
      status: 'SOURCE_ALREADY_IMPLEMENTED',
      comparisonState: acResult.comparisonState,
      stage: acResult.stage,
      actions,
      alternativeCount: acResult.alternatives.length,
      separateHistoricalBasisAndForwardOutcome: true,
    },
  };
}
