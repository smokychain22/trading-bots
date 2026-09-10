import type { ManagementDecisionResponse } from './management-contract.js';
import type { AegisAssessmentResponse } from './aegis-contract.js';
import type { ExecutionQualityResponse } from './execution-quality-contract.js';

// R1H management assembly: composes already-computed
// management_action_value.py output (including hold_advantage), AEGIS, and
// execution-quality into one immutable management decision receipt for an
// EXISTING position. Mirrors decision-assembly.ts's discipline exactly:
// zero quantitative/policy computation here, fail-closed packaging only.
// executionAuthorized is always false -- this produces a receipt and,
// downstream, an order intent; it never authorizes broker submission.

export interface ManagementAssemblyInput {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly management: ManagementDecisionResponse;
  readonly aegis: AegisAssessmentResponse;
  readonly executionQuality: ExecutionQualityResponse | null; // null when the selected action needs no order (e.g. HOLD)
  readonly holdAdvantage: number | null; // from management_action_value.py's hold_advantage(); null if genuinely unknown
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>;
  readonly providerStateGood: boolean;
}

export interface ManagementDecisionReceipt {
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly selectedAction: ManagementDecisionResponse['selectedAction'];
  readonly holdAdvantage: number | null;
  readonly valuations: ManagementDecisionResponse['valuations'];
  readonly aegisState: AegisAssessmentResponse['newRiskState'];
  readonly executionRecommendedAction: string | null;
  readonly executionAuthorized: false;
  readonly reasonCodes: readonly string[];
  readonly plainEnglishExplanation: string;
  readonly failClosedReason: string | null;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
}

// Actions that open/adjust NEW risk (as opposed to purely closing exposure)
// -- AEGIS's exit-supremacy guarantee means these are the only ones a
// restrictive risk state may legitimately block; CLOSE/EXPIRE/ASSIGN always
// remain permitted regardless of AEGIS state (see aegis.ts's
// RISK_REDUCING_ACTIONS / is_action_permitted in aegis.py).
const NEW_RISK_MANAGEMENT_ACTIONS = new Set(['ROLL', 'SELL_CC']);

function failClosed(input: ManagementAssemblyInput, reason: string, reasonCodes: readonly string[]): ManagementDecisionReceipt {
  return {
    decisionId: `${input.snapshotId}:${input.chainId}`,
    snapshotId: input.snapshotId,
    fusionSnapshotHash: input.fusionSnapshotHash,
    timestamp: input.timestamp,
    chainId: input.chainId,
    selectedAction: 'HOLD',
    holdAdvantage: null,
    valuations: input.management.valuations,
    aegisState: input.aegis.newRiskState,
    executionRecommendedAction: null,
    executionAuthorized: false,
    reasonCodes,
    plainEnglishExplanation: reason,
    failClosedReason: reason,
    policyVersion: input.policyVersion,
    modelVersions: input.modelVersions,
  };
}

export function assembleManagementDecision(input: ManagementAssemblyInput): ManagementDecisionReceipt {
  if (!input.providerStateGood) {
    return failClosed(input, 'Required provider state is not GOOD; falling back to HOLD.', ['PROVIDER_STATE_INVALID']);
  }

  for (const [modelName, requiredVersion] of Object.entries(input.requiredModelVersions)) {
    const actualVersion = input.modelVersions[modelName];
    if (actualVersion !== requiredVersion) {
      return failClosed(
        input,
        `Model version mismatch for ${modelName}: expected ${requiredVersion}, got ${actualVersion ?? 'MISSING'}.`,
        ['MODEL_VERSION_MISMATCH'],
      );
    }
  }

  if (input.fusionSnapshotHash !== input.management.fusionSnapshotHash) {
    return failClosed(input, 'Management decision references a different FusionSnapshot than this assembly call.', ['SNAPSHOT_MISMATCH']);
  }

  const proposedAction = input.management.selectedAction;

  // Exit supremacy: a restrictive AEGIS state never blocks a risk-REDUCING
  // action (CLOSE/EXPIRE/ASSIGN/REDEPLOY/HOLD) -- only NEW-risk management
  // actions (ROLL, SELL_CC) are gated by AEGIS here.
  const isNewRiskAction = NEW_RISK_MANAGEMENT_ACTIONS.has(proposedAction);
  const aegisBlocksNewRisk = input.aegis.newRiskState === 'HOLD_ONLY' || input.aegis.newRiskState === 'HARD_VETO';

  if (isNewRiskAction && aegisBlocksNewRisk) {
    return {
      decisionId: `${input.snapshotId}:${input.chainId}`,
      snapshotId: input.snapshotId,
      fusionSnapshotHash: input.fusionSnapshotHash,
      timestamp: input.timestamp,
      chainId: input.chainId,
      selectedAction: 'HOLD',
      holdAdvantage: input.holdAdvantage,
      valuations: input.management.valuations,
      aegisState: input.aegis.newRiskState,
      executionRecommendedAction: null,
      executionAuthorized: false,
      reasonCodes: ['AEGIS_BLOCKS_NEW_RISK_MANAGEMENT_ACTION'],
      plainEnglishExplanation: `${proposedAction} was proposed but AEGIS (${input.aegis.newRiskState}) does not permit new risk right now -- holding instead. Closing/reducing exposure would still be permitted (exit supremacy).`,
      failClosedReason: null,
      policyVersion: input.policyVersion,
      modelVersions: input.modelVersions,
    };
  }

  const needsExecution = proposedAction !== 'HOLD';
  if (needsExecution && input.executionQuality !== null && input.executionQuality.recommendedAction !== 'SUBMIT') {
    return {
      decisionId: `${input.snapshotId}:${input.chainId}`,
      snapshotId: input.snapshotId,
      fusionSnapshotHash: input.fusionSnapshotHash,
      timestamp: input.timestamp,
      chainId: input.chainId,
      selectedAction: 'HOLD',
      holdAdvantage: input.holdAdvantage,
      valuations: input.management.valuations,
      aegisState: input.aegis.newRiskState,
      executionRecommendedAction: input.executionQuality.recommendedAction,
      executionAuthorized: false,
      reasonCodes: ['EXECUTION_QUALITY_GATE_FAILED'],
      plainEnglishExplanation: `${proposedAction} was proposed but execution quality recommends ${input.executionQuality.recommendedAction} -- holding instead rather than crossing the spread blindly.`,
      failClosedReason: null,
      policyVersion: input.policyVersion,
      modelVersions: input.modelVersions,
    };
  }

  return {
    decisionId: `${input.snapshotId}:${input.chainId}`,
    snapshotId: input.snapshotId,
    fusionSnapshotHash: input.fusionSnapshotHash,
    timestamp: input.timestamp,
    chainId: input.chainId,
    selectedAction: proposedAction,
    holdAdvantage: input.holdAdvantage,
    valuations: input.management.valuations,
    aegisState: input.aegis.newRiskState,
    executionRecommendedAction: input.executionQuality?.recommendedAction ?? null,
    executionAuthorized: false,
    reasonCodes: ['MANAGEMENT_ACTION_CONFIRMED'],
    plainEnglishExplanation: `${proposedAction} confirmed: risk-permitted and executable (or requires no order).`,
    failClosedReason: null,
    policyVersion: input.policyVersion,
    modelVersions: input.modelVersions,
  };
}
