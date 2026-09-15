import {createHash} from 'node:crypto';

export const p2gSimulationVersion='theta-p2g-simulation-v1' as const;
export type SyntheticLifecycleAction='OPEN_CSP'|'CLOSE_CSP'|'EXPIRE_CSP'|'ROLL_CLOSE_CSP'|'ROLL_OPEN_CSP'|
  'ASSIGN'|'RECOVERY_WAIT'|'SELL_STOCK'|'OPEN_CC'|'CLOSE_CC'|'EXPIRE_CC'|'ROLL_CLOSE_CC'|'ROLL_OPEN_CC'|
  'CALL_AWAY'|'OPEN_DEFINED_RISK'|'CLOSE_DEFINED_RISK'|'EXPIRE_DEFINED_RISK';
export interface SyntheticLifecycleEvent {
  readonly eventId:string; readonly at:string; readonly action:SyntheticLifecycleAction;
  readonly cashFlow:number; readonly realizedPnl:number|null; readonly collateral:number;
  readonly stateAfter:string; readonly evidence:Readonly<Record<string,unknown>>;
}
export interface SyntheticLifecycleReceipt {
  readonly version:typeof p2gSimulationVersion; readonly scenarioId:string; readonly events:readonly SyntheticLifecycleEvent[];
  readonly realizedOptionPnl:number; readonly realizedStockPnl:number; readonly dividends:number; readonly fees:number;
  readonly wholeChainNetPnl:number; readonly capitalDays:number; readonly terminalState:string; readonly contentHash:string;
  readonly evidenceOrigin:'SIMULATED'; readonly executionAuthorized:false; readonly realPaperEvidence:false;
  readonly policyLearningEligible:false;
}
export interface SyntheticLifecycleScenario {
  readonly scenarioId:string; readonly openedAt:string; readonly closedAt:string;
  readonly events:readonly Omit<SyntheticLifecycleEvent,'eventId'>[];
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item!==null&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))):item);
const finite=(value:number):boolean=>Number.isFinite(value);

export function simulateLifecycle(scenario:SyntheticLifecycleScenario):SyntheticLifecycleReceipt {
  if(!scenario.scenarioId.trim())throw new Error('SCENARIO_ID_REQUIRED');
  if(scenario.events.length===0)throw new Error('SCENARIO_EVENTS_REQUIRED');
  let realizedOptionPnl=0,realizedStockPnl=0,fees=0,dividends=0,capitalDays=0;
  const events=scenario.events.map((event,index)=>{
    if(!finite(event.cashFlow)||!finite(event.collateral)||event.collateral<0)throw new Error('SIMULATION_NUMERIC_INPUT_INVALID');
    if(event.realizedPnl!==null&&!finite(event.realizedPnl))throw new Error('SIMULATION_REALIZED_PNL_INVALID');
    const prior=index===0?scenario.openedAt:scenario.events[index-1]?.at??scenario.openedAt;
    const elapsedDays=(Date.parse(event.at)-Date.parse(prior))/86_400_000;
    if(!Number.isFinite(elapsedDays)||elapsedDays<0)throw new Error('SIMULATION_TIME_ORDER_INVALID');
    capitalDays+=event.collateral*elapsedDays;
    if(event.action.includes('CSP')||event.action.includes('CC')||event.action.includes('DEFINED_RISK')||event.action==='ASSIGN')
      realizedOptionPnl+=event.realizedPnl??0;
    if(event.action==='SELL_STOCK'||event.action==='CALL_AWAY')realizedStockPnl+=event.realizedPnl??0;
    const eventFees=typeof event.evidence.fees==='number'&&finite(event.evidence.fees)?event.evidence.fees:0;
    const eventDividends=typeof event.evidence.dividends==='number'&&finite(event.evidence.dividends)?event.evidence.dividends:0;
    const additionalOptionPnl=typeof event.evidence.additionalOptionRealizedPnl==='number'&&finite(event.evidence.additionalOptionRealizedPnl)
      ?event.evidence.additionalOptionRealizedPnl:0;
    realizedOptionPnl+=additionalOptionPnl;
    fees+=eventFees;dividends+=eventDividends;
    const identity={scenarioId:scenario.scenarioId,index,at:event.at,action:event.action,stateAfter:event.stateAfter};
    return {...event,eventId:createHash('sha256').update(canonical(identity)).digest('hex')};
  });
  const terminalState=events.at(-1)?.stateAfter??'UNKNOWN';
  const wholeChainNetPnl=realizedOptionPnl+realizedStockPnl+dividends-fees;
  const base={version:p2gSimulationVersion,scenarioId:scenario.scenarioId,events,realizedOptionPnl,realizedStockPnl,
    dividends,fees,wholeChainNetPnl,capitalDays,terminalState,evidenceOrigin:'SIMULATED' as const,
    executionAuthorized:false as const,realPaperEvidence:false as const,policyLearningEligible:false as const};
  return {...base,contentHash:createHash('sha256').update(canonical(base)).digest('hex')};
}

