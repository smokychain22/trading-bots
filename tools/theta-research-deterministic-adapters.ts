/**
 * Contract-composition adapters for deterministic, non-empirical scenarios.
 *
 * These adapters prove that the bounded Actions orchestrator invokes the
 * existing Q/D and Assignment/Covered-Call research modules. They never turn
 * scenario values into market evidence, returns, recommendations, or orders.
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
import { buildRecoveryCoveredCallExperiment } from '../src/research/recovery-covered-call-experiment.js';

type RecoveryExperimentInput = Parameters<typeof buildRecoveryCoveredCallExperiment>[0];

export interface DeterministicResearchScenario {
  readonly contractVersion: 'theta-deterministic-scenarios-v1';
  readonly evidenceClass: 'DETERMINISTIC_SCENARIO_COMPARISON';
  readonly scenarioId: string;
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
  readonly comparisonCount: 2;
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
    comparisonCount: 2,
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
