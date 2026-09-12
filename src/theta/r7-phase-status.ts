import type { FirstPaperOrderDryRun } from './first-paper-order-preflight.js';

export interface R7PhaseStatus {
  readonly receiptVersion:'theta-r7-phase-status-v1';
  readonly R7_ENGINEERING:'PASS'|'FAIL';
  readonly R7_EMPIRICAL_GATE:'PASS'|'BLOCKED';
  readonly R7_OWNER_AUTHORIZATION:'GRANTED'|'NOT_GRANTED';
  readonly R7_FULL_PHASE:'YES'|'NO';
  readonly READY_FOR_FIRST_PAPER_ORDER:'YES'|'NO';
  readonly blockers:readonly string[];
}

const empiricalBlockerPrefixes=Object.freeze([
  'EV_MODEL_','EXPECTED_AFTER_COST_','TAIL_EVIDENCE_','CAPITAL_DAY_ECONOMICS_',
  'EV_UNCERTAINTY_','CALIBRATION_COHORT_','PROMOTION_EVIDENCE_','RESEARCH_PROMOTION_',
]);

export function buildR7PhaseStatus(dryRun:FirstPaperOrderDryRun):R7PhaseStatus {
  const engineeringBlockers:string[]=[];
  if(dryRun.networkSubmission!=='NOT_ATTEMPTED') engineeringBlockers.push('NETWORK_BOUNDARY_BROKEN');
  if(dryRun.executionAuthorized!==false) engineeringBlockers.push('EXECUTION_AUTHORIZED');
  if(dryRun.brokerEndpoint!=='/v2/orders') engineeringBlockers.push('BROKER_ENDPOINT_INVALID');
  if(dryRun.request===null||dryRun.requestPayloadHash===null||dryRun.mechanicalBlockers.length>0)
    engineeringBlockers.push('DRY_RUN_ORDER_NOT_CONSTRUCTED');
  const engineering=engineeringBlockers.length===0?'PASS':'FAIL';
  const empiricalBlocked=dryRun.receipt.blockers.some((blocker)=>
    empiricalBlockerPrefixes.some((prefix)=>blocker.startsWith(prefix)));
  const ownerAuthorization=dryRun.receipt.operations.ownerAuthorization;
  const fullPhase=engineering==='PASS'&&!empiricalBlocked&&ownerAuthorization==='GRANTED'
    &&dryRun.receipt.readyForFirstPaperOrder==='YES'?'YES':'NO';
  return {receiptVersion:'theta-r7-phase-status-v1',R7_ENGINEERING:engineering,
    R7_EMPIRICAL_GATE:empiricalBlocked?'BLOCKED':'PASS',
    R7_OWNER_AUTHORIZATION:ownerAuthorization,R7_FULL_PHASE:fullPhase,
    READY_FOR_FIRST_PAPER_ORDER:dryRun.receipt.readyForFirstPaperOrder,
    blockers:[...new Set([...engineeringBlockers,...dryRun.receipt.blockers])].sort()};
}
