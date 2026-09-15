import { createHash } from 'node:crypto';
import type { ManagementInputState } from './management-input-state.js';

export const positionPathVersion = 'theta-position-path-v1' as const;
export type PositionPathClassification = 'NEW_POSITION'|'EARLY_WINNER'|'EARLY_LOSER'|'NORMAL_ADVERSE_MOVE'|
  'MATURE_WINNER'|'WINNER_GIVEBACK'|'WINNER_TO_LOSER'|'THESIS_DETERIORATION'|'ACCELERATING_LOSS'|
  'LATE_EXPIRY_LOSS'|'EVENT_DRIVEN_LOSS'|'LIQUIDITY_MARK_LOSS'|'RECOVERY_IMPROVING'|
  'RECOVERY_DETERIORATING'|'STABLE_UNDERWATER'|'UNKNOWN';

export interface PositionPathCheckpoint {
  readonly version: typeof positionPathVersion;
  readonly checkpointIdentity: string;
  readonly chainId: string;
  readonly managementInputSnapshotId: string;
  readonly observedAt: string;
  readonly classification: PositionPathClassification;
  readonly currentWholeChainPnl: number | null;
  readonly currentOptionPnl: number | null;
  readonly peakWholeChainPnl: number | null;
  readonly troughWholeChainPnl: number | null;
  readonly profitGiveback: number | null;
  readonly drawdownFromPeak: number | null;
  readonly pnlVelocityPerHour: number | null;
  readonly spotVelocityPerHour: number | null;
  readonly greekVelocityPerHour: Readonly<{delta:number|null;gamma:number|null;theta:number|null;vega:number|null}>;
  readonly dte: number | null;
  readonly capitalDaysObserved: number | null;
  readonly markQuality: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly unknownFields: readonly string[];
  readonly executionAuthorized: false;
}

const finite = (value:number|null): value is number => value !== null && Number.isFinite(value);
const evidenceNumber = (value:unknown):number|null => typeof value==='number'&&Number.isFinite(value)?value:null;
const velocity = (current:number|null, previous:number|null, hours:number|null):number|null =>
  finite(current)&&finite(previous)&&finite(hours)&&hours>0 ? (current-previous)/hours : null;

function classify(input:ManagementInputState, previous:PositionPathCheckpoint|null, peak:number|null,
  current:number|null, giveback:number|null):PositionPathClassification {
  if (input.market.quoteQuality === 'STALE' || input.hardBlockers.includes('BROKER_DATA_STALE')) return 'UNKNOWN';
  if (previous === null) return current === null ? 'NEW_POSITION' : current > 0 ? 'EARLY_WINNER' : current < 0 ? 'EARLY_LOSER' : 'NEW_POSITION';
  if (finite(peak)&&peak>0&&finite(current)&&current<0) return 'WINNER_TO_LOSER';
  if (finite(giveback)&&giveback>0&&finite(peak)&&peak>0&&giveback/peak>=0.5) return 'WINNER_GIVEBACK';
  if (input.market.dte !== null&&input.market.dte<=1&&finite(current)&&current<0) return 'LATE_EXPIRY_LOSS';
  if (input.lifecycleState==='RECOVERY_WAIT'||input.lifecycleState==='STOCK_HELD') {
    if (finite(current)&&finite(previous.currentWholeChainPnl)) return current>previous.currentWholeChainPnl
      ? 'RECOVERY_IMPROVING' : current<previous.currentWholeChainPnl ? 'RECOVERY_DETERIORATING' : 'STABLE_UNDERWATER';
  }
  if (finite(current)&&current>0) return 'MATURE_WINNER';
  if (finite(current)&&current<0&&finite(previous.currentWholeChainPnl)&&current<previous.currentWholeChainPnl) return 'ACCELERATING_LOSS';
  if (finite(current)&&current<0) return 'NORMAL_ADVERSE_MOVE';
  return 'UNKNOWN';
}

export function buildPositionPathCheckpoint(input:ManagementInputState,
  history:readonly PositionPathCheckpoint[]):PositionPathCheckpoint {
  const ordered=[...history].filter((item)=>item.chainId===input.chainId)
    .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  const previous=ordered[ordered.length-1]??null;
  const current=input.economics.wholeChainPnl;
  const known=[...ordered.map((item)=>item.currentWholeChainPnl),current].filter(finite);
  const peak=known.length>0?Math.max(...known):null, trough=known.length>0?Math.min(...known):null;
  const giveback=finite(peak)&&finite(current)?Math.max(0,peak-current):null;
  const elapsedHours=previous===null?null:(Date.parse(input.observedAt)-Date.parse(previous.observedAt))/3_600_000;
  const unknown:string[]=[];
  if(current===null)unknown.push('CURRENT_WHOLE_CHAIN_PNL_UNKNOWN');
  if(input.market.spot===null)unknown.push('SPOT_UNKNOWN');
  if(input.market.dte===null)unknown.push('DTE_UNKNOWN');
  const greekVelocity={delta:velocity(input.market.delta,evidenceNumber(previous?.evidence.delta),elapsedHours),
    gamma:velocity(input.market.gamma,evidenceNumber(previous?.evidence.gamma),elapsedHours),
    theta:velocity(input.market.theta,evidenceNumber(previous?.evidence.theta),elapsedHours),
    vega:velocity(input.market.vega,evidenceNumber(previous?.evidence.vega),elapsedHours)};
  const evidence={spot:input.market.spot,strike:input.contract.strike,breakeven:input.contract.strike!==null&&input.economics.entryCreditDebit!==null&&input.contract.multiplier!==null&&input.contract.contracts!==null&&input.contract.contracts>0
      ? input.contract.strike-input.economics.entryCreditDebit/(input.contract.multiplier*input.contract.contracts):null,
    optionBid:input.market.optionBid,optionAsk:input.market.optionAsk,quoteTimestamp:input.market.quoteTimestamp,
    delta:input.market.delta,gamma:input.market.gamma,theta:input.market.theta,vega:input.market.vega,iv:input.market.iv,
    eventState:input.context.eventState,recoveryState:input.context.recoveryState,regimeState:input.context.regimeState};
  const identity=createHash('sha256').update(JSON.stringify({chainId:input.chainId,inputHash:input.contentHash,version:positionPathVersion})).digest('hex');
  return {version:positionPathVersion,checkpointIdentity:identity,chainId:input.chainId,
    managementInputSnapshotId:input.managementInputSnapshotId,observedAt:input.observedAt,
    classification:classify(input,previous,peak,current,giveback),currentWholeChainPnl:current,
    currentOptionPnl:input.economics.unrealizedOptionPnl,peakWholeChainPnl:peak,troughWholeChainPnl:trough,
    profitGiveback:giveback,drawdownFromPeak:giveback,pnlVelocityPerHour:velocity(current,previous?.currentWholeChainPnl??null,elapsedHours),
    spotVelocityPerHour:velocity(input.market.spot,evidenceNumber(previous?.evidence.spot),elapsedHours),greekVelocityPerHour:greekVelocity,
    dte:input.market.dte,capitalDaysObserved:input.contract.strike!==null&&input.contract.multiplier!==null&&input.contract.contracts!==null&&elapsedHours!==null
      ? input.contract.strike*input.contract.multiplier*input.contract.contracts*elapsedHours/24:null,
    markQuality:input.market.quoteQuality,evidence,unknownFields:[...new Set(unknown)].sort(),executionAuthorized:false};
}
