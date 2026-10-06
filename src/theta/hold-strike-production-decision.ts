import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import type { NewRiskDecisionReceipt } from './decision-assembly.js';
import { verifyStrategyPaperAuthorityReceipt, type StrategyPaperAuthorityReceipt } from './strategy-paper-authority.js';

export const holdStrikeProductionDecisionVersion='theta-h-production-decision-v1' as const;

export type HoldStrikePaperEntryDecision=Pick<NewRiskDecisionReceipt,
  'snapshotId'|'timestamp'|'underlying'|'winningAction'|'selectedCandidateId'|'quantity'>&{
  readonly branch:'THETA_HOLD_STRIKE';
  readonly technicalCertification:'CERTIFIED';
  readonly paperAuthorization:'PAPER_EXPERIMENTAL_AUTHORIZED'|'PAPER_CHAMPION';
  readonly strategyPaperAuthority:StrategyPaperAuthorityReceipt;
};

/** Branch-local H producer. It can nominate an H candidate only after Q has
 * declined to open. The canonical strategy frontier still performs the sole
 * cross-branch selection and rejects a stale, mismatched, or unauthorized
 * receipt. No expected value or profitability is invented here. */
export function buildHoldStrikeProductionDecision(input:{
  readonly structuralFrontier:CanonicalStrategyFrontier;
  readonly thetaQDecision?:Pick<NewRiskDecisionReceipt,'winningAction'>;
  readonly authority:StrategyPaperAuthorityReceipt|undefined;
}):HoldStrikePaperEntryDecision|null{
  const qAction=input.thetaQDecision?.winningAction;
  if(qAction!==undefined&&qAction.startsWith('OPEN_'))return null;
  if(input.authority===undefined||!verifyStrategyPaperAuthorityReceipt(input.authority,'THETA_HOLD_STRIKE'))return null;
  const branch=input.structuralFrontier.branches.find(item=>item.branch==='THETA_HOLD_STRIKE');
  if(branch?.applicable!==true||branch.evaluated!==true||branch.evaluationState!=='EVALUATED')return null;
  const candidate=branch.candidates.find(item=>item.candidateId===branch.bestCandidateId)
    ??branch.candidates.find(item=>item.riskFeasible&&item.sizing.quantity>0);
  if(candidate===undefined||!candidate.riskFeasible||candidate.sizing.quantity<=0||candidate.legs.length!==1
    ||candidate.shortDteRiskEvidence===null||candidate.hardBlockers.length>0
    ||!['ALLOW_FULL','ALLOW_REDUCED'].includes(candidate.aegisState??''))return null;
  const selectedCandidateId=candidate.legs[0]?.optionSymbol;
  if(selectedCandidateId===undefined)return null;
  return {branch:'THETA_HOLD_STRIKE',snapshotId:input.structuralFrontier.snapshotId,
    timestamp:input.structuralFrontier.timestamp,underlying:candidate.underlying,
    winningAction:candidate.aegisState==='ALLOW_REDUCED'?'OPEN_REDUCED':'OPEN_FULL',
    selectedCandidateId,quantity:candidate.sizing.quantity,technicalCertification:'CERTIFIED',
    paperAuthorization:input.authority.maturity==='PAPER_CHAMPION'?'PAPER_CHAMPION':'PAPER_EXPERIMENTAL_AUTHORIZED',
    strategyPaperAuthority:input.authority};
}