export const p2gScenarioFamilies={
  loss:['ENTRY_IMMEDIATE_LOSS','NORMAL_ADVERSE_MOVE','STABLE_UNDERWATER','ACCELERATING_LOSS','WINNER_TO_LOSER',
    'EVENT_DRIVEN_LOSS','IV_EXPANSION_LOSS','DELTA_ACCELERATION','GAMMA_RISK_ACCELERATION','LATE_EXPIRY_LOSS',
    'LIQUIDITY_MARK_LOSS','RECOVERY_IMPROVING','RECOVERY_DETERIORATING'],
  winner:['WINNER_5','WINNER_8','WINNER_20','WINNER_35','WINNER_50','WINNER_75'],
  wait:['HEALTHY_WAIT','NO_OPPORTUNITY','RISK_WAIT','QUOTE_WAIT','DATA_WAIT','MARKET_CLOSED','PORTFOLIO_CONSTRAINT',
    'EVENT_WAIT','LIQUIDITY_WAIT','OVERSTRICT_POLICY_WAIT','POSSIBLE_LOGIC_PARALYSIS'],
  hold:['HOLD_SUPPORTED','HOLD_WEAK','HOLD_UNKNOWN','HOLD_OPPORTUNITY_COST_HIGH','HOLD_DERISK_RECOMMENDED_RESEARCH'],
  overtrading:['MARGINAL_REPEATED_ENTRY','STRATEGY_SWITCH_CHURN','COST_DOMINATED_REENTRY'],
  shortDte:['ZERO_DTE_OPEN','ZERO_DTE_FINAL_WINDOW','ONE_DTE','EXPIRY_ITM','EXPIRY_OTM','EXPIRY_PIN',
    'SHORT_DTE_EARLY_CLOSE','EXPECTED_ASSIGNMENT','EXPECTED_CALL_AWAY'],
} as const;

export function canonicalFullChainScenario():SyntheticLifecycleScenario {
  const e=(at:string,action:SyntheticLifecycleAction,cashFlow:number,realizedPnl:number|null,collateral:number,stateAfter:string,
    evidence:Readonly<Record<string,unknown>>={}):Omit<SyntheticLifecycleEvent,'eventId'>=>({at,action,cashFlow,realizedPnl,collateral,stateAfter,evidence});
  return {scenarioId:'P2G_FULL_CHAIN',openedAt:'2026-01-02T15:00:00Z',closedAt:'2026-02-20T20:00:00Z',events:[
    e('2026-01-02T15:00:00Z','OPEN_CSP',300,null,10000,'CSP_OPEN',{premiumPerShare:3,multiplier:100,fees:1}),
    e('2026-01-10T15:00:00Z','ROLL_CLOSE_CSP',-420,-120,10000,'ROLL_DECISION',{oldLossImmutable:true,fees:1}),
    e('2026-01-10T15:01:00Z','ROLL_OPEN_CSP',500,null,9500,'CSP_OPEN',{fees:1}),
    e('2026-01-24T20:00:00Z','ASSIGN',-9500,500,9500,'ASSIGNED',{shares:100,economicBasisPerShare:90,fees:1}),
    e('2026-01-27T15:00:00Z','RECOVERY_WAIT',0,null,9000,'RECOVERY_WAIT',{stockMark:88}),
    e('2026-02-03T15:00:00Z','OPEN_CC',180,null,9000,'CC_OPEN',{strike:94,fees:1}),
    e('2026-02-20T20:00:00Z','CALL_AWAY',9400,400,9000,'CLOSED',{additionalOptionRealizedPnl:180,fees:1}),
  ]};
}
