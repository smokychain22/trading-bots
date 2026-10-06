import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import type { NewRiskDecisionReceipt } from './decision-assembly.js';
import { verifyStrategyPaperAuthorityReceipt, type StrategyPaperAuthorityReceipt } from './strategy-paper-authority.js';

export const definedRiskProductionDecisionVersion = 'theta-d-production-decision-v1' as const;

export type DefinedRiskPaperEntryDecision = Pick<NewRiskDecisionReceipt,
  'snapshotId' | 'timestamp' | 'underlying' | 'winningAction' | 'selectedCandidateId' | 'quantity'> & {
  readonly branch: 'THETA_DEFINED_RISK';
  readonly technicalCertification: 'CERTIFIED';
  readonly paperAuthorization: 'PAPER_EXPERIMENTAL_AUTHORIZED' | 'PAPER_CHAMPION';
  readonly strategyPaperAuthority: StrategyPaperAuthorityReceipt;
};

/**
 * Branch-local D nominator, the same shape as H's. It can propose a D spread only when Q has not opened and no H decision exists for this cycle
 * (one sovereign entry per cycle: Q, then H, then D), only from a verified governed THETA_DEFINED_RISK receipt, and only a candidate the frontier itself
 * marked structurally and risk feasible with a positive canonical size and both legs. The canonical frontier remains the sole selector and re-verifies all of it.
 * No expected value is invented here.
 */
export function buildDefinedRiskProductionDecision(input: {
  readonly structuralFrontier: CanonicalStrategyFrontier;
  readonly thetaQDecision?: Pick<NewRiskDecisionReceipt, 'winningAction'>;
  readonly holdStrikeDecisionProduced: boolean;
  readonly authority: StrategyPaperAuthorityReceipt | undefined;
}): DefinedRiskPaperEntryDecision | null {
  const qAction = input.thetaQDecision?.winningAction;
  if (qAction !== undefined && qAction.startsWith('OPEN_')) return null;
  if (input.holdStrikeDecisionProduced) return null;
  if (input.authority === undefined || !verifyStrategyPaperAuthorityReceipt(input.authority, 'THETA_DEFINED_RISK')) return null;
  const branch = input.structuralFrontier.branches.find((item) => item.branch === 'THETA_DEFINED_RISK');
  if (branch?.applicable !== true || branch.evaluated !== true || branch.evaluationState !== 'EVALUATED') return null;
  const eligible = (candidate: (typeof branch.candidates)[number]): boolean => candidate.action === 'OPEN_DEFINED_RISK'
    && candidate.structurallyFeasible && candidate.riskFeasible && candidate.sizing.quantity > 0 && candidate.legs.length === 2
    && candidate.hardBlockers.length === 0 && candidate.multiLegRiskEvidence !== null
    && ['ALLOW_FULL', 'ALLOW_REDUCED'].includes(candidate.aegisState ?? '')
    && candidate.legs[0]?.positionIntent === 'SELL_TO_OPEN' && candidate.legs[1]?.positionIntent === 'BUY_TO_OPEN';
  const best = branch.candidates.find((item) => item.candidateId === branch.bestCandidateId);
  const candidate = best !== undefined && eligible(best) ? best : branch.candidates.find(eligible);
  if (candidate === undefined) return null;
  const shortLeg = candidate.legs[0], longLeg = candidate.legs[1];
  if (shortLeg === undefined || longLeg === undefined) return null;
  return { branch: 'THETA_DEFINED_RISK', snapshotId: input.structuralFrontier.snapshotId, timestamp: input.structuralFrontier.timestamp,
    underlying: candidate.underlying, winningAction: candidate.aegisState === 'ALLOW_REDUCED' ? 'OPEN_REDUCED' : 'OPEN_FULL',
    // the frontier binds `${branch}:${selectedCandidateId}` to the candidate id, so this is exactly the two-leg identity
    selectedCandidateId: `${shortLeg.optionSymbol}:${longLeg.optionSymbol}`, quantity: candidate.sizing.quantity,
    technicalCertification: 'CERTIFIED', paperAuthorization: input.authority.maturity === 'PAPER_CHAMPION' ? 'PAPER_CHAMPION' : 'PAPER_EXPERIMENTAL_AUTHORIZED',
    strategyPaperAuthority: input.authority };
}
